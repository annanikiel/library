/* Library — a static, no-build browser over JSON files kept in the repo. */

const REPO = { owner: 'annanikiel', name: 'library', branch: 'main' };

/* Collections = tabs. Facet *options* are derived from the data, so new values
   (a new yoga style, a new tag) work as soon as they appear in the JSON —
   `order` only fixes the display order of the ones we already know about. */
const COLLECTIONS = [
  {
    id: 'yoga',
    label: 'Yoga',
    file: 'data/yoga.json',
    blurb: 'Classes worth coming back to.',
    facets: [
      { key: 'style', label: 'Style', order: ['yin', 'hatha', 'vinyasa', 'flow', 'power', 'restorative', 'prenatal'] },
      { key: 'timeOfDay', label: 'Time of day', list: true, order: ['morning', 'midday', 'afternoon', 'evening', 'wind-down', 'anytime'] },
      { key: '_duration', label: 'Length' },
      { key: 'tags', label: 'Tags', list: true },
    ],
  },
  {
    id: 'meditation',
    label: 'Meditation',
    file: 'data/meditation.json',
    blurb: 'Sits, breathwork and sleep tracks.',
    facets: [
      { key: 'type', label: 'Type', order: ['breath', 'body scan', 'loving-kindness', 'visualisation', 'mantra', 'sleep', 'unguided'] },
      { key: 'timeOfDay', label: 'Time of day', list: true, order: ['morning', 'midday', 'afternoon', 'evening', 'wind-down', 'anytime'] },
      { key: '_duration', label: 'Length' },
      { key: 'tags', label: 'Tags', list: true },
    ],
  },
  {
    id: 'challenge',
    label: '30 Day Challenge',
    file: 'data/challenge.json',
    blurb: "Morning Yoga Movement — Yoga with Kassandra's 30 day challenge, in order.",
    playlist: 'https://www.youtube.com/playlist?list=PLW0v0k7UCVrlLpvX-rz-mrGCoElFpj44D',
    ordered: true,    // entries carry `position`, so playlist order is offered
    progress: true,   // tick boxes, remembered per device
    facets: [
      { key: 'tags', label: 'Focus', list: true },
      { key: '_duration', label: 'Length' },
    ],
  },
];

const SORTS = [
  ['position', 'Playlist order'],
  ['added-desc', 'Recently added'],
  ['duration-asc', 'Shortest first'],
  ['duration-desc', 'Longest first'],
  ['title-asc', 'Title A–Z'],
];

const BUCKETS = [
  { label: 'Under 15 min', test: (m) => m < 15 },
  { label: '15–30 min', test: (m) => m >= 15 && m < 30 },
  { label: '30–45 min', test: (m) => m >= 30 && m < 45 },
  { label: '45–60 min', test: (m) => m >= 45 && m < 60 },
  { label: '60 min +', test: (m) => m >= 60 },
];

const state = {
  collection: COLLECTIONS[0].id,
  query: '',
  sort: 'added-desc',
  favOnly: false,
  filters: {},          // { facetKey: Set(values) }
  status: 'all',        // all | todo | done, for collections that track progress
  done: new Set(),      // ids ticked off in the current collection
  doneFor: null,        // which collection `done` was loaded for
};

const cache = new Map();  // collection id -> { items } | { error }
const $ = (sel) => document.querySelector(sel);

/* ---------------- helpers ---------------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const collection = () => COLLECTIONS.find((c) => c.id === state.collection);

function durationBucket(min) {
  if (typeof min !== 'number' || Number.isNaN(min)) return null;
  const b = BUCKETS.find((x) => x.test(min));
  return b ? b.label : null;
}

/* Values an item contributes to a facet, always as an array. */
function valuesOf(item, facet) {
  if (facet.key === '_duration') {
    const b = durationBucket(item.durationMin);
    return b ? [b] : [];
  }
  const raw = item[facet.key];
  if (raw == null || raw === '') return [];
  return (Array.isArray(raw) ? raw : [raw]).map((v) => String(v).trim()).filter(Boolean);
}

function optionsFor(items, facet) {
  const counts = new Map();
  for (const item of items) {
    for (const v of valuesOf(item, facet)) counts.set(v, (counts.get(v) || 0) + 1);
  }
  const known = facet.key === '_duration' ? BUCKETS.map((b) => b.label) : (facet.order || []);
  const seen = [...counts.keys()];
  const ordered = known.filter((v) => counts.has(v));
  const rest = seen.filter((v) => !known.includes(v)).sort((a, b) => a.localeCompare(b));
  return [...ordered, ...rest].map((v) => ({ value: v, count: counts.get(v) }));
}

