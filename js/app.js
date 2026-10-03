"use strict";

const DATA = {};

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const nf = new Intl.NumberFormat('sv-SE');

const tooltip = $('#tooltip');
const svg = $('#mapSvg');

let mode = 'country';
let focusedCode = null;
let currentCountry = '';
let currentLookup = {};

let paths = [];
let mapGroup = null;
let originalViewBox = null;

const palette = [
  '#245e9b', '#1c7d5d', '#d0781b', '#7762b1', '#197d84', '#b95067',
  '#9a751b', '#4e6bb3', '#8d58a5', '#2c8db0', '#ac4d42', '#708d34',
  '#ae6c9b', '#397e9b', '#c37240', '#5a786e', '#867660'
];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function countryColor(name) {
  return palette[hash(name) % palette.length];
}

function hexRgb(h) {
  h = h.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

function mix(a, b, t) {
  const A = hexRgb(a);
  const B = hexRgb(b);

  return '#' + A.map((v, i) =>
    Math.round(v + (B[i] - v) * t)
      .toString(16)
      .padStart(2, '0')
  ).join('');
}

function share(count, code) {
  const p = DATA.pop[code]?.population || 0;
  return p && count ? 100 * count / p : 0;
}

function pct(count, code) {
  const v = share(count, code);

  return v < 0.1 && v > 0
    ? '<0,1 %'
    : v.toLocaleString('sv-SE', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      }) + ' %';
}

function topRows(code, n = 10) {
  return (DATA.top[code]?.top || [])
    .filter(r => r[1] > 0)
    .slice(0, n);
}

async function loadData() {
  const urls = [
    'data/municipalities.geojson',
    'data/municipality_top10.json',
    'data/country_municipality_2025.json',
    'data/municipality_population_2025.json',
    'data/country_sweden_total_2025.json'
  ];

  const [geo, topd, country, pop, totals] = await Promise.all(
    urls.map(u =>
      fetch(u).then(r => {
        if (!r.ok) throw Error(u);
        return r.json();
      })
    )
  );

  DATA.geo = geo;
  DATA.top = topd;
  DATA.country = country;
  DATA.pop = pop;
  DATA.totals = totals;
}

function mercY(lat) {
  const r = lat * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + r / 2));
}

function allCoords(geom) {
  const out = [];

  const walk = x => {
    if (Array.isArray(x) && typeof x[0] === 'number') {
      out.push(x);
    } else if (Array.isArray(x)) {
      x.forEach(walk);
    }
  };

  walk(geom.coordinates);
  return out;
}

function buildMap() {
  let xs = [];
  let ys = [];

  // Mercator använder både longitud och latitud i radianer
  function mercX(lon) {
    return lon * Math.PI / 180;
  }

  for (const f of DATA.geo.features) {
    for (const [lon, lat] of allCoords(f.geometry)) {
      xs.push(mercX(lon));
      ys.push(mercY(lat));
    }
  }

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const W = 1000;
  const H = 1250;
  const pad = 28;

  const sx = (W - 2 * pad) / (maxX - minX);
  const sy = (H - 2 * pad) / (maxY - minY);
  const s = Math.min(sx, sy);

  const ox = (W - (maxX - minX) * s) / 2;
  const oy = (H - (maxY - minY) * s) / 2;

  const point = ([lon, lat]) => [
    ox + (mercX(lon) - minX) * s,
    H - (oy + (mercY(lat) - minY) * s)
  ];

  const ringPath = ring =>
    ring.map((p, i) => {
      const [x, y] = point(p);
      return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ') + ' Z';

  const geomPath = g =>
    g.type === 'Polygon'
      ? g.coordinates.map(ringPath).join(' ')
      : g.coordinates
          .map(poly => poly.map(ringPath).join(' '))
          .join(' ');

  mapGroup = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'g'
  );

  svg.innerHTML = '';
  svg.appendChild(mapGroup);

  for (const f of DATA.geo.features) {
    const p = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'path'
    );

    p.setAttribute('d', geomPath(f.geometry));
    p.setAttribute('class', 'mun');

    p.dataset.code = f.properties.KnKod;
    p.dataset.name = f.properties.KnNamn;
    p.id = 'm-' + f.properties.KnKod;

    mapGroup.appendChild(p);
  }

  paths = $$('.mun');

  originalViewBox = [0, 0, W, H];
  svg.setAttribute('viewBox', originalViewBox.join(' '));

  bindMapEvents();
}

