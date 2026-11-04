/**
 * Pomocnik: admin API for accounts, next to LibreChat's own /api/admin/users (which only lists
 * and searches in 0.8.8; its delete route is disabled). Mounted on the same prefix after it, so
 * GET / and GET /search stay LibreChat's. Used by the Admin Panel "Users" page.
 *
 *   GET    /api/admin/users/pomocnik          users with suspended flag and API key count
 *   POST   /api/admin/users                   {email, name, role?, password?} -> {user, password}
 *   PATCH  /api/admin/users/:id               {name?, email?, role?}
 *   POST   /api/admin/users/:id/password      {password?} -> {user, password}
 *   POST   /api/admin/users/:id/suspend
 *   POST   /api/admin/users/:id/unsuspend
 *   DELETE /api/admin/users/:id               all of the user's data
 *
 * A generated password is returned once and never stored in clear text.
 */
const express = require('express');
const { logger, SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const users = require('~/server/services/Pomocnik/userAdmin');

const router = express.Router();
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);

router.use(requireJwtAuth, requireCapability(SystemCapabilities.ACCESS_ADMIN));

const actorId = (req) => req.user?._id?.toString() ?? req.user?.id;

/** Wraps a handler: UserAdminError -> its status, anything else -> 500. */
const handle = (fn) => async (req, res) => {
  try {
    return res.status(200).json(await fn(req));
  } catch (error) {
    if (error instanceof users.UserAdminError) {
      return res.status(error.status).json({ error: error.message });
    }
    logger.error('[PomocnikUsers] request failed:', error);
    return res.status(500).json({ error: 'User administration failed' });
  }
};

router.get(
  '/pomocnik',
  requireReadUsers,
  handle(async () => ({ users: await users.listUsers() })),
);

router.post(
  '/',
  requireManageUsers,
  handle(async (req) => {
    const { email, name, role, password } = req.body ?? {};
    const result = await users.createUser({ email, name, role, password });
    return { user: await users.toPublicUser(result.user), password: result.password };
  }),
);

router.patch(
  '/:id',
  requireManageUsers,
  handle(async (req) => {
    const { name, email, role } = req.body ?? {};
    const result = await users.updateUser({
      id: req.params.id,
      name,
      newEmail: email,
      role,
      actorId: actorId(req),
    });
    return { user: await users.toPublicUser(result.user) };
  }),
);

router.post(
  '/:id/password',
  requireManageUsers,
  handle(async (req) => {
    const result = await users.resetPassword({ id: req.params.id, password: req.body?.password });
    return { user: await users.toPublicUser(result.user), password: result.password };
  }),
);

router.post(
  '/:id/suspend',
  requireManageUsers,
  handle(async (req) => {
    const result = await users.suspendUser({ id: req.params.id, actorId: actorId(req) });
    return { user: await users.toPublicUser(result.user), apiKeysDeleted: result.apiKeysDeleted };
  }),
);

router.post(
  '/:id/unsuspend',
  requireManageUsers,
  handle(async (req) => {
    const result = await users.unsuspendUser({ id: req.params.id });
    return { user: await users.toPublicUser(result.user) };
  }),
);

router.delete(
  '/:id',
  requireManageUsers,
  handle(async (req) => {
    await users.deleteUser({ id: req.params.id, actorId: actorId(req) });
    return { message: 'User deleted successfully' };
  }),
);

module.exports = router;
