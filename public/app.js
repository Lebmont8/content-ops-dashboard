const labels = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok' };
const find = selector => document.querySelector(selector);
const template = find('#screen-template');
const grid = find('#screens');
const errorLine = find('#error');
const connection = find('#connection');
const cards = new Map();
const time = new Intl.DateTimeFormat('en-GB', { timeStyle: 'medium', timeZone: 'UTC' });
let state;
let pending = false;
let reading = false;
let version = 0;

function setText(element, value) {
  const text = String(value);
  if (element.textContent !== text) element.textContent = text;
}

function createCard(id) {
  const root = template.content.firstElementChild.cloneNode(true);
  const part = selector => root.querySelector(selector);
  const title = part('h2');
  title.id = 'screen-' + id;
  title.textContent = 'Screen ' + id;
  root.setAttribute('aria-labelledby', title.id);
  const card = {
    root, state: part('[data-state]'), image: part('img'), title: part('[data-title]'),
    position: part('[data-position]'), feed: part('[data-feed]'), cadence: part('[data-cadence]'),
    play: part('[data-play]'), error: part('[data-error]'),
  };
  card.feed.addEventListener('change', () => command(id, 'platform', card.feed.value));
  card.cadence.addEventListener('change', () => command(id, 'cadence', Number(card.cadence.value)));
  card.play.addEventListener('click', () => command(id, state.screens[id - 1].playing ? 'pause' : 'play'));
  part('[data-next]').addEventListener('click', () => command(id, 'next'));
  part('[data-reset]').addEventListener('click', () => command(id, 'reset'));
  grid.append(root);
  cards.set(id, card);
  return card;
}

function row(values) {
  const element = document.createElement('tr');
  for (const value of values) {
    const cell = document.createElement('td');
    cell.textContent = value;
    element.append(cell);
  }
  return element;
}

function render(snapshot) {
  state = snapshot;
  setText(connection, 'Local browser worker connected');
  for (const screen of snapshot.screens) {
    const card = cards.get(screen.id) ?? createCard(screen.id);
    const source = '/api/frame/' + screen.id + '?rev=' + screen.revision;
    if (card.image.getAttribute('src') !== source) card.image.src = source;
    card.image.alt = labels[screen.platform] + ' test feed: ' + screen.title;
    card.feed.value = screen.platform;
    card.cadence.value = String(screen.cadence);
    card.state.dataset.playing = screen.playing;
    setText(card.state, screen.playing ? 'Auto-scrolling' : 'Paused');
    setText(card.play, screen.playing ? 'Pause' : 'Play');
    setText(card.title, screen.title);
    setText(card.position, (screen.index + 1) + ' / ' + screen.length);
    setText(card.error, screen.error ?? '');
  }

  setText(find('#total'), snapshot.total);
  setText(find('#playing'), snapshot.screens.filter(screen => screen.playing).length);
  setText(find('#screen-count'), snapshot.screens.length);
  find('#platform-rows').replaceChildren(...snapshot.platforms.map(item =>
    row([labels[item.platform], item.manual, item.automatic, item.manual + item.automatic])));
  find('#empty-events').hidden = snapshot.events.length > 0;
  find('#event-rows').replaceChildren(...snapshot.events.map(item =>
    row([time.format(item.at), item.screen, labels[item.platform], item.source, item.position, item.title])));
}

async function request(path, options) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

async function read() {
  if (pending || reading) return;
  reading = true;
  const started = version;
  try {
    const snapshot = await request('/api/state');
    if (started === version) render(snapshot);
  } catch {
    if (started === version) setText(connection, 'Local browser worker unavailable');
  } finally {
    reading = false;
  }
}

async function command(screen, action, value) {
  if (pending) return;
  version++;
  pending = true;
  setText(errorLine, '');
  const controls = grid.querySelectorAll('button, select');
  controls.forEach(control => { control.disabled = true; });
  try {
    render(await request('/api/control', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ screen, command: action, value }),
    }));
  } catch (error) {
    setText(errorLine, error.message);
  } finally {
    pending = false;
    controls.forEach(control => { control.disabled = false; });
    void read();
  }
}

const views = [
  [find('#screens-tab'), find('#screens-panel')],
  [find('#statistics-tab'), find('#statistics-panel')],
];
for (const [button] of views) {
  button.addEventListener('click', () => {
    for (const [candidate, panel] of views) {
      panel.hidden = candidate !== button;
      if (candidate === button) candidate.setAttribute('aria-current', 'page');
      else candidate.removeAttribute('aria-current');
    }
  });
}

void read();
setInterval(read, 800);
