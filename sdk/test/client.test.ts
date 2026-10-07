import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { NexusError, SDK_API_VERSION, bytesOf, connect } from '../src/index.js';

/** A stand-in for the app's API: the handshake, requests, errors, events and the close codes of docs/api/v1.md. */
let server: WebSocketServer;
let url = '';
const seen: Record<string, unknown>[] = [];
const sockets: ServerSocket[] = [];

before(async () => {
  server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((r) => server.on('listening', r));
  url = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  server.on('connection', (s) => {
    sockets.push(s);
    s.once('message', (raw) => {
      const hello = JSON.parse(String(raw));
      seen.push(hello);
      if (hello.token === 'bad') return s.close(4001, 'bad token');
      if (hello.api.split('.')[0] !== '1') return s.close(4002, 'api');
      if (hello.token === 'silent') return;
      s.send(JSON.stringify({ type: 'welcome', api: SDK_API_VERSION, role: 'ext:demo', scopes: ['signals.read'], methods: [], events: ['signal'], server: { name: 'nexus-studio', version: '5.0.0' } }));
      s.on('message', (r) => {
        const m = JSON.parse(String(r));
        seen.push(m);
        if (m.method === 'device.status') s.send(JSON.stringify({ type: 'response', id: m.id, result: { connected: false, kind: null } }));
        else if (m.method === 'signals.subscribe') {
          s.send(JSON.stringify({ type: 'response', id: m.id, result: { patterns: m.params.patterns } }));
          s.send(JSON.stringify({ type: 'event', event: 'signal', data: { source: 'system.layer', value: 2 } }));
        } else if (m.method === 'settings.get') s.send(JSON.stringify({ type: 'response', id: m.id, result: 'v' }));
        else if (m.method === 'profiles.write') s.send(JSON.stringify({ type: 'error', id: m.id, error: { code: 'forbidden', message: 'no', details: ['scope'] } }));
        // 'hang' is never answered
      });
    });
  });
});
after(() => { for (const s of sockets) s.terminate(); server.close(); });

const ok = () => ({ url, token: 'good', apiVersion: '1.15', name: 'demo', prefix: 'ext.demo:' });

test('the handshake sends hello with the token, version and client name, and returns what the app said', async () => {
  const nexus = await connect({ ...ok(), version: '0.3.0' });
  assert.deepEqual(seen.find((m) => m.type === 'hello'), { type: 'hello', api: '1.15', token: 'good', client: { name: 'demo', version: '0.3.0' } });
  assert.equal(nexus.welcome.role, 'ext:demo');
  assert.deepEqual(nexus.welcome.scopes, ['signals.read']);
  nexus.close();
  await nexus.closed;
});

test('a request is answered by its own id, and an API error keeps its code and details', async () => {
  const nexus = await connect(ok());
  assert.deepEqual(await nexus.call('device.status'), { connected: false, kind: null });
  await assert.rejects(nexus.call('profiles.write', { name: 'x' }), (e: unknown) => e instanceof NexusError && e.code === 'forbidden' && e.details[0] === 'scope');
  nexus.close();
});

test('subscribe sends the patterns and delivers signal events to the handler', async () => {
  const nexus = await connect(ok());
  const got: unknown[] = [];
  const off = await nexus.subscribe(['system.layer'], (s) => got.push(s.value));
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(got, [2]);
  assert.deepEqual(seen.filter((m) => m.method === 'signals.subscribe').at(-1)?.params, { patterns: ['system.layer'] });
  off();
  nexus.close();
});

test('settings use the extension prefix', async () => {
  const nexus = await connect(ok());
  assert.equal(await nexus.settings.get('mode'), 'v');
  assert.deepEqual(seen.filter((m) => m.method === 'settings.get').at(-1)?.params, { key: 'ext.demo:mode' });
  nexus.close();
});

test('a refused token rejects with bad_token, and an old major version with unsupported_api', async () => {
  await assert.rejects(connect({ ...ok(), token: 'bad' }), (e: unknown) => e instanceof NexusError && e.code === 'bad_token');
  await assert.rejects(connect({ ...ok(), apiVersion: '2.0' }), (e: unknown) => e instanceof NexusError && e.code === 'unsupported_api');
});

test('a silent app times out', async () => {
  await assert.rejects(connect({ ...ok(), token: 'silent', timeoutMs: 100 }), (e: unknown) => e instanceof NexusError && e.code === 'timeout');
});

test('when the connection ends, a waiting request rejects with closed and later calls refuse at once', async () => {
  const nexus = await connect(ok());
  const waiting = nexus.call('hang');
  await new Promise((r) => setTimeout(r, 30));
  for (const s of sockets) s.terminate();
  await assert.rejects(waiting, (e: unknown) => e instanceof NexusError && e.code === 'closed');
  await nexus.closed;
  await assert.rejects(nexus.call('device.status'), (e: unknown) => e instanceof NexusError && e.code === 'closed');
});

test('missing environment says the app starts extensions, instead of failing obscurely', async () => {
  const keep = { u: process.env.NEXUS_API_URL, t: process.env.NEXUS_API_TOKEN };
  delete process.env.NEXUS_API_URL;
  delete process.env.NEXUS_API_TOKEN;
  try {
    await assert.rejects(connect(), (e: unknown) => e instanceof NexusError && e.code === 'not_started_by_app' && /Turn the extension on/.test(e.message));
  } finally {
    if (keep.u) process.env.NEXUS_API_URL = keep.u;
    if (keep.t) process.env.NEXUS_API_TOKEN = keep.t;
  }
});

test('bytesOf reads the API binary values and nothing else', () => {
  assert.deepEqual([...bytesOf({ $bytes: '00ff10' })!], [0, 255, 16]);
  assert.equal(bytesOf({ $bytes: 'xyz' }), null);
  assert.equal(bytesOf({ $bytes: 'abc' }), null);
  assert.equal(bytesOf(5), null);
});