function fillSelectors() {
  const countries = Object.keys(DATA.country)
    .sort((a, b) => a.localeCompare(b, 'sv'));

  $('#countrySelect').innerHTML = countries
    .map(c => `<option value="${esc(c)}">${esc(c)}</option>`)
    .join('');

  currentCountry = countries.includes('Somalia')
    ? 'Somalia'
    : countries[0];

  $('#countrySelect').value = currentCountry;

  const ms = Object.entries(DATA.top)
    .sort((a, b) => a[1].name.localeCompare(b[1].name, 'sv'));

  $('#municipalitySelect').innerHTML = ms
    .map(([c, d]) =>
      `<option value="${c}">${esc(d.name)}</option>`
    )
    .join('');

  $('#municipalitySelect').value = ms[0][0];
}

function clearMap() {
  paths.forEach(p => {
    p.classList.remove('focus', 'top1', 'dim');
    p.style.fill = '';
    p.style.opacity = '1';
  });
}

function setFocus(code) {
  if (focusedCode) {
    document
      .getElementById('m-' + focusedCode)
      ?.classList.remove('focus');
  }

  focusedCode = code;

  document
    .getElementById('m-' + code)
    ?.classList.add('focus');
}

function renderCountry() {
  mode = 'country';

  clearMap();

  currentCountry = $('#countrySelect').value.trim();

  const rows = DATA.country[currentCountry] || [];
  const published = rows.filter(r => r[2] > 0);

  let n = Math.max(
    1,
    Math.min(
      290,
      parseInt($('#topN').value || 10)
    )
  );

  $('#topN').value = n;

  const selected = published.slice(0, n);
  const metric = $('#shadeMetric').value;

  currentLookup = {};

  published.forEach(r => {
    currentLookup[r[0]] = {
      name: r[1],
      count: r[2],
      rank: r[3]
    };
  });

  paths.forEach(p => p.classList.add('dim'));

  const vals = selected.map(r =>
    metric === 'share'
      ? share(r[2], r[0])
      : r[2]
  );

  const mn = Math.min(...vals);
  const mx = Math.max(...vals);

  selected.forEach((r, i) => {
    const p = document.getElementById('m-' + r[0]);

    if (!p) return;

    p.classList.remove('dim');

    if (i === 0) {
      p.classList.add('top1');
    }

    const v = metric === 'share'
      ? share(r[2], r[0])
      : r[2];

    const t = mx === mn
      ? 1
      : (v - mn) / (mx - mn);

    p.style.fill = mix(
      '#26384f',
      '#2d9fc2',
      0.24 + 0.76 * t
    );
  });

  const total = DATA.totals[currentCountry];

  $('#countrySummary').innerHTML = `
    <div class="summary-title">
      Personer födda i ${esc(currentCountry)}
    </div>

    <div class="statbox">
      <div class="num">
        ${total != null ? nf.format(total) : '—'}
      </div>

      <div class="lbl">
        Totalt antal personer födda i ${esc(currentCountry)} bosatta i Sverige
      </div>
    </div>

    <div class="privacy-note">
      <b>
        Exakt antal redovisas i ${nf.format(published.length)} kommuner
      </b>
      <br>
      SCB redovisar inte exakta småtal i övriga kommuner.
    </div>
  `;

  $('#countryResults').innerHTML = selected
    .map(r => `
      <div class="result-row" data-code="${r[0]}">
        <div class="rank">
          ${r[3]}
        </div>

        <div class="name">
          ${esc(r[1])}
        </div>

        <div>
          <div class="value">
            ${nf.format(r[2])} personer
          </div>

          <div class="subvalue">
            ${pct(r[2], r[0])} av kommunen
          </div>
        </div>
      </div>
    `)
    .join('');

  $$('#countryResults .result-row').forEach(el => {
    el.onclick = () => {
      setFocus(el.dataset.code);
      zoomTo(el.dataset.code);
    };
  });

  $('#legendText').textContent =
    `Top ${Math.min(n, published.length)} · färgintensitet = ${
      metric === 'share' ? 'andel' : 'antal'
    }`;
}

