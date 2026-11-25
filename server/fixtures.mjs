export const PLATFORMS = Object.freeze({
  youtube: { name: 'YouTube', accent: '#ff9692', description: 'Video editing and studio workflows' },
  instagram: { name: 'Instagram', accent: '#e7a6d9', description: 'Short visual stories' },
  tiktok: { name: 'TikTok', accent: '#8be6dc', description: 'Quick vertical clips' },
});

export const DEFAULT_SCREENS = ['youtube', 'instagram', 'tiktok', 'youtube', 'instagram', 'tiktok', 'youtube', 'instagram'];

const TITLES = {
  youtube: ['Color grading in practice', 'Editing room notes', 'A quiet studio setup', 'From cut to final export', 'Lighting for small spaces', 'A better audio workflow'],
  instagram: ['A morning in the studio', 'Five frames from the coast', 'Paper and light', 'A short architecture walk', 'Behind the storyboard', 'Small details from today'],
  tiktok: ['A 30-second editing tip', 'Rhythm in three cuts', 'A tiny travel journal', 'Framing a moving subject', 'Three ways to light a scene', 'A one-take practice run'],
};

const SCENES = [
  ['#253955', '#7895b6', '#eaaf83'], ['#253c37', '#709680', '#bfc58c'],
  ['#392b46', '#a579a5', '#f9b6a2'], ['#39394e', '#858ab5', '#dfcba5'],
  ['#4b312c', '#ad7c61', '#e7bd87'], ['#244449', '#729ea5', '#dde0a7'],
];

export function itemsFor(platform, rotation) {
  const titles = TITLES[platform];
  return titles.map((_, index) => {
    const number = (index + rotation) % titles.length;
    return { title: titles[number], colors: SCENES[number] };
  });
}

export function fixtureHtml(platform, items) {
  const brand = PLATFORMS[platform];
  const sections = items.map((item, index) => {
    const [base, middle, light] = item.colors;
    return `<article style="--base:${base};--middle:${middle};--light:${light}">
      <div class="meta"><strong>${brand.name}</strong><span>Local feed</span></div>
      <div class="scene" aria-hidden="true"><div class="horizon"></div></div>
      <div class="caption"><span>${index + 1} / ${items.length}</span><h1>${item.title}</h1></div>
    </article>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${brand.name} fixture</title>
    <style>
      * { box-sizing: border-box; }
      html { scroll-snap-type: y mandatory; scrollbar-width: none; }
      body { margin: 0; color: #fff; font: 15px system-ui; background: #101113; }
      article { min-height: 100vh; scroll-snap-align: start; display: grid; grid-template-rows: auto 1fr auto;
        padding: 16px; gap: 12px; }
      .meta { display: flex; justify-content: space-between; align-items: baseline; }
      .meta strong { color: ${brand.accent}; }
      .meta span,.caption span { color: #d3d9e6; font-size: 12px; }
      .scene { position: relative; overflow: hidden; border-radius: 10px;
        background: radial-gradient(ellipse at 66% 22%, var(--light), transparent 36%),
        linear-gradient(148deg, var(--base), var(--middle)); }
      .horizon { position: absolute; inset: 48% -8% -12%; transform: rotate(-6deg);
        background: repeating-linear-gradient(167deg, var(--base), var(--middle) 17%, var(--base) 24%);
        opacity: .9; border-radius: 47% 53% 0 0; }
      h1 { font-size: 23px; letter-spacing: -.04em; margin: 3px 0 0; line-height: 1.15; }
      .caption { min-height: 62px; }
    </style></head><body>${sections}</body></html>`;
}
