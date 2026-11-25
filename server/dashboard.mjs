import { DEFAULT_SCREENS, PLATFORMS } from './fixtures.mjs';

export const CADENCES = [1500, 3000, 6000];
const COMMANDS = new Set(['play', 'pause', 'next', 'reset', 'platform', 'cadence']);

export function parseCommand(body) {
  if (!body || typeof body !== 'object' || !Number.isInteger(body.screen) ||
      body.screen < 1 || body.screen > DEFAULT_SCREENS.length || !COMMANDS.has(body.command)) {
    throw new RangeError('Choose a valid screen and command.');
  }
  if (body.command === 'platform' && (typeof body.value !== 'string' || !Object.hasOwn(PLATFORMS, body.value))) {
    throw new RangeError('Choose YouTube, Instagram, or TikTok.');
  }
  if (body.command === 'cadence' && !CADENCES.includes(body.value)) {
    throw new RangeError('Choose a supported cadence.');
  }
  return { screen: body.screen, command: body.command, value: body.value };
}

export async function createDashboard(browser, { clock = Date.now } = {}) {
  const screens = [];
  const history = [];
  const groups = Object.fromEntries(Object.keys(PLATFORMS).map(id => [id, { manual: 0, automatic: 0 }]));
  let queue = Promise.resolve();
  let nextEvent = 1;
  let tickPending = false;
  let timer;
  let closed = false;

  function commitFrame(screen, capture) {
    screen.revision++;
    screen.capture = { index: capture.index, title: capture.title, length: capture.length };
    screen.frames.set(screen.revision, capture.image);
    if (screen.frames.size > 3) screen.frames.delete(screen.frames.keys().next().value);
    screen.error = null;
  }

  try {
    for (const [index, platform] of DEFAULT_SCREENS.entries()) {
      const driver = await browser.createScreen();
      const screen = { id: index + 1, platform, rotation: index, driver, frames: new Map(),
        revision: 0, cadence: 3000, due: null, scrolls: 0, error: null };
      commitFrame(screen, await driver.load(platform, index));
      screens.push(screen);
    }
  } catch (error) {
    await browser.close();
    throw error;
  }

  function serialize(work) {
    if (closed) return Promise.reject(new Error('Dashboard is closing.'));
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  }

  async function advance(screen, source) {
    const capture = await screen.driver.next();
    commitFrame(screen, capture);
    screen.scrolls++;
    groups[screen.platform][source]++;
    history.push({ id: nextEvent++, at: clock(), screen: screen.id, platform: screen.platform,
      source, position: capture.index + 1, title: capture.title });
    if (history.length > 60) history.shift();
    if (screen.due !== null) screen.due = clock() + screen.cadence;
  }

  function markFailure(screen) {
    screen.due = null;
    screen.error = 'Browser could not refresh. Reset this screen or change its feed.';
  }

  function snapshot() {
    const platforms = Object.entries(groups).map(([platform, counts]) => ({ platform, ...counts }));
    return {
      screens: screens.map(screen => ({
        id: screen.id, platform: screen.platform, playing: screen.due !== null, cadence: screen.cadence,
        revision: screen.revision, scrolls: screen.scrolls, error: screen.error, ...screen.capture,
      })),
      total: platforms.reduce((sum, row) => sum + row.manual + row.automatic, 0),
      platforms,
      events: [...history].reverse(),
    };
  }

  async function control(input) {
    const { screen: id, command, value } = parseCommand(input);
    return serialize(async () => {
      const screen = screens[id - 1];
      try {
        switch (command) {
          case 'play':
            if (screen.due === null) screen.due = clock() + screen.cadence;
            break;
          case 'pause':
            screen.due = null;
            break;
          case 'next':
            await advance(screen, 'manual');
            break;
          case 'reset':
            screen.due = null;
            commitFrame(screen, await screen.driver.reset());
            break;
          case 'platform':
            screen.due = null;
            commitFrame(screen, await screen.driver.load(value, screen.rotation));
            screen.platform = value;
            break;
          case 'cadence':
            screen.cadence = value;
            if (screen.due !== null) screen.due = clock() + value;
            break;
        }
      } catch {
        markFailure(screen);
        throw new Error(screen.error);
      }
      return snapshot();
    });
  }

  async function tick() {
    if (tickPending || closed || !screens.some(screen => screen.due !== null && screen.due <= clock())) return;
    tickPending = true;
    try {
      await serialize(async () => {
        for (const screen of screens) {
          if (screen.due === null || screen.due > clock()) continue;
          try {
            await advance(screen, 'automatic');
          } catch {
            markFailure(screen);
          }
        }
      });
    } finally {
      tickPending = false;
    }
  }

  return {
    snapshot, control, tick,
    start() {
      timer ??= setInterval(() => { void tick(); }, 200);
    },
    frame(id, revision) {
      const screen = screens[id - 1];
      return screen?.frames.get(revision ?? screen.revision);
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      await queue;
      await browser.close();
    },
  };
}