function youtubeId(url) {
  if (!url) return null;
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/
  );
  return m ? m[1] : null;
}

function formatDuration(min) {
  if (typeof min !== 'number' || Number.isNaN(min)) return '';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 1800);
}

async function copyText(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // clipboard API needs a secure context; fall back for file:// and http.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* nothing else to try */ }
    ta.remove();
  }
  toast(msg);
}

/* ---------------- progress (per device) ----------------

   Ticks live in localStorage, never in the repo: they are personal and they
   change far too often to be worth a commit each. GitHub Pages user sites all
   share one origin, hence the `library:` prefix on the key. */

const storeKey = (colId) => `library:progress:v1:${colId}`;

const itemId = (item) => item.id || youtubeId(item.url) || item.url || item.title;

function loadDone(colId) {
  try {
    const raw = localStorage.getItem(storeKey(colId));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();   // private browsing, or storage disabled
  }
}

function saveDone(colId, set) {
  try {
    localStorage.setItem(storeKey(colId), JSON.stringify([...set]));
    return true;
  } catch {
    return false;
  }
}

function syncDone(col) {
  if (state.doneFor !== col.id) {
    state.done = loadDone(col.id);
    state.doneFor = col.id;
  }
}

const defaultSort = (col) => (col.ordered ? 'position' : 'added-desc');

/* ---------------- data ---------------- */

