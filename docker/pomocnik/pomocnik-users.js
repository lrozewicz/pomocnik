#!/usr/bin/env node
/**
 * Pomocnik: user administration that LibreChat 0.8.8 has no UI or admin API for.
 * Baked into the api image as /app/config/pomocnik-users.js; run in the api pod
 * (ovh-infra/scripts/pomocnik/users.sh does that):
 *
 *   node config/pomocnik-users.js list
 *   node config/pomocnik-users.js create <email> <name> [USER|ADMIN]   (password on stdin)
 *   node config/pomocnik-users.js reset-password <email>               (password on stdin)
 *   node config/pomocnik-users.js suspend <email>
 *   node config/pomocnik-users.js unsuspend <email>
 *   node config/pomocnik-users.js set-role <email> USER|ADMIN
 *   node config/pomocnik-users.js rename <email> <name>
 *   node config/pomocnik-users.js set-email <email> <new-email>
 *   node config/pomocnik-users.js delete <email>
 *
 * Suspension = a LibreChat ban without an expiry (checkBan treats a ban without expiresAt as
 * permanent; needs BAN_VIOLATIONS=true), plus logout everywhere (sessions) and deleting the
 * user's agent API keys (the /api/agents/v1 API is mounted before checkBan).
 * delete: suspends the account (so it has no running generations), then runs LibreChat's own
 * config/delete-user.js (all data and transactions) and answers its y/N questions as they come;
 * without Redis that script asks to confirm that no generation is running, which the suspension
 * guarantees for this user.
 */
const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const bcrypt = require('bcryptjs');
const { ViolationTypes, SystemRoles } = require('librechat-data-provider');
const connect = require('./connect');

const ROLES = [SystemRoles.USER, SystemRoles.ADMIN];

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

async function readStdinLine() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8').split('\n')[0].replace(/\r$/, '');
}

