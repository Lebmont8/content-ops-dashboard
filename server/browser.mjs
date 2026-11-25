import { chromium } from 'playwright';
import { fixtureHtml, itemsFor } from './fixtures.mjs';

const VIEWPORT = { width: 400, height: 330 };

export async function openBrowser(executablePath) {
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block' });
    // The worker only renders in-memory fixtures; deny all document and asset requests.
    await context.route('**/*', route => route.abort());
    return {
      async createScreen() {
        const page = await context.newPage();
        return screenDriver(page);
      },
      close: () => browser.close(),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

function screenDriver(page) {
  let items;

  async function position() {
    return page.evaluate(() => Math.round(window.scrollY / window.innerHeight));
  }

  async function frame() {
    const index = await position();
    if (!items?.[index]) throw new Error('Browser position is outside the fixture.');
    return {
      index, title: items[index].title, length: items.length,
      image: await page.screenshot({ type: 'jpeg', quality: 70, timeout: 2500 }),
    };
  }

  async function go(index) {
    await page.evaluate(next => window.scrollTo({ top: next * innerHeight, behavior: 'instant' }), index);
    await page.waitForFunction(next => Math.round(window.scrollY / innerHeight) === next, index, { timeout: 2000 });
    return frame();
  }

  return {
    async load(platform, rotation) {
      items = itemsFor(platform, rotation);
      await page.setContent(fixtureHtml(platform, items), { waitUntil: 'load', timeout: 2500 });
      return go(0);
    },
    async next() {
      const current = await position();
      const capture = await go((current + 1) % items.length);
      if (capture.index === current) throw new Error('Browser did not advance.');
      return capture;
    },
    reset: () => go(0),
  };
}
