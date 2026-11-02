import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrackingService, normalizeTracking } from '../tracking.js';
import { createServer } from '../server.js';

const shipment = { number: 'TEST123456', track_info: {
  latest_status: { status: 'InTransit' },
  tracking: { providers: [{ provider: { name: 'Test carrier' }, events: [
    { time_iso: '2026-11-01T00:00:00Z', description: 'First event', location: 'Origin' },
    { time_iso: '2026-11-02T00:00:00Z', description: 'Second event', location: 'Hub' }
  ] }] }
} };
const reply = data => new Response(JSON.stringify({ code: 0, data }), { status: 200 });

test('normalization sorts real provider events and preserves their source', () => {
  const result = normalizeTracking(shipment);
  assert.equal(result.status, 'InTransit');
  assert.deepEqual(result.providers, ['Test carrier']);
  assert.deepEqual(result.events.map(e => e.description), ['Second event', 'First event']);
  assert.equal(result.events[0].location, 'Hub');
});
test('missing credential, invalid number and unsupported carriers never call provider', async () => {
  const track = createTrackingService({ apiKey: '', fetchImpl: () => { throw new Error('must not call'); } });
  await assert.rejects(track({ carrier: 'ups', number: 'TEST123456' }), e => e.status === 503);
  await assert.rejects(track({ carrier: 'ups', number: '<script>' }), e => e.status === 400);
  await assert.rejects(track({ carrier: 'maersk', number: 'TEST123456' }), e => e.status === 422);
});
test('registered shipment query uses server credential, caches result, does not register again', async () => {
  const calls = [];
  const track = createTrackingService({ apiKey: 'test-only-credential', fetchImpl: async (url, init) => {
    calls.push(url);
    assert.equal(init.headers['17token'], 'test-only-credential');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), [{ number: 'TEST123456' }]);
    return reply({ accepted: [shipment], rejected: [] });
  } });
  const first = await track({ carrier: 'ups', number: 'TEST123456' });
  const second = await track({ carrier: 'ups', number: 'TEST123456' });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].endsWith('/gettrackinfo'));
  assert.deepEqual(first, second);
  assert.ok(!JSON.stringify(first).includes('test-only-credential'));
});
test('Tongzhi selection queries the provider and returns its real source and events', async () => {
  const item = structuredClone(shipment);
  item.track_info.tracking.providers[0].provider.name = 'TZ';
  const track = createTrackingService({ apiKey: 'test-only', fetchImpl: async () => reply({ accepted: [item], rejected: [] }) });
  const result = await track({ carrier: 'tongzhi', number: 'TEST123456' });
  assert.deepEqual(result.providers, ['TZ']);
  assert.equal(result.events.length, 2);
  assert.equal(result.status, 'InTransit');
});
test('FedEx selection specifies its carrier code for registration and lookup', async () => {
  const actions = [];
  const track = createTrackingService({ apiKey: 'test-only', fetchImpl: async (url, init) => {
    assert.deepEqual(JSON.parse(init.body), [{ number: 'TEST123456', carrier: 100003 }]);
    actions.push(url.split('/').pop());
    return reply({ accepted: url.endsWith('/register') ? [{ number: 'TEST123456' }] : [], rejected: [] });
  } });
  await track({ carrier: 'fedex', number: 'TEST123456' });
  assert.deepEqual(actions, ['gettrackinfo', 'register', 'gettrackinfo']);
});
test('new shipment registers then queries; pending data does not invent events', async () => {
  const calls = [];
  const track = createTrackingService({ apiKey: 'test-only', fetchImpl: async url => {
    calls.push(url.split('/').pop());
    return reply({ accepted: url.endsWith('/register') ? [{ number: 'TEST123456' }] : [], rejected: [] });
  } });
  const result = await track({ carrier: '17track', number: 'TEST123456' });
  assert.deepEqual(calls, ['gettrackinfo', 'register', 'gettrackinfo']);
  assert.equal(result.status, 'Pending');
  assert.deepEqual(result.events, []);
});
test('already accepted shipment awaiting data is pending without duplicate registration', async () => {
  const actions = [];
  const track = createTrackingService({ apiKey: 'test-only', fetchImpl: async url => {
    actions.push(url.split('/').pop());
    return reply({ accepted: [{ number: 'TEST123456', track_info: null }], rejected: [] });
  } });
  const result = await track({ carrier: 'fedex', number: 'TEST123456' });
  assert.equal(result.status, 'Pending');
  assert.deepEqual(actions, ['gettrackinfo']);
});
test('registration rejection exposes only numeric provider code, not raw provider errors', async () => {
  const track = createTrackingService({ apiKey: 'test-only', fetchImpl: async url => reply({ accepted: [], rejected: url.endsWith('/register') ? [{ number: 'TEST123456', error: { code: -12345, message: 'private upstream details' } }] : [] }) });
  await assert.rejects(track({ carrier: 'fedex', number: 'TEST123456' }), e => e.status === 422 && e.message.includes('-12345') && !e.message.includes('private upstream details'));
});
test('provider authorization and schema errors are sanitized', async () => {
  for (const response of [new Response('private upstream text', { status: 401 }), new Response('not JSON'), reply({ accepted: [{ number: 'TEST123456', track_info: 'wrong' }] })]) {
    const track = createTrackingService({ apiKey: 'test-only', fetchImpl: async () => response });
    await assert.rejects(track({ carrier: 'ups', number: 'TEST123456' }), e => e.status === 502 && !e.message.includes('private upstream text'));
  }
});
test('HTTP tracking route enforces format, method, limits and protects internal failures', async t => {
  const server = createServer({ track: async input => { if (input.number === 'FAIL1234') throw new Error('private credential'); return normalizeTracking(shipment); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/track`;
  const post = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await post('bad-json')).status, 400);
  assert.equal((await post('null')).status, 400);
  const result = await post(JSON.stringify({ number: 'TEST123456', carrier: 'ups' }));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await result.json()).events.length, 2);
  const failure = await post(JSON.stringify({ number: 'FAIL1234' }));
  assert.equal(failure.status, 500);
  assert.ok(!(await failure.text()).includes('private credential'));
  let last;
  for (let i = 0; i < 10; i++) last = await post('{}');
  assert.equal(last.status, 429);
});
