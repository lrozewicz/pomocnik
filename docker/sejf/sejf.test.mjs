// Unit tests for sejf.mjs: node --test docker/sejf/ (no dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDotenv, secretsFromHeader, redact } from './secrets.mjs';
import { rewriteCall, streamRedactor } from './sejf.mjs';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const HEADER = b64(
  [
    '# client X',
    'SEJF_ORIGINS=https://panel.example.com; https://admin.example.net/login',
    `PANEL_HASLO="Ta'jne \\"H\\\\a s&lo"`,
    "PANEL_LOGIN='klient-xyz'",
    'KROTKI=abc',
  ].join('\n'),
);

test('parseDotenv: quotes, escapes, comments', () => {
  const env = parseDotenv('A=1\n# x\nexport B="x\\ny \\"q\\""\nC=\'raw \\n\'\n bad line\n');
  assert.deepEqual(env, { A: '1', B: 'x\ny "q"', C: 'raw \\n' });
});

test('secretsFromHeader: origins normalised, SEJF_ keys are not secrets', () => {
  const s = secretsFromHeader(HEADER);
  assert.deepEqual(s.origins, ['https://panel.example.com', 'https://admin.example.net']);
  assert.equal(s.values.PANEL_HASLO, `Ta'jne "H\\a s&lo`);
  assert.equal(s.values.PANEL_LOGIN, 'klient-xyz');
  assert.equal('SEJF_ORIGINS' in s.values, false);
});

test('secretsFromHeader: missing or unresolved placeholder gives no secrets', () => {
  for (const v of [undefined, '', '{{POMOCNIK_SECRETS}}']) {
    assert.deepEqual(secretsFromHeader(v), { all: {}, values: {}, origins: [] });
  }
});

test('redact: raw, JS literal, URL-encoded and nested JSON spellings', () => {
  const { values } = secretsFromHeader(HEADER);
  const v = values.PANEL_HASLO;
  const samples = [
    v,
    `fill('${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')`,
    encodeURIComponent(v),
    JSON.stringify(JSON.stringify(JSON.stringify({ custname: v }))),
  ];
  for (const s of samples) {
    const out = redact(s, values);
    assert.ok(out.includes('<secret>PANEL_HASLO</secret>'), out);
    assert.ok(!out.includes("Ta'jne") && !out.includes('Ta\\'), out);
  }
});

test('redact: values shorter than 4 characters are left alone', () => {
  const { values } = secretsFromHeader(HEADER);
  assert.equal(redact('abc abcd', values), 'abc abcd');
});

const secrets = secretsFromHeader(HEADER);
const call = (name, args) => ({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } });

test('rewriteCall: blocked tools are answered without the browser', async () => {
  for (const name of ['browser_evaluate', 'browser_run_code_unsafe']) {
    const { reply } = await rewriteCall(call(name, {}), secrets, async () => 'https://panel.example.com/');
    assert.equal(reply.result.isError, true);
  }
});

test('rewriteCall: secret typed on an allowed origin is substituted', async () => {
  const msg = call('browser_type', { target: 'e5', text: 'PANEL_HASLO' });
  const { message } = await rewriteCall(msg, secrets, async () => 'https://panel.example.com/login?x=1');
  assert.equal(message.params.arguments.text, secrets.values.PANEL_HASLO);
  assert.equal(msg.params.arguments.text, 'PANEL_HASLO', 'the original message is not modified');
});

test('rewriteCall: secret on another origin (or unknown page) is refused', async () => {
  for (const url of ['https://evil.example.org/', 'https://panel.example.com.evil.org/', null]) {
    const { reply, message } = await rewriteCall(
      call('browser_type', { target: 'e5', text: 'PANEL_HASLO' }),
      secrets,
      async () => url,
    );
    assert.equal(message, undefined);
    assert.equal(reply.result.isError, true);
    assert.ok(!JSON.stringify(reply).includes("Ta'jne"));
  }
});

test('rewriteCall: fill_form substitutes only fields that name a secret', async () => {
  const { message } = await rewriteCall(
    call('browser_fill_form', {
      fields: [
        { name: 'login', type: 'textbox', target: 'e1', value: 'PANEL_LOGIN' },
        { name: 'note', type: 'textbox', target: 'e2', value: 'zwykły tekst' },
      ],
    }),
    secrets,
    async () => 'https://admin.example.net/panel',
  );
  assert.deepEqual(
    message.params.arguments.fields.map((f) => f.value),
    ['klient-xyz', 'zwykły tekst'],
  );
});

test('rewriteCall: text that is not a secret name passes without a tab check', async () => {
  let checked = false;
  const msg = call('browser_type', { target: 'e5', text: 'hello' });
  const { message } = await rewriteCall(msg, secrets, async () => {
    checked = true;
    return null;
  });
  assert.equal(message, msg);
  assert.equal(checked, false);
});

test('streamRedactor: a secret split across chunks is still redacted', () => {
  const { values } = secretsFromHeader(HEADER);
  const v = values.PANEL_LOGIN;
  const event = `event: message\ndata: {"text":"${v}"}\n\n`;
  const cut = event.indexOf(v) + 3;
  const r = streamRedactor(values);
  const out = r.push(Buffer.from(event.slice(0, cut))) + r.push(Buffer.from(event.slice(cut))) + r.end();
  assert.ok(!out.includes(v), out);
  assert.ok(out.includes('<secret>PANEL_LOGIN</secret>'), out);
});