async function load(col) {
  if (cache.has(col.id)) return cache.get(col.id);
  let result;
  try {
    const res = await fetch(col.file, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const items = await res.json();
    if (!Array.isArray(items)) throw new Error('expected a JSON array');
    result = { items };
  } catch (err) {
    result = { error: err.message || String(err) };
  }
  cache.set(col.id, result);
  return result;
}

/* ---------------- URL state ---------------- */

function writeHash() {
  const p = new URLSearchParams();
  if (state.query) p.set('q', state.query);
  if (state.sort !== defaultSort(collection())) p.set('sort', state.sort);
  if (state.favOnly) p.set('fav', '1');
  if (state.status !== 'all') p.set('status', state.status);
  for (const [key, set] of Object.entries(state.filters)) {
    if (set && set.size) p.set(key, [...set].join('|'));
  }
  const qs = p.toString();
  const hash = `#${state.collection}${qs ? `?${qs}` : ''}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

function readHash() {
  const raw = location.hash.slice(1);
  if (!raw) return;
  const [id, qs] = raw.split('?');
  if (COLLECTIONS.some((c) => c.id === id)) state.collection = id;
  state.filters = {};
  const p = new URLSearchParams(qs || '');
  state.query = p.get('q') || '';
  state.sort = p.get('sort') || defaultSort(collection());
  state.favOnly = p.get('fav') === '1';
  state.status = ['todo', 'done'].includes(p.get('status')) ? p.get('status') : 'all';
  for (const facet of collection().facets) {
    const v = p.get(facet.key);
    if (v) state.filters[facet.key] = new Set(v.split('|'));
  }
}

/* ---------------- filtering ---------------- */

function matchesFacets(item, facets, skipKey) {
  for (const facet of facets) {
    if (facet.key === skipKey) continue;
    const selected = state.filters[facet.key];
    if (!selected || !selected.size) continue;
    const values = valuesOf(item, facet);
    if (!values.some((v) => selected.has(v))) return false;   // OR within a facet
  }
  return true;                                                // AND across facets
}

function matchesQuery(item) {
  if (!state.query) return true;
  const needle = state.query.toLowerCase();
  const hay = [item.title, item.channel, item.notes, ...(item.tags || [])]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(needle);
}

function matchesStatus(item) {
  if (!collection().progress || state.status === 'all') return true;
  const done = state.done.has(itemId(item));
  return state.status === 'done' ? done : !done;
}

function visibleItems(items, skipKey) {
  const facets = collection().facets;
  return items.filter((it) =>
    (!state.favOnly || it.favourite) && matchesStatus(it) && matchesQuery(it)
    && matchesFacets(it, facets, skipKey)
  );
}

function sortItems(items) {
  const list = [...items];
  const num = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : Infinity);
  switch (state.sort) {
    case 'position':
      return list.sort((a, b) => num(a.position) - num(b.position));
    case 'duration-asc':
      return list.sort((a, b) => num(a.durationMin) - num(b.durationMin));
    case 'duration-desc':
      return list.sort((a, b) => num(b.durationMin) - num(a.durationMin));
    case 'title-asc':
      return list.sort((a, b) => String(a.title).localeCompare(String(b.title)));
    default:
      return list.sort((a, b) => String(b.added || '').localeCompare(String(a.added || '')));
  }
}

/* ---------------- rendering ---------------- */

function renderTabs() {
  $('#tabs').innerHTML = COLLECTIONS.map((c) => `
    <button class="tab" role="tab" type="button" data-id="${c.id}"
            aria-selected="${c.id === state.collection}">${esc(c.label)}</button>
  `).join('');
}

function renderSort(col) {
  const sel = $('#sort');
  const opts = SORTS.filter(([v]) => v !== 'position' || col.ordered);
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  if (!opts.some(([v]) => v === state.sort)) state.sort = defaultSort(col);
  sel.value = state.sort;
}

const STATUSES = [['all', 'All'], ['todo', 'To do'], ['done', 'Done']];

function renderProgress(col, items) {
  const host = $('#progress');
  if (!col.progress) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  const done = items.filter((i) => state.done.has(itemId(i))).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  host.hidden = false;
  host.innerHTML = `
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${items.length}"
         aria-valuenow="${done}" aria-label="Worked through"><span style="width:${pct}%"></span></div>
    <div class="progress-row">
      <strong class="progress-count">${done} of ${items.length} done</strong>
      <span class="statuses">
        ${STATUSES.map(([v, l]) => `
          <button class="chip" type="button" data-status="${v}"
                  aria-pressed="${state.status === v}">${esc(l)}</button>`).join('')}
      </span>
      ${done ? '<button class="btn btn-quiet" id="reset-progress" type="button">Reset</button>' : ''}
    </div>`;
}

function renderFacets(items) {
  const host = $('#facets');
  host.innerHTML = collection().facets.map((facet) => {
    // Count against everything else that is filtered, so numbers stay useful.
    const pool = visibleItems(items, facet.key);
    const options = optionsFor(pool, facet);
    const selected = state.filters[facet.key] || new Set();
    // Keep a chosen value visible even when the current pool has none left.
    for (const v of selected) {
      if (!options.some((o) => o.value === v)) options.push({ value: v, count: 0 });
    }
    if (!options.length) return '';
    return `
      <div class="facet">
        <span class="facet-label">${esc(facet.label)}</span>
        ${options.map((o) => `
          <button class="chip" type="button" data-facet="${esc(facet.key)}" data-value="${esc(o.value)}"
                  aria-pressed="${selected.has(o.value)}">${esc(o.value)}<span class="n">${o.count}</span></button>
        `).join('')}
      </div>`;
  }).join('');
}

function cardHTML(item) {
  const col = collection();
  const vid = youtubeId(item.url);
  const thumb = vid ? `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` : null;
  const dur = formatDuration(item.durationMin);
  const id = itemId(item);
  const done = col.progress && state.done.has(id);
  const chips = collection().facets
    .filter((f) => f.key !== '_duration' && f.key !== 'tags')
    .flatMap((f) => valuesOf(item, f).map((v) => ({ facet: f.key, value: v, primary: true })))
    .concat((item.tags || []).map((v) => ({ facet: 'tags', value: v, primary: false })));

  // The tick sits outside the link so that ticking never opens the video.
  return `
    <article class="card ${done ? 'is-done' : ''}">
      <div class="thumb">
        <a class="thumb-link" href="${esc(item.url)}" target="_blank" rel="noopener">
          ${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : ''}
        </a>
        ${item.favourite ? '<span class="star" title="Favourite">★</span>' : ''}
        ${dur ? `<span class="dur">${esc(dur)}</span>` : ''}
        ${col.progress ? `
          <button class="tick" type="button" data-id="${esc(id)}" aria-pressed="${done}"
                  title="${done ? 'Mark as not done' : 'Mark as done'}"
                  aria-label="${done ? 'Mark as not done' : 'Mark as done'}">✓</button>` : ''}
      </div>
      <div class="card-body">
        <h3 class="card-title">
          ${item.day != null ? `<span class="day">Day ${esc(item.day)}</span>` : ''}
          <a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a>
        </h3>
        ${item.channel ? `<div class="meta">${esc(item.channel)}</div>` : ''}
        ${item.notes ? `<p class="notes">${esc(item.notes)}</p>` : ''}
        <div class="card-tags">
          ${chips.map((c) => `
            <button class="tag ${c.primary ? 'is-style' : ''}" type="button"
                    data-facet="${esc(c.facet)}" data-value="${esc(c.value)}">${esc(c.value)}</button>
          `).join('')}
        </div>
      </div>
    </article>`;
}

async function render() {
  const col = collection();
  syncDone(col);
  renderTabs();
  renderSort(col);
  $('#blurb').textContent = col.blurb;
  $('#search').value = state.query;
  $('#fav-only').checked = state.favOnly;
  $('#foot-links').innerHTML =
    `Data lives in <a href="https://github.com/${REPO.owner}/${REPO.name}/blob/${REPO.branch}/${col.file}"
      target="_blank" rel="noopener"><code>${esc(col.file)}</code></a>.`
    + (col.playlist
      ? ` From <a href="${esc(col.playlist)}" target="_blank" rel="noopener">this playlist ↗</a>.`
      : '')
    + (col.progress ? ' Ticks are saved on this device only.' : '');

  const data = await load(col);
  const grid = $('#grid');
  const empty = $('#empty');

  if (data.error) {
    $('#facets').innerHTML = '';
    $('#progress').hidden = true;
    $('#count').textContent = '';
    $('#clear').hidden = true;
    grid.innerHTML = '';
    empty.hidden = false;
    empty.innerHTML = `
      <p>Couldn't load <code>${esc(col.file)}</code> — ${esc(data.error)}.</p>
      <p>Opening <code>index.html</code> straight from the filesystem blocks the fetch.
         Run <code>python3 -m http.server</code> in this folder and visit
         <code>http://localhost:8000</code>.</p>`;
    return;
  }

  renderProgress(col, data.items);
  renderFacets(data.items);
  const shown = sortItems(visibleItems(data.items));
  const active = Object.values(state.filters).some((s) => s && s.size)
    || state.query || state.favOnly || state.status !== 'all';

  $('#count').textContent = `${shown.length} of ${data.items.length}`;
  $('#clear').hidden = !active;

  grid.innerHTML = shown.map(cardHTML).join('');
  empty.hidden = shown.length > 0;
  if (!shown.length) {
    empty.innerHTML = data.items.length
      ? (state.status === 'done'
        ? '<p>Nothing ticked off yet.</p>'
        : state.status === 'todo'
          ? '<p>All done — the whole list is ticked off. 🎉</p>'
          : '<p>Nothing matches those filters.</p>')
      : `<p>Nothing here yet — hit <strong>+ Add</strong>, or edit
         <code>${esc(col.file)}</code> on GitHub.</p>`;
  }
  writeHash();
}

