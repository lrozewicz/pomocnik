// Sejf: an MCP proxy in front of the "browser" component (Playwright MCP) that lets an agent sign in
// with a client's passwords without the model ever seeing them.
//
// LibreChat sends the client's secrets in the X-Pomocnik-Secrets header (base64 of a dotenv text,
// stored encrypted per user as the MCP custom user variable POMOCNIK_SECRETS and set by an admin).
// The model refers to a secret by its NAME:
//   - browser_type / browser_fill_form: a text equal to a secret NAME is replaced with its value,
//     but only when the current tab is on one of the origins in SEJF_ORIGINS (checked with
//     browser_tabs right before the call), so a page cannot make the agent type a password elsewhere;
//   - every response: each secret value is replaced with <secret>NAME</secret>;
//   - browser_evaluate / browser_run_code_unsafe are removed (they could read a filled field).
// Without the header it is a plain pass-through to the browser.
import http from 'node:http';
import { secretsFromHeader, redact, logSession } from './secrets.mjs';

export { parseDotenv, secretsFromHeader, redact } from './secrets.mjs';

const PORT = Number(process.env.PORT || 8932);
const UPSTREAM = new URL(process.env.UPSTREAM || 'http://browser:8931/mcp');
// Playwright MCP checks the Host header (--allowed-hosts).
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || UPSTREAM.host;
const SECRETS_HEADER = 'x-pomocnik-secrets';
const BLOCKED_TOOLS = new Set(['browser_evaluate', 'browser_run_code_unsafe']);
const MAX_BODY = 1024 * 1024;

/**
 * Redacts an SSE stream event by event: a secret split across two chunks would pass a per-chunk
 * redaction, so only complete events (up to the last blank line) are written; the rest waits.
 */
export function streamRedactor(values) {
  const decoder = new TextDecoder();
  let pending = '';
  return {
    push(chunk) {
      pending += decoder.decode(chunk, { stream: true });
      const cut = Math.max(pending.lastIndexOf('\n\n'), pending.lastIndexOf('\r\n\r\n'));
      if (cut < 0) return '';
      const ready = pending.slice(0, cut + 2);
      pending = pending.slice(cut + 2);
      return redact(ready, values);
    },
    end() {
      const rest = pending + decoder.decode();
      pending = '';
      return redact(rest, values);
    },
  };
}

/** JSON-RPC messages in an MCP response body (JSON or SSE "data:" lines). */
function parseMessages(body, contentType) {
  if ((contentType || '').includes('text/event-stream')) {
    return body
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => {
        try {
          return JSON.parse(l.slice(5).trim());
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function forwardHeaders(req, extra = {}) {
  const headers = { ...req.headers, ...extra, host: UPSTREAM_HOST };
  delete headers[SECRETS_HEADER];
  delete headers['content-length'];
  delete headers['accept-encoding']; // we rewrite the body: keep it uncompressed
  delete headers.connection;
  return headers;
}

function upstreamRequest({ method, headers, body }) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { hostname: UPSTREAM.hostname, port: UPSTREAM.port || 80, path: UPSTREAM.pathname, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ res, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

let internalId = 0;

/** URL of the current tab of this MCP session (browser_tabs list), or null. */
async function currentTabUrl(req) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: `sejf-${++internalId}`,
    method: 'tools/call',
    params: { name: 'browser_tabs', arguments: { action: 'list' } },
  });
  const headers = forwardHeaders(req, { 'content-type': 'application/json' });
  const { res, body: out } = await upstreamRequest({ method: 'POST', headers, body });
  for (const msg of parseMessages(out, res.headers['content-type'])) {
    for (const part of msg?.result?.content ?? []) {
      const m = /\(current\)[^\n]*?\]\((\S+?)\)/.exec(part.text ?? '');
      if (m) return m[1];
    }
  }
  return null;
}

function rpcError(id, message) {
  return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: message }], isError: true } };
}

/**
 * Rewrites one tools/call: substitutes secret names in typed text when the tab is on an allowed
 * origin. Returns { message } to forward, or { reply } to answer without the browser.
 */
