#!/usr/bin/env node
/**
 * Pomocnik: account administration from the command line (the Admin Panel "Users" page does the
 * same through /api/admin/users). Baked into the api image as /app/config/pomocnik-users.js;
 * ovh-infra/scripts/pomocnik/users.sh runs it in the pod. Logic: api/server/services/Pomocnik/userAdmin.js
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
 */
const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const connect = require('./connect');

const USAGE =
  'usage: pomocnik-users.js <list|create|reset-password|suspend|unsuspend|set-role|rename|set-email|delete> ...';

async function readStdinLine() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8').split('\n')[0].replace(/\r$/, '');
}

async function run(users, command, args) {
  const [email] = args;
  switch (command) {
    case 'list': {
      const list = await users.listUsers();
      for (const u of list) {
        const date = u.createdAt ? new Date(u.createdAt).toISOString().slice(0, 10) : '';
        const state = u.suspended ? 'SUSPENDED' : 'active';
        console.log([u.email, u.role, state, `apiKeys=${u.apiKeys}`, date, u.name].join('\t'));
      }
      return `${list.length} user(s)`;
    }
    case 'create': {
      const [, name, role] = args;
      const { user } = await users.createUser({ email, name, role, password: await readStdinLine() });
      return `created ${user.email} (${user.role})`;
    }
    case 'reset-password': {
      const { user } = await users.resetPassword({ email, password: await readStdinLine() });
      return `password changed for ${user.email}; all sessions logged out`;
    }
    case 'suspend': {
      const { user, apiKeysDeleted } = await users.suspendUser({ email });
      return `suspended ${user.email}; sessions logged out, ${apiKeysDeleted} API key(s) deleted`;
    }
    case 'unsuspend': {
      const { user } = await users.unsuspendUser({ email });
      return `unsuspended ${user.email} (API keys deleted at suspension must be created again)`;
    }
    case 'set-role': {
      const { user } = await users.updateUser({ email, role: args[1] });
      return `${user.email}: role ${user.role} (sessions logged out so the new role applies)`;
    }
    case 'rename': {
      const { user } = await users.updateUser({ email, name: args.slice(1).join(' ') });
      return `${user.email}: name "${user.name}"`;
    }
    case 'set-email': {
      const { user } = await users.updateUser({ email, newEmail: args[1] });
      return `${email} -> ${user.email} (sessions logged out)`;
    }
    case 'delete': {
      const { email: deleted } = await users.deleteUser({ email });
      return `deleted ${deleted}`;
    }
    default:
      throw new Error(USAGE);
  }
}

(async () => {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    console.error(USAGE);
    process.exit(1);
  }
  await connect();
  const users = require('~/server/services/Pomocnik/userAdmin');
  try {
    console.log(await run(users, command, args));
    process.exit(0);
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
})();