/* ---------------- add-entry dialog ---------------- */

function entryFields(col) {
  const facetFields = col.facets
    .filter((f) => f.key !== '_duration')
    .map((f) => ({
      key: f.key,
      label: f.label,
      type: 'text',
      list: !!f.list,
      hint: f.list ? 'Comma separated' : '',
    }));
  return [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'url', label: 'YouTube link', type: 'url' },
    { key: 'channel', label: 'Channel', type: 'text' },
    { key: 'durationMin', label: 'Duration (minutes)', type: 'number' },
    ...facetFields,
    { key: 'notes', label: 'Notes', type: 'textarea' },
    { key: 'favourite', label: 'Favourite', type: 'checkbox' },
  ];
}

function renderAddForm(col, items) {
  $('#add-title').textContent = `Add to ${col.label}`;
  $('#edit-link').href =
    `https://github.com/${REPO.owner}/${REPO.name}/edit/${REPO.branch}/${col.file}`;

  const suggestions = {};
  for (const facet of col.facets) {
    if (facet.key === '_duration') continue;
    suggestions[facet.key] = optionsFor(items, facet).map((o) => o.value);
  }

  $('#add-fields').innerHTML = entryFields(col).map((f) => {
    const id = `f-${f.key}`;
    const listId = suggestions[f.key] ? `list-${f.key}` : '';
    const datalist = listId
      ? `<datalist id="${listId}">${suggestions[f.key].map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`
      : '';
    if (f.type === 'textarea') {
      return `<div class="field"><label for="${id}">${esc(f.label)}</label>
              <textarea id="${id}" data-key="${esc(f.key)}"></textarea></div>`;
    }
    if (f.type === 'checkbox') {
      return `<div class="field"><label class="toggle">
              <input type="checkbox" id="${id}" data-key="${esc(f.key)}"> <span>★ ${esc(f.label)}</span>
              </label></div>`;
    }
    return `<div class="field">
      <label for="${id}">${esc(f.label)}${f.hint ? ` <span class="sub">· ${esc(f.hint)}</span>` : ''}</label>
      <input type="${f.type}" id="${id}" data-key="${esc(f.key)}" data-list="${f.list ? '1' : ''}"
             ${listId ? `list="${listId}"` : ''} autocomplete="off">
      ${datalist}
    </div>`;
  }).join('');
}

