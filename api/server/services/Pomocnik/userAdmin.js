/**
 * Pomocnik: account administration that LibreChat 0.8.8 has no admin API for (its admin users
 * API only lists and searches). Used by the admin routes in ~/server/routes/admin/pomocnikUsers.js
 * (Admin Panel, "Users" page) and by the CLI config/pomocnik-users.js.
 *
 * Suspension = a LibreChat ban without an expiry (checkBan treats a ban without expiresAt as
 * permanent; needs BAN_VIOLATIONS=true), plus logout everywhere and deleting the user's agent API
 * keys (the /api/agents/v1 API is mounted before checkBan). Deletion suspends the account first
 * (so it has no running generations), then runs LibreChat's own config/delete-user.js, which
 * erases all of the user's data.
 */
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { spawn } = require('child_process');
const { Keyv } = require('keyv');
const { keyvMongo } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { ViolationTypes, SystemRoles } = require('librechat-data-provider');
const getLogStores = require('~/cache/getLogStores');
const db = require('~/models');

const ROLES = [SystemRoles.USER, SystemRoles.ADMIN];
const DELETE_USER_SCRIPT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'config',
  'delete-user.js',
);
const DELETE_TIMEOUT_MS = 10 * 60 * 1000;

/** Error with an HTTP status for the routes; the CLI prints the message. */
class UserAdminError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const models = () => require('@librechat/data-schemas').createModels(mongoose);
const banLogs = () => getLogStores(ViolationTypes.BAN);
/** checkBan caches a hit in the "ban" namespace (key = user id without Redis). */
const banCache = () => new Keyv({ store: keyvMongo, namespace: ViolationTypes.BAN });

function normalizeEmail(email) {
  const value = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) {
    throw new UserAdminError(400, 'Invalid email address');
  }
  return value;
}

function checkName(name) {
  const value = typeof name === 'string' ? name.trim() : '';
  if (value.length < 3 || value.length > 80) {
    throw new UserAdminError(400, 'The name must have 3-80 characters');
  }
  return value;
}

function checkRole(role) {
  if (!ROLES.includes(role)) {
    throw new UserAdminError(400, `The role must be one of ${ROLES.join(', ')}`);
  }
  return role;
}

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new UserAdminError(400, 'The password must have 8-128 characters');
  }
  return password;
}

/** 20 characters from an alphabet without look-alikes (0/O, 1/l/I). */
function generatePassword() {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(20);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

async function findUser({ id, email }) {
  const { User } = models();
  let user = null;
  if (id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new UserAdminError(400, 'Invalid user ID format');
    }
    user = await User.findById(id);
  } else {
    user = await User.findOne({ email: normalizeEmail(email) });
  }
  if (!user) {
    throw new UserAdminError(404, 'User not found');
  }
  return user;
}

const isSuspendedId = async (id) => Boolean(await banLogs().get(id.toString()));

/** Ids of all suspended users among the given ones (all users when omitted). */
async function listSuspendedIds(ids) {
  const { User } = models();
  const userIds = ids ?? (await User.find({}, '_id').lean()).map((u) => u._id.toString());
  const flags = await Promise.all(userIds.map((id) => isSuspendedId(id)));
  return userIds.filter((_, i) => flags[i]);
}

async function listUsers() {
  const { User, AgentApiKey } = models();
  const users = await User.find({}, 'email name username role createdAt')
    .sort({ createdAt: 1 })
    .lean();
  return Promise.all(
    users.map(async (u) => ({
      id: u._id.toString(),
      email: u.email,
      name: u.name,
      username: u.username,
      role: u.role,
      createdAt: u.createdAt,
      suspended: await isSuspendedId(u._id),
      apiKeys: await AgentApiKey.countDocuments({ userId: u._id }),
    })),
  );
}

const logoutEverywhere = (id) => db.deleteAllUserSessions({ userId: id.toString() });

async function assertNotLastAdmin(user, action) {
  if (user.role !== SystemRoles.ADMIN) {
    return;
  }
  const { User } = models();
  const admins = await User.countDocuments({ role: SystemRoles.ADMIN });
  if (admins <= 1) {
    throw new UserAdminError(400, `Cannot ${action} the last admin`);
  }
}

