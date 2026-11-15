// SSH for Pomocnik agents: a minimal MCP server (streamable HTTP, JSON responses, stateless) that
// runs commands on a client's servers with keys the model never sees.
//
// The client's secrets come in the X-Pomocnik-Secrets header (see secrets.mjs). One server = three
// names with the same alias X (letters, digits, _):
//   SSH_X_ADDR     user@host or user@host:port                     (required)
//   SSH_X_KEY      private key (OpenSSH format, newlines as \n)    (required)
//   SSH_X_HOSTKEY  known_hosts line(s) for host verification       (recommended; without it the
//                  first key the server shows is accepted, i.e. no protection against a MITM)
// Tools: ssh_hosts, ssh_run (one command, output + exit code), ssh_copy (tar stream from one
// server to another through this pod, for site migrations). Every output is redacted.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { secretsFromHeader, redact, logSession } from './secrets.mjs';

const PORT = Number(process.env.PORT || 8933);
const SECRETS_HEADER = 'x-pomocnik-secrets';
const MAX_OUTPUT = 60 * 1024; // per stream, the tail is kept (the end of a log is what matters)
const MAX_BODY = 256 * 1024;
const DEFAULT_TIMEOUT_S = 120;
const MAX_TIMEOUT_S = 1800;
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** Hosts defined in the secrets: { alias: { user, host, port, key, hostKey } }. */
export function hostsFromSecrets(values) {
  const hosts = {};
  for (const [name, value] of Object.entries(values)) {
    const m = /^SSH_([A-Z0-9_]+?)_ADDR$/.exec(name);
    if (!m) continue;
    const alias = m[1].toLowerCase();
    const a = /^([^@\s]+)@([^:\s]+)(?::(\d+))?$/.exec(value.trim());
    const key = values[`SSH_${m[1]}_KEY`];
    if (!a || !key) continue;
    hosts[alias] = {
      user: a[1],
      host: a[2],
      port: a[3] ? Number(a[3]) : 22,
      key: key.endsWith('\n') ? key : `${key}\n`,
      hostKey: values[`SSH_${m[1]}_HOSTKEY`] || '',
    };
  }
  return hosts;
}

/** Writes the key and known_hosts to a private temp dir; returns ssh args and a cleanup. */
function sshSetup(h) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-'));
  const keyFile = path.join(dir, 'key');
  const knownHosts = path.join(dir, 'known_hosts');
  fs.writeFileSync(keyFile, h.key, { mode: 0o600 });
  fs.writeFileSync(knownHosts, h.hostKey ? `${h.hostKey.trim()}\n` : '', { mode: 0o600 });
  const args = [
    '-i', keyFile,
    '-p', String(h.port),
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', `UserKnownHostsFile=${knownHosts}`,
    '-o', `StrictHostKeyChecking=${h.hostKey ? 'yes' : 'accept-new'}`,
    '-o', 'ConnectTimeout=20',
    '-o', 'ServerAliveInterval=30',
    '-o', 'LogLevel=ERROR',
    `${h.user}@${h.host}`,
  ];
  return { args, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function tail(buf) {
  return buf.length > MAX_OUTPUT
    ? `[... ${buf.length - MAX_OUTPUT} B cut ...]\n${buf.subarray(buf.length - MAX_OUTPUT).toString('utf8')}`
    : buf.toString('utf8');
}

/** Collects a stream into a buffer keeping at most 2*MAX_OUTPUT bytes (the tail). */
function collector() {
  let buf = Buffer.alloc(0);
  return {
    push(c) {
      buf = Buffer.concat([buf, c]);
      if (buf.length > 2 * MAX_OUTPUT) buf = buf.subarray(buf.length - 2 * MAX_OUTPUT);
    },
    get: () => buf,
  };
}

function runSsh(h, command, timeoutS, stdin) {
  return new Promise((resolve) => {
    const { args, cleanup } = sshSetup(h);
    const p = spawn('ssh', [...args, command], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = collector();
    const err = collector();
    p.stdout.on('data', (c) => out.push(c));
    p.stderr.on('data', (c) => err.push(c));
    if (stdin) p.stdin.end(stdin);
    else p.stdin.end();
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      p.kill('SIGKILL');
    }, timeoutS * 1000);
    p.on('close', (code) => {
      clearTimeout(t);
      cleanup();
      resolve({ code, timedOut, stdout: tail(out.get()), stderr: tail(err.get()) });
    });
  });
}

