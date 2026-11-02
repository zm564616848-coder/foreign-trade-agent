import test from 'node:test';
import assert from 'node:assert/strict';
import { carriers, filterCarriers, parseTrackingNumbers, officialTrackingLink, supportsTrackingLink } from '../public/carriers.js';
import { createServer } from '../server.js';

test('directory includes all supplied carriers and clean official URLs', () => {
  assert.equal(carriers.length, 19);
  assert.equal(new Set(carriers.map(c => c.id)).size, 19);
  assert.deepEqual(['ocean', 'express', 'customs'].map(category => filterCarriers({ category }).length), [10, 5, 4]);
  for (const c of carriers) assert.ok(['http:', 'https:'].includes(new URL(c.url).protocol));
  assert.equal(new URL(carriers.find(c => c.id === 'oocl').url).pathname.endsWith('.aspx'), true);
});
test('search composes category, keyword and favorites filters', () => {
  assert.equal(filterCarriers({ query: ' MaErSk ' })[0].id, 'maersk');
  assert.equal(filterCarriers({ query: '中远' })[0].id, 'cosco');
  assert.equal(filterCarriers({ category: 'express', query: 'maersk' }).length, 0);
  assert.equal(filterCarriers({ favorites: [] }).length, 0);
  assert.deepEqual(filterCarriers({ favorites: ['dhl', 'one'], category: 'express' }).map(c => c.id), ['dhl']);
});
test('batch tracking accepts common separators, deduplicates and rejects unsafe or oversized input', () => {
  assert.deepEqual(parseTrackingNumbers('MSCU1234567\n1234567890，MSCU1234567; ABCD-1234'), ['MSCU1234567', '1234567890', 'ABCD-1234']);
  assert.deepEqual(parseTrackingNumbers('  '), []);
  assert.throws(() => parseTrackingNumbers('<script>alert(1)</script>'));
  assert.throws(() => parseTrackingNumbers('a'));
  assert.throws(() => parseTrackingNumbers(Array.from({ length: 21 }, (_, i) => `ABCD${i}`).join(' ')));
});
test('official query links carry the requested number on the intended destination', () => {
  const expected = {
    ups: ['www.ups.com', 'tracknum'],
    fedex: ['www.fedex.com', 'trknbr'],
    usps: ['tools.usps.com', 'tLabels'],
    dhl: ['www.dhl.com', 'tracking-id']
  };
  for (const [carrier, [host, param]] of Object.entries(expected)) {
    const link = officialTrackingLink(carrier, 'TEST123456789');
    const url = new URL(link.url);
    assert.equal(url.hostname, host);
    assert.equal(url.searchParams.get(param), 'TEST123456789');
    assert.equal(link.prefilled, true);
  }
  assert.equal(new URL(officialTrackingLink('17track', 'TEST123456789').url).hash, '#nums=TEST123456789');
  assert.deepEqual(officialTrackingLink('maersk', 'MSCU1234567'), { url: carriers[0].url, prefilled: false });
  assert.equal(officialTrackingLink('ups').prefilled, false);
  assert.equal(supportsTrackingLink('constructor'), false);
  assert.throws(() => officialTrackingLink('ups', 'ABC&tracknum=OTHER'));
  assert.throws(() => officialTrackingLink('unknown', 'ABCD1234'));
});
test('server delivers application, health, security headers and proper errors', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /物流查询工作台/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  for (const asset of ['app.js', 'carriers.js', 'style.css']) assert.equal((await fetch(`${base}/${asset}`)).status, 200);
  assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { status: 'ok', mode: 'official-links', carriers: 19 });
  assert.equal((await fetch(`${base}/missing`)).status, 404);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/.git/config`)).status, 404);
});
