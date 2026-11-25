import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const screenshots = process.env.DASHBOARD_QA_DIR;
if (screenshots) await mkdir(screenshots, { recursive: true });
const child = spawn(process.execPath, ['server/main.mjs'], {
  env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'],
});
const exit = once(child, 'exit');
let browser;

async function waitForUrl() {
  let output = '';
  for await (const chunk of child.stdout) {
    output += chunk;
    const match = output.match(/^http:\/\/127\.0\.0\.1:\d+$/m);
    if (match) return match[0];
  }
  throw new Error('Dashboard did not print a listening URL.');
}

try {
  const url = await Promise.race([
    waitForUrl(), delay(20_000, undefined, { ref: false }).then(() => { throw new Error('Startup timed out.'); }),
  ]);
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1020 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const snapshot = async () => (await fetch(url + '/api/state')).json();
  const frame = async (id, rev) => {
    const result = await fetch(url + '/api/frame/' + id + '?rev=' + rev);
    assert.equal(result.status, 200);
    return Buffer.from(await result.arrayBuffer());
  };
  async function doCommand(action) {
    const [response] = await Promise.all([
      page.waitForResponse(item => item.url().endsWith('/api/control')),
      action(),
    ]);
    assert.equal(response.status(), 200);
    return response.json();
  }

  await page.goto(url);
  await page.waitForFunction(() => [...document.images].filter(image => image.naturalWidth === 400).length === 8);
  const starting = await snapshot();
  assert.equal(starting.screens.length, 8);
  assert.ok(starting.screens.every(view => !view.playing && view.index === 0));
  const observed = await Promise.all(starting.screens.map(view => frame(view.id, view.revision)));
  for (const jpg of observed) assert.equal(jpg.subarray(0, 2).toString('hex'), 'ffd8');
  assert.notDeepEqual(observed[0], observed[1]);
  if (screenshots) await page.screenshot({ path: join(screenshots, 'screens-desktop.jpg'), type: 'jpeg', quality: 72, fullPage: true });

  const first = page.getByRole('article', { name: 'Screen 1', exact: true });
  const stepped = await doCommand(() => first.getByRole('button', { name: 'Next', exact: true }).click());
  assert.equal(stepped.screens[0].index, 1);
  assert.equal(stepped.screens[1].index, 0);
  assert.equal(stepped.total, 1);
  assert.notDeepEqual(await frame(1, stepped.screens[0].revision), observed[0]);
  const switched = await doCommand(() => first.getByLabel('Feed').selectOption('tiktok'));
  assert.equal(switched.screens[0].platform, 'tiktok');
  assert.equal(switched.screens[0].index, 0);
  await doCommand(() => first.getByLabel('Scroll every').selectOption('1500'));
  await doCommand(() => first.getByRole('button', { name: 'Play', exact: true }).click());
  await first.getByText('2 / 6', { exact: true }).waitFor();
  const paused = await doCommand(() => first.getByRole('button', { name: 'Pause', exact: true }).click());
  assert.equal(paused.screens[0].playing, false);
  assert.ok(paused.total >= 2);
  await delay(1700);
  assert.equal((await snapshot()).total, paused.total);
  const reset = await doCommand(() => first.getByRole('button', { name: 'Reset', exact: true }).click());
  assert.equal(reset.screens[0].index, 0);
  assert.equal(reset.total, paused.total);

  await page.getByRole('button', { name: 'Statistics' }).click();
  await page.getByRole('heading', { name: 'Scrolls by feed' }).waitFor();
  assert.equal(await page.locator('#platform-rows tr').count(), 3);
  assert.equal(await page.locator('#event-rows tr').count(), reset.total);
  assert.match(await page.locator('#event-rows').innerText(), /automatic/);
  if (screenshots) await page.screenshot({ path: join(screenshots, 'statistics-desktop.jpg'), type: 'jpeg', quality: 72, fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 880 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('button', { name: 'Screens' }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (width === 390 && screenshots) {
      await page.screenshot({ path: join(screenshots, 'screens-mobile.jpg'), type: 'jpeg', quality: 72 });
    }
    await page.getByRole('button', { name: 'Statistics' }).click();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: browser.version(), screens: 8, widths: [1440, 390, 320],
    realFrames: true, observedScroll: true, switchedFeed: true, scheduledPause: true, statistics: true }));
} finally {
  await browser?.close();
  if (child.exitCode === null) child.kill('SIGTERM');
  await exit;
}