export async function rewriteCall(msg, secrets, getUrl) {
  const name = msg?.params?.name;
  if (BLOCKED_TOOLS.has(name)) {
    return { reply: rpcError(msg.id, `Narzędzie ${name} jest wyłączone w tej przeglądarce.`) };
  }
  const args = msg.params.arguments ?? {};
  const used = [];
  if (name === 'browser_type' && typeof args.text === 'string' && args.text in secrets.values) {
    used.push(args.text);
  }
  if (name === 'browser_fill_form' && Array.isArray(args.fields)) {
    for (const f of args.fields) {
      if (typeof f?.value === 'string' && f.value in secrets.values) used.push(f.value);
    }
  }
  if (used.length === 0) return { message: msg };

  let url = null;
  try {
    url = await getUrl();
  } catch {
    url = null;
  }
  let origin = null;
  try {
    origin = url ? new URL(url).origin : null;
  } catch {
    origin = null;
  }
  if (!origin || !secrets.origins.includes(origin)) {
    const allowed = secrets.origins.length ? secrets.origins.join(', ') : '(brak dozwolonych stron)';
    return {
      reply: rpcError(
        msg.id,
        `Sekret ${used.join(', ')} można wpisać tylko na stronach: ${allowed}. Bieżąca strona: ${url ?? 'nieznana'}.`,
      ),
    };
  }
  const copy = structuredClone(msg);
  const a = copy.params.arguments;
  if (name === 'browser_type') a.text = secrets.values[a.text];
  if (name === 'browser_fill_form') {
    for (const f of a.fields) {
      if (typeof f?.value === 'string' && f.value in secrets.values) f.value = secrets.values[f.value];
    }
  }
  return { message: copy };
}

/** Removes blocked tools from a tools/list result. */
function filterToolList(msg) {
  if (Array.isArray(msg?.result?.tools)) {
    msg.result.tools = msg.result.tools.filter((t) => !BLOCKED_TOOLS.has(t.name));
  }
  return msg;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendRpc(res, req, messages) {
  const accept = req.headers.accept || '';
  const payload = messages.length === 1 ? messages[0] : messages;
  if (accept.includes('text/event-stream') && !accept.includes('application/json')) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function handle(req, res) {
  const secrets = secretsFromHeader(req.headers[SECRETS_HEADER]);

  if (req.method !== 'POST') {
    // GET (server-to-client stream) and DELETE (end of session): stream through, redacting chunks.
    const r = http.request(
      {
        hostname: UPSTREAM.hostname,
        port: UPSTREAM.port || 80,
        path: UPSTREAM.pathname,
        method: req.method,
        headers: forwardHeaders(req),
      },
      (up) => {
        const headers = { ...up.headers };
        delete headers['content-length'];
        res.writeHead(up.statusCode, headers);
        const redactor = streamRedactor(secrets.values);
        up.on('data', (c) => res.write(redactor.push(c)));
        up.on('end', () => res.end(redactor.end()));
      },
    );
    r.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(r);
    return;
  }

  let body = await readBody(req);
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }

  if (parsed?.method === 'initialize') logSession('sejf', req, secrets);

  if (parsed && !Array.isArray(parsed) && parsed.method === 'tools/call') {
    const { message, reply } = await rewriteCall(parsed, secrets, () => currentTabUrl(req));
    if (reply) {
      sendRpc(res, req, [reply]);
      return;
    }
    body = JSON.stringify(message);
  }

  const { res: up, body: out } = await upstreamRequest({
    method: 'POST',
    headers: forwardHeaders(req, { 'content-type': req.headers['content-type'] || 'application/json' }),
    body,
  });

  let text = out;
  if (parsed && !Array.isArray(parsed) && parsed.method === 'tools/list') {
    const ct = up.headers['content-type'] || '';
    const msgs = parseMessages(out, ct).map(filterToolList);
    if (msgs.length) {
      text = ct.includes('text/event-stream')
        ? msgs.map((m) => `event: message\ndata: ${JSON.stringify(m)}\n\n`).join('')
        : JSON.stringify(msgs.length === 1 ? msgs[0] : msgs);
    }
  }
  text = redact(text, secrets.values);

  const headers = { ...up.headers };
  delete headers['content-length'];
  delete headers['transfer-encoding'];
  headers['content-length'] = Buffer.byteLength(text);
  res.writeHead(up.statusCode, headers);
  res.end(text);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  http
    .createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200).end('ok');
        return;
      }
      if (!req.url.startsWith('/mcp')) {
        res.writeHead(404).end();
        return;
      }
      handle(req, res).catch((err) => {
        console.error('[sejf]', err.message);
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
    })
    .listen(PORT, '::', () => console.log(`[sejf] :${PORT} -> ${UPSTREAM.href}`));
}
