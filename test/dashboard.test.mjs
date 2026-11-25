import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDashboard, parseCommand } from '../server/dashboard.mjs';
import { createHttp } from '../server/http.mjs';

function fakeBrowser() {
  return {
    async createScreen() {
      let platform = 'youtube';
      let index = 0;
      const capture = () => ({ title: platform + ' ' + index, index, length: 3,
        image: Buffer.from(platform + ':' + index) });
      return {
        async load(value) { platform = value; index = 0; return capture(); },
        async next() { index = (index + 1) % 3; return capture(); },
        async reset() { index = 0; return capture(); },
      };
    },
    async close() {},
  };
}

test('eight screens start paused with independent, versioned frames', async () => {
  const dashboard = await createDashboard(fakeBrowser());
  try {
    assert.equal(dashboard.snapshot().screens.length, 8);
    assert.ok(dashboard.snapshot().screens.every(screen => !screen.playing));
    const updated = await dashboard.control({ screen: 1, command: 'next' });
    assert.equal(updated.screens[0].index, 1);
    assert.equal(updated.screens[1].index, 0);
    assert.equal(updated.total, 1);
    assert.equal(dashboard.frame(1, 1).toString(), 'youtube:0');
    assert.equal(dashboard.frame(1, 2).toString(), 'youtube:1');
    assert.equal(dashboard.frame(9, 1), undefined);
  } finally {
    await dashboard.close();
  }
});

test('scheduled steps wait for cadence, pause reliably and keep historical feed attribution', async () => {
  let now = 0;
  const dashboard = await createDashboard(fakeBrowser(), { clock: () => now });
  const send = (command, value) => dashboard.control({ screen: 1, command, value });
  try {
    await send('cadence', 1500);
    await send('play');
    now = 1499;
    await dashboard.tick();
    assert.equal(dashboard.snapshot().total, 0);
    now = 1500;
    await Promise.all([dashboard.tick(), dashboard.tick()]);
    assert.equal(dashboard.snapshot().total, 1);
    await send('pause');
    now = 5000;
    await dashboard.tick();
    assert.equal(dashboard.snapshot().total, 1);
    await send('platform', 'tiktok');
    await send('next');
    const state = await send('reset');
    assert.deepEqual(state.platforms.map(row => [row.platform, row.manual, row.automatic]),
      [['youtube', 0, 1], ['instagram', 0, 0], ['tiktok', 1, 0]]);
    assert.equal(state.screens[0].index, 0);
    assert.equal(state.events[0].platform, 'tiktok');
  } finally {
    await dashboard.close();
  }
});

test('rejects unsupported commands, cadence values and arbitrary destinations', () => {
  for (const command of [
    null, { screen: 9, command: 'next' }, { screen: 1, command: 'navigate' },
    { screen: 2, command: 'platform', value: 'arbitrary' },
    { screen: 2, command: 'platform', value: ['youtube'] },
    { screen: 2, command: 'cadence', value: 100 },
  ]) assert.throws(() => parseCommand(command), RangeError);
});

test('HTTP serves a versioned frame and rejects cross-origin commands', async () => {
  const dashboard = await createDashboard(fakeBrowser());
  const server = await createHttp(dashboard);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  const body = JSON.stringify({ screen: 1, command: 'next' });
  try {
    const denied = await fetch(url + '/api/control', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://invalid.example' }, body,
    });
    assert.equal(denied.status, 403);
    await denied.text();
    const allowed = await fetch(url + '/api/control', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    const state = await allowed.json();
    assert.equal(state.total, 1);
    assert.equal(state.screens[0].revision, 2);
    const frame = await fetch(url + '/api/frame/1?rev=1');
    assert.equal(frame.headers.get('content-type'), 'image/jpeg');
    assert.equal(await frame.text(), 'youtube:0');
    const old = await fetch(url + '/api/frame/1?rev=99');
    assert.equal(old.status, 404);
    await old.text();
    const route = await fetch(url + '/');
    assert.equal(route.status, 200);
    assert.match(route.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(await route.text(), /Content Ops Dashboard/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await dashboard.close();
  }
});