function renderMunicipality() {
  mode = 'municipality';

  clearMap();

  currentLookup = {};

  for (const p of paths) {
    const t = topRows(p.dataset.code, 1)[0];

    p.style.fill = t
      ? countryColor(t[0])
      : '#273349';

    p.style.opacity = '.94';
  }

  const code = $('#municipalitySelect').value;
  const d = DATA.top[code];

  if (!d) return;

  setFocus(code);
  zoomTo(code);

  const population = DATA.pop[code]?.population;

  $('#municipalitySummary').innerHTML = `
    <div class="summary-title">
      ${esc(d.name)} kommun
    </div>

    <div class="statbox">
      <div class="num">
        ${population ? nf.format(population) : '—'}
      </div>

      <div class="lbl">
        Invånare 2025
      </div>
    </div>
  `;

  $('#municipalityResults').innerHTML = topRows(code, 10)
    .map((r, i) => `
      <div class="result-row">
        <div
          class="rank"
          style="background:${countryColor(r[0])};color:#fff"
        >
          ${i + 1}
        </div>

        <div class="name">
          ${esc(r[0])}
        </div>

        <div>
          <div class="value">
            ${nf.format(r[1])}
          </div>

          <div class="subvalue">
            ${pct(r[1], code)} av kommunen
          </div>
        </div>
      </div>
    `)
    .join('');

  $('#legendText').textContent =
    'Färg = vanligaste födelseland utanför Sverige';
}

function municipalityTooltip(code, name) {
  const population = DATA.pop[code]?.population || 0;

  const rows = topRows(code, 5)
    .map(r => `
      <div class="tt-row">
        <span
          class="tt-dot"
          style="background:${countryColor(r[0])}"
        ></span>

        <span class="tt-country">
          ${esc(r[0])}
        </span>

        <span class="tt-value">
          ${nf.format(r[1])} · ${pct(r[1], code)}
        </span>
      </div>
    `)
    .join('');

  return `
    <div class="tt-title">
      ${esc(name)} kommun
    </div>

    <div class="tt-sub">
      ${population
        ? nf.format(population) + ' invånare'
        : ''}
    </div>

    <div class="tt-rule"></div>

    ${rows}

    <div class="tt-note">
      Vanligaste separat redovisade födelseländer utanför Sverige.
    </div>
  `;
}

function positionTooltip(e) {
  const pad = 14;
  const w = 320;
  const h = 245;

  let x = e.clientX + 16;
  let y = e.clientY + 16;

  if (x + w > innerWidth - pad) {
    x = e.clientX - w - 16;
  }

  if (y + h > innerHeight - pad) {
    y = innerHeight - h - pad;
  }

  tooltip.style.left =
    Math.max(pad, x) + 'px';

  tooltip.style.top =
    Math.max(pad, y) + 'px';
}