function assertNotSelf(user, actorId, action) {
  if (actorId && user._id.toString() === actorId.toString()) {
    throw new UserAdminError(403, `Cannot ${action} your own account`);
  }
}

/** Creates an account (email verified). Returns the user and the password (generated if omitted). */
async function createUser({ email, name, role = SystemRoles.USER, password }) {
  const { User } = models();
  const cleanEmail = normalizeEmail(email);
  const cleanName = checkName(name);
  checkRole(role);
  const pw = password ? checkPassword(password) : generatePassword();
  if (await User.findOne({ email: cleanEmail })) {
    throw new UserAdminError(409, 'A user with this email already exists');
  }
  const { registerUser } = require('~/server/services/AuthService');
  const base =
    cleanEmail
      .split('@')[0]
      .replace(/[^a-z0-9._-]/g, '')
      .slice(0, 30) || 'user';
  const taken = await User.findOne({ username: base });
  const username = taken ? `${base}-${crypto.randomBytes(2).toString('hex')}` : base;
  const result = await registerUser(
    { email: cleanEmail, password: pw, confirm_password: pw, name: cleanName, username },
    { emailVerified: true },
  );
  if (result?.status && result.status !== 200) {
    throw new UserAdminError(
      result.status >= 500 ? 500 : 400,
      result.message || 'Registration failed',
    );
  }
  const user = await findUser({ email: cleanEmail });
  // The first account ever registered becomes ADMIN in LibreChat; set the requested role.
  await User.updateOne({ _id: user._id }, { $set: { role } });
  logger.info(`[PomocnikUsers] created ${cleanEmail} (${role})`);
  return { user: await findUser({ id: user._id.toString() }), password: pw };
}

/** Sets a new password (generated if omitted) and logs the user out everywhere. */
async function resetPassword({ id, email, password }) {
  const { User } = models();
  const user = await findUser({ id, email });
  const pw = password ? checkPassword(password) : generatePassword();
  const hash = await bcrypt.hash(pw, await bcrypt.genSalt(10));
  await User.updateOne({ _id: user._id }, { $set: { password: hash } });
  await logoutEverywhere(user._id);
  logger.info(`[PomocnikUsers] password reset for ${user.email}`);
  return { user, password: pw };
}

/**
 * A user changes their own password: needs the current one, logs out every other session
 * (keepSessionId = the session of this request, from its refresh token cookie).
 */
async function changeOwnPassword({ userId, currentPassword, newPassword, keepSessionId }) {
  const { User } = models();
  const user = await User.findById(userId).select('+password');
  if (!user) {
    throw new UserAdminError(404, 'User not found');
  }
  if (!user.password) {
    throw new UserAdminError(400, 'This account signs in without a password');
  }
  // 400, not 401: the client treats 401 as an expired session and logs out.
  const matches =
    typeof currentPassword === 'string' && (await bcrypt.compare(currentPassword, user.password));
  if (!matches) {
    throw new UserAdminError(400, 'The current password is incorrect');
  }
  checkPassword(newPassword);
  if (newPassword === currentPassword) {
    throw new UserAdminError(400, 'The new password must differ from the current one');
  }
  const hash = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
  await User.updateOne({ _id: user._id }, { $set: { password: hash } });
  const { deletedCount = 0 } =
    (await db.deleteAllUserSessions(
      { userId: user._id.toString() },
      keepSessionId ? { excludeCurrentSession: true, currentSessionId: keepSessionId } : {},
    )) ?? {};
  logger.info(
    `[PomocnikUsers] ${user.email} changed their password, ${deletedCount} other session(s) ended`,
  );
  return { otherSessionsEnded: deletedCount };
}