function buildEntry(col) {
  const entry = {};
  const read = (key) => $(`#f-${key}`);

  entry.title = read('title').value.trim();
  entry.url = read('url').value.trim();
  const channel = read('channel').value.trim();
  if (channel) entry.channel = channel;
  const mins = parseInt(read('durationMin').value, 10);
  if (!Number.isNaN(mins)) entry.durationMin = mins;

  for (const facet of col.facets) {
    if (facet.key === '_duration') continue;
    const raw = read(facet.key).value.trim();
    if (!raw) continue;
    entry[facet.key] = facet.list
      ? raw.split(',').map((s) => s.trim()).filter(Boolean)
      : raw;
  }

  const notes = read('notes').value.trim();
  if (notes) entry.notes = notes;
  if (read('favourite').checked) entry.favourite = true;
  entry.added = new Date().toISOString().slice(0, 10);
  return entry;
}

function refreshPreview(col) {
  $('#add-preview').textContent = JSON.stringify(buildEntry(col), null, 2);
}

function openAdd() {
  const col = collection();
  const data = cache.get(col.id);
  if (!data || data.error) { toast('Load the data file first'); return; }
  renderAddForm(col, data.items);
  refreshPreview(col);
  $('#add-dialog').showModal();
}

/* ---------------- events ---------------- */

function toggleDone(id) {
  if (state.done.has(id)) state.done.delete(id); else state.done.add(id);
  if (!saveDone(collection().id, state.done)) {
    toast("Couldn't save — private browsing?");
  }
  render();
}

function toggleFilter(key, value) {
  const set = state.filters[key] || new Set();
  if (set.has(value)) set.delete(value); else set.add(value);
  if (set.size) state.filters[key] = set; else delete state.filters[key];
  render();
}

function init() {
  readHash();

  $('#tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    state.collection = tab.dataset.id;
    state.filters = {};
    state.query = '';
    state.status = 'all';
    state.sort = defaultSort(collection());
    render();
  });

  $('#facets').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) toggleFilter(chip.dataset.facet, chip.dataset.value);
  });

  $('#grid').addEventListener('click', (e) => {
    const tick = e.target.closest('.tick');
    if (tick) { toggleDone(tick.dataset.id); return; }
    const tag = e.target.closest('.tag');
    if (tag) toggleFilter(tag.dataset.facet, tag.dataset.value);
  });

  $('#progress').addEventListener('click', (e) => {
    const status = e.target.closest('[data-status]');
    if (status) {
      state.status = status.dataset.status;
      render();
      return;
    }
    if (e.target.closest('#reset-progress')) {
      if (!confirm('Clear every tick in this list? It only affects this device.')) return;
      state.done = new Set();
      saveDone(collection().id, state.done);
      render();
    }
  });

  let debounce;
  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value;
    clearTimeout(debounce);
    debounce = setTimeout(render, 120);
  });

  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
  $('#fav-only').addEventListener('change', (e) => { state.favOnly = e.target.checked; render(); });

  $('#clear').addEventListener('click', () => {
    state.filters = {};
    state.query = '';
    state.favOnly = false;
    state.status = 'all';
    render();
  });

  $('#add-open').addEventListener('click', openAdd);
  $('#add-fields').addEventListener('input', () => refreshPreview(collection()));

  $('#copy-entry').addEventListener('click', () => {
    copyText(JSON.stringify(buildEntry(collection()), null, 2), 'Entry copied');
  });

  $('#copy-file').addEventListener('click', () => {
    const col = collection();
    const items = (cache.get(col.id) || {}).items || [];
    copyText(JSON.stringify([...items, buildEntry(col)], null, 2) + '\n', 'Whole file copied');
  });

  window.addEventListener('hashchange', () => { readHash(); render(); });

  render();
}

init();
