/**
 * Pomocnik: a client's secrets (hosting panel passwords, SSH keys) that agents may use but the
 * model never sees. An admin sets them; the client cannot read, change or remove them.
 *
 * Storage: LibreChat's MCP custom user variables (PluginAuth, value encrypted with CREDS_KEY),
 * field POMOCNIK_SECRETS, one entry per secret-aware MCP server (pluginKey "mcp_<server>"). The
 * value is base64 of a dotenv text, because LibreChat passes it in a request header
 * (librechat.yaml: X-Pomocnik-Secrets: '{{POMOCNIK_SECRETS}}') and dotenv values may span lines.
 * The servers (docker/sejf for the browser, the SSH server) read the names they need.
 *
 * Names are UPPER_CASE. Settings, shown in clear text: SEJF_ORIGINS (pages where the browser may
 * type secrets), SSH_<X>_ADDR (user@host[:port]), SSH_<X>_HOSTKEY (known_hosts line); everything
 * else is a secret: write-only for the admin, never shown to the model (redacted by the servers).
 */
const { logger } = require('@librechat/data-schemas');
const { Constants } = require('librechat-data-provider');
const {
  getUserPluginAuthValue,
  updateUserPluginAuth,
  deleteUserPluginAuth,
} = require('~/server/services/PluginService');

const FIELD = 'POMOCNIK_SECRETS';
/** MCP servers in librechat.yaml that declare customUserVars.POMOCNIK_SECRETS. */
const SECRET_SERVERS = ['sejf', 'ssh'];
const PLUGIN_KEYS = SECRET_SERVERS.map((s) => `${Constants.mcp_prefix}${s}`);
const NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Node's default header limit is 16 KiB for all headers together; leave room for the rest. */
const MAX_ENCODED = 8 * 1024;

class SecretsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Parses dotenv text (same rules as docker/sejf/secrets.mjs parseDotenv), plus values in double
 * quotes spanning several lines, so an admin can paste a private key as it is:
 *   SSH_X_KEY="-----BEGIN OPENSSH PRIVATE KEY-----
 *   ...
 *   -----END OPENSSH PRIVATE KEY-----"
 */
function parseDotenv(text) {
  const out = {};
  const lines = String(text ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) {
      throw new SecretsError(400, `Not a NAME=value line: "${line.slice(0, 40)}"`);
    }
    let value = m[2];
    if (value.startsWith('"') && (value.length === 1 || !value.endsWith('"'))) {
      const parts = [value];
      while (++i < lines.length) {
        parts.push(lines[i].trimEnd());
        if (lines[i].trimEnd().endsWith('"')) {
          break;
        }
      }
      value = parts.join('\n');
      if (!value.endsWith('"') || value.length < 2) {
        throw new SecretsError(400, `Unclosed quote in ${m[1]}`);
      }
      out[m[1]] = value.slice(1, -1);
      continue;
    }
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

/** Serialises to dotenv; every value double-quoted with \\, " and newlines escaped. */
function toDotenv(values) {
  return Object.entries(values)
    .map(([k, v]) => {
      const escaped = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n');
      return `${k}="${escaped}"`;
    })
    .join('\n');
}

async function readValues(userId) {
  const stored = await getUserPluginAuthValue(userId, FIELD, false, PLUGIN_KEYS[0]);
  if (!stored) {
    return {};
  }
  try {
    return parseDotenv(Buffer.from(stored, 'base64').toString('utf8'));
  } catch (error) {
    logger.error('[PomocnikSecrets] stored value is not valid dotenv', error);
    return {};
  }
}

/** Settings, not secrets (same rule as docker/sejf/secrets.mjs isPublicName). */
const isPublicName = (name) => name.startsWith('SEJF_') || /_(ADDR|HOSTKEY)$/.test(name);

/** What the admin sees: secret names only; settings (SEJF_*, *_ADDR, *_HOSTKEY) with values. */
function describe(values) {
  const names = Object.keys(values)
    .filter((k) => !isPublicName(k))
    .sort();
  const settings = Object.fromEntries(
    Object.entries(values)
      .filter(([k]) => isPublicName(k))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return { names, settings };
}

async function getSecrets(userId) {
  return describe(await readValues(userId));
}

/** Drops the user's open connections, so the next tool call sends the new header. */
async function reconnect(userId) {
  try {
    const { getMCPManager } = require('~/config');
    const manager = getMCPManager();
    await Promise.all(
      SECRET_SERVERS.map((server) =>
        manager?.disconnectUserConnection(userId, server).catch(() => undefined),
      ),
    );
  } catch (error) {
    logger.warn('[PomocnikSecrets] could not drop MCP connections', error);
  }
}

/**
 * Merges changes: `set` is dotenv text (new or replaced names), `remove` a list of names.
 * Returns the names after the change.
 */
async function updateSecrets(userId, { set, remove } = {}) {
  const values = await readValues(userId);
  const incoming = parseDotenv(set);
  for (const [name, value] of Object.entries(incoming)) {
    if (!NAME_RE.test(name)) {
      throw new SecretsError(400, `Invalid name "${name}": use A-Z, 0-9 and _ (max 64)`);
    }
    if (!value) {
      throw new SecretsError(400, `Empty value for ${name}; use "remove" to delete it`);
    }
    values[name] = value;
  }
  for (const name of Array.isArray(remove) ? remove : []) {
    delete values[name];
  }

  if (Object.keys(values).length === 0) {
    await deleteSecrets(userId);
    return describe({});
  }
  const encoded = Buffer.from(toDotenv(values), 'utf8').toString('base64');
  if (encoded.length > MAX_ENCODED) {
    throw new SecretsError(400, `Too much data (${encoded.length} B encoded, max ${MAX_ENCODED})`);
  }
  for (const pluginKey of PLUGIN_KEYS) {
    const result = await updateUserPluginAuth(userId, FIELD, pluginKey, encoded);
    if (result instanceof Error) {
      throw result;
    }
  }
  await reconnect(userId);
  return describe(values);
}

async function deleteSecrets(userId) {
  for (const pluginKey of PLUGIN_KEYS) {
    const result = await deleteUserPluginAuth(userId, FIELD, false, pluginKey);
    if (result instanceof Error) {
      throw result;
    }
  }
  await reconnect(userId);
}

/**
 * Middleware for POST /api/user/plugins: users must not change or delete admin-set secrets
 * (LibreChat lets them manage their own MCP variables; an "uninstall" with auth fields deletes
 * by field name across all plugin keys).
 */
function protectSecrets(req, res, next) {
  const { pluginKey, auth } = req.body ?? {};
  const touchesField = auth && typeof auth === 'object' && Object.hasOwn(auth, FIELD);
  const key = typeof pluginKey === 'string' ? pluginKey : '';
  const touchesServer =
    PLUGIN_KEYS.includes(key) ||
    SECRET_SERVERS.some((s) => key.endsWith(`${Constants.mcp_delimiter}${s}`));
  if (touchesServer || touchesField) {
    return res.status(403).json({ message: 'These credentials are managed by the administrator' });
  }
  return next();
}

module.exports = {
  FIELD,
  SECRET_SERVERS,
  SecretsError,
  parseDotenv,
  toDotenv,
  getSecrets,
  updateSecrets,
  deleteSecrets,
  protectSecrets,
};