function checkPassword(password) {
  if (!password || password.length < 8 || password.length > 128) {
    fail('the password (stdin) must have 8-128 characters');
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    fail('usage: pomocnik-users.js <list|create|reset-password|suspend|unsuspend|set-role|rename|set-email|delete> ...');
  }
  await connect();
  const methods = require('~/models');
  const getLogStores = require('~/cache/getLogStores');
  const mongoose = require('mongoose');
  const { User, AgentApiKey } = require('@librechat/data-schemas').createModels(mongoose);
  const banLogs = getLogStores(ViolationTypes.BAN);

  const findByEmail = async (email) => {
    if (!email) {
      fail('email missing');
    }
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) {
      fail(`no user with email ${email}`);
    }
    return user;
  };
  const isSuspended = async (id) => Boolean(await banLogs.get(id.toString()));
  const logoutEverywhere = (id) => methods.deleteAllUserSessions({ userId: id.toString() });

  switch (command) {
    case 'list': {
      const users = await User.find({}, 'email name username role createdAt').sort({ createdAt: 1 }).lean();
      for (const u of users) {
        const keys = await AgentApiKey.countDocuments({ userId: u._id });
        const state = (await isSuspended(u._id)) ? 'SUSPENDED' : 'active';
        console.log(
          [u.email, u.role, state, `apiKeys=${keys}`, u.createdAt?.toISOString().slice(0, 10), u.name].join('\t'),
        );
      }
      console.log(`${users.length} user(s)`);
      break;
    }
    case 'create': {
      const [email, name, role = SystemRoles.USER] = args;
      if (!email || !email.includes('@') || !name) {
        fail('usage: create <email> <name> [USER|ADMIN]');
      }
      if (!ROLES.includes(role)) {
        fail(`role must be one of ${ROLES.join(', ')}`);
      }
      if (await User.findOne({ email: email.toLowerCase() })) {
        fail(`user ${email} already exists`);
      }
      const password = await readStdinLine();
      checkPassword(password);
      const { registerUser } = require('~/server/services/AuthService');
      const username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
      const result = await registerUser(
        { email, password, confirm_password: password, name, username },
        { emailVerified: true },
      );
      if (result?.status && result.status !== 200) {
        fail(`registerUser: ${result.message ?? JSON.stringify(result)}`);
      }
      const user = await findByEmail(email);
      // The first account ever registered becomes ADMIN in LibreChat; set the requested role explicitly.
      await User.updateOne({ _id: user._id }, { $set: { role } });
      console.log(`created ${user.email} (${role})`);
      break;
    }
    case 'reset-password': {
      const user = await findByEmail(args[0]);
      const password = await readStdinLine();
      checkPassword(password);
      const hash = await bcrypt.hash(password, await bcrypt.genSalt(10));
      await User.updateOne({ _id: user._id }, { $set: { password: hash, passwordVersion: Date.now() } });
      await logoutEverywhere(user._id);
      console.log(`password changed for ${user.email}; all sessions logged out`);
      break;
    }
    case 'suspend': {
      const user = await findByEmail(args[0]);
      // ttl 0 = no expiry; no expiresAt in the value = permanent ban for checkBan.
      await banLogs.set(
        user._id.toString(),
        { type: ViolationTypes.BAN, violation_count: 0, duration: 0, reason: 'suspended by admin' },
        0,
      );
      await logoutEverywhere(user._id);
      const keys = await methods.deleteAllAgentApiKeys(user._id);
      console.log(`suspended ${user.email}; sessions logged out, ${keys ?? 0} API key(s) deleted`);
      break;
    }
    case 'unsuspend': {
      const user = await findByEmail(args[0]);
      const id = user._id.toString();
      await banLogs.delete(id);
      // checkBan caches a hit in the "ban" namespace (key = user id without Redis).
      const { Keyv } = require('keyv');
      const { keyvMongo } = require('@librechat/api');
      await new Keyv({ store: keyvMongo, namespace: ViolationTypes.BAN }).delete(id);
      console.log(`unsuspended ${user.email} (API keys deleted at suspension must be created again)`);
      break;
    }
    case 'set-role': {
      const [email, role] = args;
      if (!ROLES.includes(role)) {
        fail(`role must be one of ${ROLES.join(', ')}`);
      }
      const user = await findByEmail(email);
      await User.updateOne({ _id: user._id }, { $set: { role } });
      await logoutEverywhere(user._id);
      console.log(`${user.email}: role ${role} (sessions logged out so the new role applies)`);
      break;
    }
    case 'rename': {
      const [email, ...nameParts] = args;
      const name = nameParts.join(' ').trim();
      if (name.length < 3) {
        fail('the name must have at least 3 characters');
      }
      const user = await findByEmail(email);
      await User.updateOne({ _id: user._id }, { $set: { name } });
      console.log(`${user.email}: name "${name}"`);
      break;
    }
    case 'set-email': {
      const [email, newEmail] = args;
      if (!newEmail || !newEmail.includes('@')) {
        fail('usage: set-email <email> <new-email>');
      }
      const user = await findByEmail(email);
      if (await User.findOne({ email: newEmail.toLowerCase() })) {
        fail(`${newEmail} is already used`);
      }
      await User.updateOne({ _id: user._id }, { $set: { email: newEmail.toLowerCase() } });
      await logoutEverywhere(user._id);
      console.log(`${email} -> ${newEmail.toLowerCase()} (sessions logged out)`);
      break;
    }
    case 'delete': {
      const user = await findByEmail(args[0]);
      await banLogs.set(
        user._id.toString(),
        { type: ViolationTypes.BAN, violation_count: 0, duration: 0, reason: 'being deleted' },
        0,
      );
      await logoutEverywhere(user._id);
      await methods.deleteAllAgentApiKeys(user._id);
      // Let a reply that was already streaming end before the deletion fence is set.
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const { spawn } = require('child_process');
      const code = await new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(__dirname, 'delete-user.js'), user.email], {
          cwd: path.resolve(__dirname, '..'),
          stdio: ['pipe', 'pipe', 'inherit'],
        });
        let pending = '';
        child.stdout.on('data', (chunk) => {
          process.stdout.write(chunk);
          pending += chunk.toString();
          // Every question of delete-user.js ends with "(y/N)"; answer each one once it is asked.
          while (pending.includes('(y/N)')) {
            pending = pending.slice(pending.indexOf('(y/N)') + 5);
            child.stdin.write('y\n');
          }
        });
        child.on('exit', resolve);
      });
      if (code !== 0) {
        fail(`delete-user.js exited with ${code}; the account stays suspended`);
      }
      await banLogs.delete(user._id.toString());
      console.log(`deleted ${user.email}`);
      break;
    }
    default:
      fail(`unknown command ${command}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