/** tar stream: ssh FROM "tar -C dir -cf - name" | ssh TO "mkdir -p dest && tar -C dest -xf -". */
function copySsh(from, to, fromPath, toDir, timeoutS) {
  return new Promise((resolve) => {
    const a = sshSetup(from);
    const b = sshSetup(to);
    const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
    const src = fromPath.replace(/\/+$/, '') || '/';
    const dir = path.posix.dirname(src);
    const base = path.posix.basename(src);
    const pa = spawn('ssh', [...a.args, `tar -C ${q(dir)} -cf - ${q(base)}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    const pb = spawn('ssh', [...b.args, `mkdir -p ${q(toDir)} && tar -C ${q(toDir)} -xf -`], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let bytes = 0;
    pa.stdout.on('data', (c) => (bytes += c.length));
    pa.stdout.pipe(pb.stdin);
    const errA = collector();
    const errB = collector();
    pa.stderr.on('data', (c) => errA.push(c));
    pb.stderr.on('data', (c) => errB.push(c));
    pb.stdout.resume();
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      pa.kill('SIGKILL');
      pb.kill('SIGKILL');
    }, timeoutS * 1000);
    let codeA = null;
    pa.on('close', (c) => (codeA = c));
    pb.on('close', (codeB) => {
      clearTimeout(t);
      a.cleanup();
      b.cleanup();
      resolve({ codeA, codeB, bytes, timedOut, stderrA: tail(errA.get()), stderrB: tail(errB.get()) });
    });
  });
}

const TOOLS = [
  {
    name: 'ssh_hosts',
    description: 'Lista serwerów SSH klienta (alias, użytkownik, adres). Klucze nie są pokazywane.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ssh_run',
    description:
      'Uruchamia jedno polecenie powłoki na serwerze klienta (ssh, bez terminala). Zwraca kod wyjścia, stdout i stderr (ostatnie 60 KB każdego). Polecenia interaktywne nie działają.',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Alias serwera z ssh_hosts' },
        command: { type: 'string', description: 'Polecenie powłoki' },
        timeout_s: { type: 'number', description: `Limit czasu w sekundach (domyślnie ${DEFAULT_TIMEOUT_S}, maks. ${MAX_TIMEOUT_S})` },
      },
      required: ['host', 'command'],
    },
  },
  {
    name: 'ssh_copy',
    description:
      'Kopiuje plik lub katalog z jednego serwera klienta na drugi (strumień tar, bez zapisu pośredniego). from_path zostaje utworzony wewnątrz to_dir pod tą samą nazwą; istniejące pliki są nadpisywane.',
    inputSchema: {
      type: 'object',
      properties: {
        from_host: { type: 'string', description: 'Alias serwera źródłowego' },
        from_path: { type: 'string', description: 'Ścieżka pliku lub katalogu na serwerze źródłowym' },
        to_host: { type: 'string', description: 'Alias serwera docelowego' },
        to_dir: { type: 'string', description: 'Katalog docelowy (zostanie utworzony)' },
        timeout_s: { type: 'number', description: `Limit czasu w sekundach (domyślnie 900, maks. ${MAX_TIMEOUT_S})` },
      },
      required: ['from_host', 'from_path', 'to_host', 'to_dir'],
    },
  },
];

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });
const clampTimeout = (v, def) => Math.min(Math.max(Number(v) || def, 1), MAX_TIMEOUT_S);

export async function callTool(name, args, entries) {
  const hosts = hostsFromSecrets(entries);
  const pick = (alias) => {
    const h = hosts[String(alias ?? '').toLowerCase()];
    if (!h) {
      const known = Object.keys(hosts).join(', ') || '(brak — administrator nie ustawił serwerów)';
      throw new Error(`Nieznany serwer "${alias}". Dostępne: ${known}`);
    }
    return h;
  };
  try {
    if (name === 'ssh_hosts') {
      const list = Object.entries(hosts).map(
        ([alias, h]) => `- ${alias}: ${h.user}@${h.host}:${h.port}${h.hostKey ? '' : ' (bez weryfikacji klucza hosta)'}`,
      );
      return text(list.length ? list.join('\n') : 'Brak serwerów SSH dla tego klienta.');
    }
    if (name === 'ssh_run') {
      if (typeof args?.command !== 'string' || !args.command.trim()) throw new Error('Puste polecenie');
      const r = await runSsh(pick(args.host), args.command, clampTimeout(args.timeout_s, DEFAULT_TIMEOUT_S));
      const head = r.timedOut ? 'Przekroczony limit czasu (proces zabity).' : `Kod wyjścia: ${r.code}`;
      return text(`${head}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`, r.code !== 0);
    }
    if (name === 'ssh_copy') {
      for (const k of ['from_path', 'to_dir']) {
        if (typeof args?.[k] !== 'string' || !args[k].trim()) throw new Error(`Brak ${k}`);
      }
      const r = await copySsh(pick(args.from_host), pick(args.to_host), args.from_path, args.to_dir, clampTimeout(args.timeout_s, 900));
      const ok = !r.timedOut && r.codeA === 0 && r.codeB === 0;
      return text(
        `${ok ? 'Skopiowano' : 'Błąd kopiowania'}: ${(r.bytes / 1048576).toFixed(1)} MB (tar)` +
          `${r.timedOut ? ', przekroczony limit czasu' : ''}\n` +
          `źródło: kod ${r.codeA}${r.stderrA ? `\n${r.stderrA}` : ''}\n` +
          `cel: kod ${r.codeB}${r.stderrB ? `\n${r.stderrB}` : ''}`,
        !ok,
      );
    }
    return text(`Nieznane narzędzie ${name}`, true);
  } catch (e) {
    return text(e.message, true);
  }
}

async function handleRpc(msg, entries) {
  if (msg.id === undefined || msg.id === null) return null; // notification
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'pomocnik-ssh', version: '1.0.0' },
        instructions:
          'Serwery SSH klienta. Najpierw ssh_hosts, potem ssh_run (jedno polecenie na wywołanie) albo ssh_copy (przeniesienie plików między serwerami). Klucze są poza Twoim zasięgiem; nie proś o nie.',
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call':
      return reply(await callTool(msg.params?.name, msg.params?.arguments ?? {}, entries));
    default:
      return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
  }
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
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handle(req, res) {
  if (req.method === 'GET') return res.writeHead(405, { allow: 'POST, DELETE' }).end();
  if (req.method === 'DELETE') return res.writeHead(200).end();
  if (req.method !== 'POST') return res.writeHead(405).end();
  const { all, values } = secretsFromHeader(req.headers[SECRETS_HEADER]);
  let parsed;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch {
    return res
      .writeHead(400, { 'content-type': 'application/json' })
      .end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
  }
  if (parsed?.method === 'initialize') logSession('ssh', req, secretsFromHeader(req.headers[SECRETS_HEADER]));
  const batch = Array.isArray(parsed);
  const replies = (await Promise.all((batch ? parsed : [parsed]).map((m) => handleRpc(m, all)))).filter(Boolean);
  if (replies.length === 0) return res.writeHead(202).end();
  const body = redact(JSON.stringify(batch ? replies : replies[0]), values);
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  http
    .createServer((req, res) => {
      if (req.url === '/health') return res.writeHead(200).end('ok');
      if (!req.url.startsWith('/mcp')) return res.writeHead(404).end();
      handle(req, res).catch((err) => {
        console.error('[ssh]', err.message);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    })
    .listen(PORT, '::', () => console.log(`[ssh] :${PORT}`));
}