async function suspendUser({ id, email, actorId, reason = 'suspended by admin' }) {
  const user = await findUser({ id, email });
  assertNotSelf(user, actorId, 'suspend');
  await assertNotLastAdmin(user, 'suspend');
  // ttl 0 = no expiry; no expiresAt in the value = permanent ban for checkBan.
  await banLogs().set(
    user._id.toString(),
    { type: ViolationTypes.BAN, violation_count: 0, duration: 0, reason },
    0,
  );
  await logoutEverywhere(user._id);
  const apiKeysDeleted = (await db.deleteAllAgentApiKeys(user._id)) ?? 0;
  logger.info(`[PomocnikUsers] suspended ${user.email}, ${apiKeysDeleted} API key(s) deleted`);
  return { user, apiKeysDeleted };
}

async function unsuspendUser({ id, email }) {
  const user = await findUser({ id, email });
  const key = user._id.toString();
  await banLogs().delete(key);
  await banCache().delete(key);
  logger.info(`[PomocnikUsers] unsuspended ${user.email}`);
  return { user };
}

/** Changes name, email and/or role; email and role changes log the user out everywhere. */
async function updateUser({ id, email, name, newEmail, role, actorId }) {
  const { User } = models();
  const user = await findUser({ id, email });
  const set = {};
  if (name !== undefined) {
    set.name = checkName(name);
  }
  if (newEmail !== undefined) {
    const clean = normalizeEmail(newEmail);
    if (clean !== user.email) {
      const other = await User.findOne({ email: clean });
      if (other) {
        throw new UserAdminError(409, 'A user with this email already exists');
      }
      set.email = clean;
    }
  }
  if (role !== undefined && role !== user.role) {
    checkRole(role);
    if (role !== SystemRoles.ADMIN) {
      assertNotSelf(user, actorId, 'demote');
      await assertNotLastAdmin(user, 'demote');
    }
    set.role = role;
  }
  if (Object.keys(set).length === 0) {
    return { user };
  }
  await User.updateOne({ _id: user._id }, { $set: set });
  if (set.email || set.role) {
    await logoutEverywhere(user._id);
  }
  logger.info(`[PomocnikUsers] updated ${user.email}: ${Object.keys(set).join(', ')}`);
  return { user: await findUser({ id: user._id.toString() }) };
}

/** Runs config/delete-user.js and answers each of its y/N questions as it is asked. */
function runDeleteScript(userEmail) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [DELETE_USER_SCRIPT, userEmail], {
      cwd: path.dirname(path.dirname(DELETE_USER_SCRIPT)),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let pending = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), DELETE_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      pending += text;
      // Every question of delete-user.js ends with "(y/N)"; feeding the answers at once hangs it
      // (each question opens a new readline), so answer each one once it appears.
      while (pending.includes('(y/N)')) {
        pending = pending.slice(pending.indexOf('(y/N)') + 5);
        child.stdin.write('y\n');
      }
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

/** Deletes an account and all its data (conversations, agents, files, transactions, ...). */
async function deleteUser({ id, email, actorId }) {
  const user = await findUser({ id, email });
  assertNotSelf(user, actorId, 'delete');
  await assertNotLastAdmin(user, 'delete');
  await suspendUser({ id: user._id.toString(), reason: 'being deleted' });
  // Let a reply that was already streaming end before the deletion fence is set.
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const { code, output } = await runDeleteScript(user.email);
  if (code !== 0 || !output.includes('Successfully deleted user')) {
    logger.error(
      `[PomocnikUsers] delete-user.js failed for ${user.email} (exit ${code}): ${output.slice(-2000)}`,
    );
    throw new UserAdminError(500, 'Deleting the user failed; the account stays suspended');
  }
  await banLogs().delete(user._id.toString());
  await banCache().delete(user._id.toString());
  logger.info(`[PomocnikUsers] deleted ${user.email}`);
  return { email: user.email };
}

/** The fields the admin routes return for a user. */
async function toPublicUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
    suspended: await isSuspendedId(user._id),
  };
}

module.exports = {
  ROLES,
  UserAdminError,
  generatePassword,
  listUsers,
  listSuspendedIds,
  createUser,
  resetPassword,
  changeOwnPassword,
  suspendUser,
  unsuspendUser,
  updateUser,
  deleteUser,
  toPublicUser,
};
