// Unit tests for ssh.mjs and the public/secret split in secrets.mjs (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secretsFromHeader, isPublicName } from './secrets.mjs';
import { hostsFromSecrets, callTool } from './ssh.mjs';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const HEADER = b64(
  [
    'SSH_STARY_ADDR=jan@s1.mydevil.net',
    'SSH_STARY_KEY="-----BEGIN OPENSSH PRIVATE KEY-----\\nabc\\n-----END OPENSSH PRIVATE KEY-----"',
    'SSH_STARY_HOSTKEY="s1.mydevil.net ssh-ed25519 AAAA"',
    'SSH_NOWY_ADDR=jan@s2.mydevil.net:433',
    'SSH_NOWY_KEY="k2"',
    'SSH_BEZKLUCZA_ADDR=jan@s3.mydevil.net',
    'PANEL_HASLO=tajne123',
  ].join('\n'),
);

test('isPublicName: settings, addresses and host keys are public', () => {
  for (const n of ['SEJF_ORIGINS', 'SSH_X_ADDR', 'SSH_X_HOSTKEY']) assert.equal(isPublicName(n), true, n);
  for (const n of ['SSH_X_KEY', 'PANEL_HASLO', 'ADDR_HASLO']) assert.equal(isPublicName(n), false, n);
});

test('secretsFromHeader: public names are not secrets', () => {
  const s = secretsFromHeader(HEADER);
  assert.deepEqual(Object.keys(s.values).sort(), ['PANEL_HASLO', 'SSH_NOWY_KEY', 'SSH_STARY_KEY']);
  assert.equal(s.all.SSH_NOWY_ADDR, 'jan@s2.mydevil.net:433');
});

test('hostsFromSecrets: aliases, ports, keys; a host without a key is skipped', () => {
  const hosts = hostsFromSecrets(secretsFromHeader(HEADER).all);
  assert.deepEqual(Object.keys(hosts).sort(), ['nowy', 'stary']);
  assert.equal(hosts.stary.port, 22);
  assert.equal(hosts.nowy.port, 433);
  assert.ok(hosts.stary.key.startsWith('-----BEGIN') && hosts.stary.key.endsWith('\n'));
  assert.equal(hosts.stary.hostKey, 's1.mydevil.net ssh-ed25519 AAAA');
  assert.equal(hosts.nowy.hostKey, '');
});

test('callTool: ssh_hosts lists addresses, never keys', async () => {
  const r = await callTool('ssh_hosts', {}, secretsFromHeader(HEADER).all);
  const t = r.content[0].text;
  assert.match(t, /stary: jan@s1\.mydevil\.net:22\n/);
  assert.match(t, /nowy: jan@s2\.mydevil\.net:433 \(bez weryfikacji klucza hosta\)/);
  assert.ok(!t.includes('BEGIN') && !t.includes('k2'));
});

test('callTool: unknown alias and empty command are errors', async () => {
  const all = secretsFromHeader(HEADER).all;
  const r1 = await callTool('ssh_run', { host: 'inny', command: 'id' }, all);
  assert.equal(r1.isError, true);
  assert.match(r1.content[0].text, /Dostępne: stary, nowy/);
  const r2 = await callTool('ssh_run', { host: 'stary', command: ' ' }, all);
  assert.equal(r2.isError, true);
});