function bindMapEvents() {
  paths.forEach(p => {
    p.addEventListener('mousemove', e => {
      const c = p.dataset.code;
      const n = p.dataset.name;

      if (mode === 'municipality') {
        tooltip.innerHTML =
          municipalityTooltip(c, n);
      } else {
        const r = currentLookup[c];
        const population =
          DATA.pop[c]?.population || 0;

        tooltip.innerHTML = r
          ? `
            <div class="tt-title">
              ${esc(n)} kommun
            </div>

            <div class="tt-sub">
              ${
                population
                  ? nf.format(population) + ' invånare'
                  : ''
              }
            </div>

            <div class="tt-rule"></div>

            <div class="tt-row">
              <span
                class="tt-dot"
                style="background:#2d9fc2"
              ></span>

              <span class="tt-country">
                ${esc(currentCountry)}
              </span>

              <span class="tt-value">
                ${nf.format(r.count)} · ${pct(r.count, c)}
              </span>
            </div>

            <div class="tt-note">
              Rank ${r.rank} i Sverige efter antal personer.
            </div>
          `
          : `
            <div class="tt-title">
              ${esc(n)} kommun
            </div>

            <div class="tt-sub">
              ${
                population
                  ? nf.format(population) + ' invånare'
                  : ''
              }
            </div>

            <div class="tt-rule"></div>

            <div class="tt-note">
              ${esc(currentCountry)}:
              exakt kommunvärde redovisas inte av SCB.
            </div>
          `;
      }

      tooltip.style.display = 'block';
      positionTooltip(e);
    });

    p.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });

    p.addEventListener('click', () => {
      $('#municipalitySelect').value =
        p.dataset.code;

      switchMode('municipality');
    });
  });

  let dragging = false;
  let last = null;

  svg.addEventListener('pointerdown', e => {
    dragging = true;

    last = [
      e.clientX,
      e.clientY
    ];

    svg.setPointerCapture(e.pointerId);
    svg.classList.add('dragging');
  });

  svg.addEventListener('pointermove', e => {
    if (!dragging) return;

    const vb = svg.viewBox.baseVal;

    const dx =
      (e.clientX - last[0]) *
      vb.width /
      svg.clientWidth;

    const dy =
      (e.clientY - last[1]) *
      vb.height /
      svg.clientHeight;

    vb.x -= dx;
    vb.y -= dy;

    last = [
      e.clientX,
      e.clientY
    ];
  });

  svg.addEventListener('pointerup', () => {
    dragging = false;
    svg.classList.remove('dragging');
  });

  svg.addEventListener(
    'wheel',
    e => {
      e.preventDefault();

      zoom(
        e.deltaY < 0 ? 0.86 : 1.16,
        e.clientX,
        e.clientY
      );
    },
    {
      passive: false
    }
  );
}

function zoom(
  f,
  cx =
    svg.getBoundingClientRect().left +
    svg.clientWidth / 2,
  cy =
    svg.getBoundingClientRect().top +
    svg.clientHeight / 2
) {
  const vb = svg.viewBox.baseVal;
  const r = svg.getBoundingClientRect();

  const px =
    (cx - r.left) /
    r.width;

  const py =
    (cy - r.top) /
    r.height;

  const nw =
    vb.width * f;

  const nh =
    vb.height * f;

  vb.x +=
    px * (vb.width - nw);

  vb.y +=
    py * (vb.height - nh);

  vb.width = nw;
  vb.height = nh;
}

function zoomTo(code) {
  const p =
    document.getElementById('m-' + code);

  if (!p) return;

  const b = p.getBBox();

  const pad =
    Math.max(
      b.width,
      b.height
    ) * 1.4;

  svg.setAttribute(
    'viewBox',
    `${b.x - pad} ${b.y - pad} ${b.width + 2 * pad} ${b.height + 2 * pad}`
  );
}

function resetView() {
  svg.setAttribute(
    'viewBox',
    originalViewBox.join(' ')
  );
}

function switchMode(m) {
  mode = m;

  $$('.tab').forEach(x => {
    x.classList.toggle(
      'active',
      x.dataset.mode === m
    );
  });

  $('#panel-country')
    .classList.toggle(
      'hidden',
      m !== 'country'
    );

  $('#panel-municipality')
    .classList.toggle(
      'hidden',
      m !== 'municipality'
    );

  if (m === 'country') {
    renderCountry();
  } else {
    renderMunicipality();
  }
}

function bindUI() {
  $$('.tab').forEach(b => {
    b.onclick = () =>
      switchMode(b.dataset.mode);
  });

  $('#countrySelect')
    .addEventListener(
      'change',
      renderCountry
    );

  $('#topN')
    .addEventListener(
      'input',
      renderCountry
    );

  $('#shadeMetric')
    .addEventListener(
      'change',
      renderCountry
    );

  $('#municipalitySelect')
    .addEventListener(
      'change',
      renderMunicipality
    );

  $('#zoomIn').onclick =
    () => zoom(0.8);

  $('#zoomOut').onclick =
    () => zoom(1.25);

  $('#resetBtn').onclick =
    resetView;
}

(async () => {
  try {
    await loadData();

    buildMap();
    fillSelectors();
    bindUI();
    renderCountry();

    $('#loading').remove();
  } catch (err) {
    console.error(err);

    $('#loading').textContent =
      'Kartan kunde inte laddas. Kontrollera att alla datafiler finns i /data.';
  }
})();
