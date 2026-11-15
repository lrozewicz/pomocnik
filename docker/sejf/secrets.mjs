// Shared by sejf.mjs (browser proxy) and ssh.mjs (SSH MCP server): the client's secrets from the
// X-Pomocnik-Secrets header (base64 of a dotenv text, set by an admin in Pomocnik) and redaction.

const MIN_REDACT_LENGTH = 4; // shorter values would garble ordinary text

/** Parses dotenv text: NAME=value, optional single/double quotes, \n in double quotes. */
export function parseDotenv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2];
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

/**
 * Names that are settings, not secrets: shown to the admin and to the model in clear text and
 * never redacted. SEJF_* (e.g. SEJF_ORIGINS), *_ADDR (user@host:port), *_HOSTKEY (known_hosts).
 */
export const isPublicName = (name) => name.startsWith('SEJF_') || /_(ADDR|HOSTKEY)$/.test(name);

const EMPTY = () => ({ all: {}, values: {}, origins: [] });

/**
 * Client data from the header value (base64 dotenv): `all` entries, `values` = the secrets
 * (redacted, typeable by name), `origins` = SEJF_ORIGINS. Empty when absent or invalid.
 */
export function secretsFromHeader(value) {
  if (!value || typeof value !== 'string' || value.startsWith('{{')) return EMPTY();
  let all;
  try {
    all = parseDotenv(Buffer.from(value, 'base64').toString('utf8'));
  } catch {
    return EMPTY();
  }
  const origins = (all.SEJF_ORIGINS || '')
    .split(/[\s;,]+/)
    .filter(Boolean)
    .map((o) => {
      try {
        return new URL(o).origin;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const values = {};
  for (const [k, v] of Object.entries(all)) {
    if (!isPublicName(k) && v) values[k] = v;
  }
  return { all, values, origins };
}

/**
 * Spellings of a value as it can appear in a response: raw, as a JS string literal (the
 * "Ran Playwright code" lines quote typed text: ' \ and newlines escaped), URL-encoded (form
 * posts echoed back), and each of those JSON-escaped up to 4 times. Longest first, so a longer
 * form is replaced whole. Best effort: a page that shows the value transformed in another way
 * (base64, reversed, split) is not caught; password fields are masked by the browser itself.
 */
export function secretForms(value) {
  const js = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
  const base = [value, js, encodeURIComponent(value), encodeURIComponent(value).replace(/%20/g, '+')];
  const forms = new Set();
  for (const b of base) {
    // Up to 4 levels: a page that shows JSON (1), quoted again in the YAML snapshot (2), inside
    // the MCP JSON body (3), and once more if a tool result embeds JSON (4).
    let f = b;
    forms.add(f);
    for (let level = 0; level < 4; level++) {
      f = JSON.stringify(f).slice(1, -1);
      forms.add(f);
    }
  }
  return [...forms].filter((f) => f.length >= MIN_REDACT_LENGTH).sort((a, b) => b.length - a.length);
}

/** Replaces every secret value (in all its spellings) with <secret>NAME</secret>. */
export function redact(text, values) {
  const entries = Object.entries(values)
    .filter(([, v]) => v.length >= MIN_REDACT_LENGTH)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [name, value] of entries) {
    const tag = `<secret>${name}</secret>`;
    for (const form of secretForms(value)) text = text.split(form).join(tag);
  }
  return text;
}

/** One line per new MCP session: user, number of secrets and the public names; never values. */
export function logSession(server, req, secrets) {
  const user = String(req.headers['x-pomocnik-user'] ?? '-').slice(0, 64);
  const pub = Object.keys(secrets.all).filter(isPublicName).join(',') || '-';
  console.log(`[${server}] session user=${user} secrets=${Object.keys(secrets.values).length} settings=${pub}`);
}
