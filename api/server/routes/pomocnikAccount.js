/**
 * Pomocnik: the signed-in user's own account (LibreChat 0.8.8 has no "change password" for
 * local accounts; its reset by email is off without SMTP). Used by Settings > Account.
 *
 *   POST /api/pomocnik/account/password   {currentPassword, newPassword} -> {otherSessionsEnded}
 *   errors: {error, code?}; code CURRENT_PASSWORD_INCORRECT or SAME_PASSWORD (both 400)
 *
 * Other sessions are logged out; this one (the refresh token cookie) stays signed in.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { limiterCache, removePorts } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { requireJwtAuth } = require('~/server/middleware');
const { findSession } = require('~/models');
const users = require('~/server/services/Pomocnik/userAdmin');

const router = express.Router();

const userId = (req) => req.user?._id?.toString() ?? req.user?.id;

/** Guessing the current password: 10 attempts per user per 15 minutes. */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => userId(req) ?? removePorts(req),
  store: limiterCache('pomocnik_account_password_limiter'),
  handler: (_req, res) =>
    res.status(429).json({ error: 'Too many attempts, try again in 15 minutes' }),
});

router.post('/password', requireJwtAuth, limiter, async (req, res) => {
  try {
    const id = userId(req);
    const refreshToken = req.cookies?.refreshToken;
    const session = refreshToken ? await findSession({ userId: id, refreshToken }) : null;
    const result = await users.changeOwnPassword({
      userId: id,
      currentPassword: req.body?.currentPassword,
      newPassword: req.body?.newPassword,
      keepSessionId: session?._id,
    });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof users.UserAdminError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    logger.error('[PomocnikAccount] password change failed:', error);
    return res.status(500).json({ error: 'Changing the password failed' });
  }
});

module.exports = router;
