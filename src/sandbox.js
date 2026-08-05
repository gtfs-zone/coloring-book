import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// Standalone visual sandbox for stop-focus and pathway styling. Not part of
// the app build (vite only bundles index.html); open at /sandbox.html.

// ---------------------------------------------------------------- state

// Defaults match what shipped in layer-manager.ts, so opening the sandbox
// shows the current app styling and each toggle is a departure from it.
const state = {
  // scene
  theme: 'dark',
  basemap: true,
  isolate: false,
  // focused stop
  growth: 'none', // 'none' | '1.2' | '1.7'
  accent: true, // C
  halo: true, // A
  invert: true, // B
  top: true, // E
  transitions: false, // F
  pulse: false, // G
  label: false, // H
  dim: false, // I
  // pathways
  casing: true, // J
  muted: true, // K
  icons: true, // L
  offset: true, // M
  clip: true, // N
  arrows: false, // O
  elevatorBadge: false, // P
  ground: true, // Q
};

const SHIPPED = [
  'accent',
  'halo',
  'invert',
  'top',
  'casing',
  'muted',
  'icons',
  'offset',
  'clip',
  'ground',
];

const FOCUS_TOGGLES = [
  [
    'A',
    'halo',
    'Halo instead of growth',
    'Soft accent disc + thin ring under the stop. Also thins the focused stroke.',
  ],
  [
    'B',
    'invert',
    'Filled inversion',
    'Focused stop flips to solid accent fill with a white ring.',
  ],
  [
    'C',
    'accent',
    'Theme accent (not red)',
    'Swaps hardcoded #e74c3c for the theme accent.',
  ],
  [
    'E',
    'top',
    'Focus layer on top',
    'Redraws the focused stop above all others so it is never occluded.',
  ],
  [
    'F',
    'transitions',
    'Paint transitions',
    '180ms ease on radius/color/width instead of an instant pop.',
  ],
  [
    'G',
    'pulse',
    'Pulse ring',
    'Slow expanding ring. Repeating here so it can be judged; would be one-shot in the app.',
  ],
  [
    'H',
    'label',
    'Name label',
    'Communicates selection semantically instead of chromatically.',
  ],
  [
    'I',
    'dim',
    'Dim everything else',
    'Pushes unfocused stops back to 25% instead of brightening the one.',
  ],
];

const PATHWAY_TOGGLES = [
  [
    'J',
    'casing',
    'Cased lines',
    'Dark wide casing under a narrow core, same treatment routes get.',
  ],
  [
    'K',
    'muted',
    'Muted palette + dash by mode',
    'Drops the 7-hue rainbow; mode is carried by dash pattern.',
  ],
  [
    'L',
    'icons',
    'Mode icons on the line',
    'Self-documenting glyph at line center, no legend needed.',
  ],
  [
    'M',
    'offset',
    'Offset parallel edges',
    'Fans out multi-edges between the same node pair instead of stacking them.',
  ],
  [
    'N',
    'clip',
    'Clip lines to node edge',
    'Ends stop short of the circle so they attach instead of being swallowed.',
  ],
  [
    'O',
    'arrows',
    'Direction arrows',
    'Shows is_bidirectional=0, currently invisible information.',
  ],
  [
    'P',
    'elevatorBadge',
    'Elevators as badges',
    'Avoids degenerate segments when endpoints share coordinates.',
  ],
  [
    'Q',
    'ground',
    'Station ground plane',
    'Translucent hull so the graph sits on a surface, not the basemap.',
  ],
];

const SCENE_TOGGLES = [
  ['', 'basemap', 'Basemap tiles', 'Needs network. Off = flat background.'],
  [
    '',
    'isolate',
    'Isolate station',
    'Mimics the app hiding non-station stops while a station is expanded.',
  ],
];

const THEME_ACCENT = { dark: '#38bdf8', light: '#2563eb' };
const LEGACY_ACCENT = '#e74c3c';
const accentColor = () =>
  state.accent ? THEME_ACCENT[state.theme] : LEGACY_ACCENT;

// ---------------------------------------------------------------- data

const CENTER = [-71.06, 42.3555];
const mPerDegLat = 110540;
const mPerDegLng = 111320 * Math.cos((CENTER[1] * Math.PI) / 180);
const at = (dx, dy) => [
  CENTER[0] + dx / mPerDegLng,
  CENTER[1] + dy / mPerDegLat,
];

const STATION_ID = 'ST';

// [id, name, location_type, coord, parent, hasOwnCoords]
const stopDefs = [
  ['ST', 'Copley Station', 1, at(0, -8), '', true],
  ['E1', 'West Entrance', 2, at(-72, 42), 'ST', true],
  ['E2', 'Plaza Entrance', 2, at(62, 56), 'ST', true],
  ['E3', 'Emergency Exit', 2, at(-78, -22), 'ST', true],
  ['N1', 'Mezzanine North', 3, at(-30, 16), 'ST', true],
  ['N2', 'Mezzanine South', 3, at(0, -6), 'ST', true],
  ['N3', 'Concourse East', 3, at(36, -20), 'ST', true],
  ['N3b', 'Concourse East Upper', 3, at(37.4, -21.2), 'ST', true],
  ['N4', 'Paid Area North', 3, at(38, 26), 'ST', true],
  ['P1', 'Platform 1 (Westbound)', 0, at(-26, -46), 'ST', true],
  ['P2', 'Platform 2 (Eastbound)', 0, at(46, -56), 'ST', true],
  ['B1', 'Platform 1 Front Car', 4, at(-42, -62), 'ST', true],
  ['B2', 'Platform 2 Front Car', 4, at(60, -70), 'ST', true],
  // Surrounding context: unrelated plain stops + a second station.
  ['C1', 'Boylston St @ Dartmouth', 0, at(-210, 120), '', true],
  ['C2', 'Boylston St @ Clarendon', 0, at(30, 150), '', true],
  ['C3', 'Boylston St @ Berkeley', 0, at(260, 176), '', true],
  ['C4', 'Huntington Ave @ Ring Rd', 0, at(-250, -140), '', true],
  ['C5', 'Huntington Ave @ Belvidere', 0, at(-40, -196), '', true],
  ['C6', 'Huntington Ave @ Garrison', 0, at(200, -230), '', true],
  ['C7', 'St James Ave @ Trinity Pl', 0, at(-160, -40), '', false],
  ['C8', 'Stuart St @ Berkeley', 0, at(300, -30), '', true],
  ['ST2', 'Back Bay Station', 1, at(-330, -30), '', true],
];

// [id, from, to, mode, bidirectional]
const pathwayDefs = [
  ['pw1', 'E1', 'N1', 1, 1],
  ['pw2', 'E2', 'N4', 1, 1],
  ['pw3', 'N4', 'N3', 6, 1],
  ['pw4', 'N1', 'N2', 1, 1],
  ['pw5', 'N1', 'N2', 2, 1],
  ['pw6', 'N1', 'N2', 5, 1],
  ['pw7', 'N2', 'P1', 1, 1],
  ['pw8', 'N2', 'N3', 4, 0],
  ['pw9', 'N3', 'P2', 3, 1],
  ['pw10', 'P1', 'B1', 1, 1],
  ['pw11', 'P2', 'B2', 1, 1],
  ['pw12', 'N3', 'N3b', 5, 1],
  ['pw13', 'N1', 'E3', 7, 0],
];

const routeDefs = [
  { id: 'green', color: '#16a34a', ids: ['C1', 'C2', 'ST', 'C3'] },
  { id: 'orange', color: '#ea580c', ids: ['ST2', 'C4', 'C5', 'ST', 'C6'] },
];

const stopById = new Map(stopDefs.map((s) => [s[0], s]));
const coordOf = (id) => stopById.get(id)[3];

const MODE_COLOR = {
  1: '#22c55e',
  2: '#f97316',
  3: '#06b6d4',
  4: '#a855f7',
  5: '#3b82f6',
  6: '#ef4444',
  7: '#6b7280',
};

// Category palette: hue says what kind of transition it is, the icon names the
// exact mode. Mirrors src/utils/pathway-modes.ts.
const MODE_COLOR_MUTED = {
  1: '#94a3b8',
  2: '#5eaea8',
  3: '#94a3b8',
  4: '#5eaea8',
  5: '#5eaea8',
  6: '#d6a15c',
  7: '#d6a15c',
};

const MODE_ICON = {
  1: 'ic-walk',
  2: 'ic-stairs',
  3: 'ic-sidewalk',
  4: 'ic-escalator',
  5: 'ic-elevator',
  6: 'ic-gate',
  7: 'ic-exit',
};

// Dash groups only apply in muted mode: line-dasharray is not data-driven, so
// each pattern needs its own layer. Redundant with hue by design.
const DASH_GROUPS = [
  { key: 'horizontal', modes: [1, 3], dash: null },
  { key: 'vertical', modes: [2, 4, 5], dash: [2, 1.6] },
  { key: 'access', modes: [6, 7], dash: [3, 1.1, 0.5, 1.1] },
];

// ---------------------------------------------------------------- geometry

function stopsGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: stopDefs.map(([id, name, type, coord, parent, own]) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coord },
      properties: {
        stop_id: id,
        stop_name: name,
        location_type: type,
        parent_station: parent,
        station_id: type === 1 ? id : parent || '',
        has_own_coords: own,
      },
    })),
  };
}

function routesGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: routeDefs.map((r) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: r.ids.map(coordOf) },
      properties: { route_id: r.id, color: r.color },
    })),
  };
}

const lenM = (a, b) => {
  const dx = (b[0] - a[0]) * mPerDegLng;
  const dy = (b[1] - a[1]) * mPerDegLat;
  return Math.hypot(dx, dy);
};

function offsetSegment(a, b, meters) {
  const dx = (b[0] - a[0]) * mPerDegLng;
  const dy = (b[1] - a[1]) * mPerDegLat;
  const len = Math.hypot(dx, dy) || 1;
  const ox = (-dy / len) * meters;
  const oy = (dx / len) * meters;
  const shift = (p) => [p[0] + ox / mPerDegLng, p[1] + oy / mPerDegLat];
  return [shift(a), shift(b)];
}

function trimSegment(a, b, meters) {
  const len = lenM(a, b);
  if (len <= meters * 2.2) {
    return [a, b];
  }
  const t = meters / len;
  const lerp = (p, q, f) => [
    p[0] + (q[0] - p[0]) * f,
    p[1] + (q[1] - p[1]) * f,
  ];
  return [lerp(a, b, t), lerp(b, a, t)];
}

function pathwaysGeoJSON() {
  // Group by unordered endpoint pair so parallel edges can be fanned out.
  const groups = new Map();
  for (const pw of pathwayDefs) {
    const key = [pw[1], pw[2]].sort().join('\u0000');
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(pw);
  }

  const lines = [];
  const badges = [];

  for (const members of groups.values()) {
    members.forEach(([id, from, to, mode, bidi], i) => {
      let a = coordOf(from);
      let b = coordOf(to);

      if (state.elevatorBadge && mode === 5) {
        badges.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
          },
          properties: { pathway_id: id, pathway_mode: mode },
        });
        return;
      }

      if (state.offset && members.length > 1) {
        const spread = (i - (members.length - 1) / 2) * 5;
        [a, b] = offsetSegment(a, b, spread);
      }
      if (state.clip) {
        [a, b] = trimSegment(a, b, 6);
      }

      lines.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [a, b] },
        properties: {
          pathway_id: id,
          pathway_mode: mode,
          is_bidirectional: bidi,
          degenerate: lenM(a, b) < 4,
        },
      });
    });
  }

  return {
    lines: { type: 'FeatureCollection', features: lines },
    badges: { type: 'FeatureCollection', features: badges },
  };
}

function convexHull(points) {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (src) => {
    const out = [];
    for (const p of src) {
      while (
        out.length >= 2 &&
        cross(out[out.length - 2], out[out.length - 1], p) <= 0
      ) {
        out.pop();
      }
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...build(pts), ...build([...pts].reverse())];
}

function groundGeoJSON() {
  const pts = stopDefs
    .filter(([id, , , , parent]) => id === STATION_ID || parent === STATION_ID)
    .map((s) => s[3]);
  const hull = convexHull(pts);
  const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length;
  const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length;
  // Push each hull vertex ~16m outward from the centroid so the fill clears
  // the node circles rather than cutting through them.
  const ring = hull.map((p) => {
    const dx = (p[0] - cx) * mPerDegLng;
    const dy = (p[1] - cy) * mPerDegLat;
    const len = Math.hypot(dx, dy) || 1;
    const f = (len + 16) / len;
    return [cx + (dx * f) / mPerDegLng, cy + (dy * f) / mPerDegLat];
  });
  ring.push(ring[0]);
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {},
      },
    ],
  };
}

// ---------------------------------------------------------------- icons

function makeIcon(draw, size = 30) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(15,23,42,0.92)';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  draw(ctx, size);
  const img = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: img.data };
}

function addIcons(map) {
  const icons = {
    'ic-stairs': (ctx, s) => {
      ctx.beginPath();
      const x0 = s * 0.26;
      const y0 = s * 0.72;
      const step = s * 0.16;
      ctx.moveTo(x0, y0);
      for (let i = 0; i < 3; i++) {
        ctx.lineTo(x0 + step * i, y0 - step * (i + 1));
        ctx.lineTo(x0 + step * (i + 1), y0 - step * (i + 1));
      }
      ctx.stroke();
    },
    'ic-escalator': (ctx, s) => {
      ctx.beginPath();
      ctx.moveTo(s * 0.26, s * 0.72);
      ctx.lineTo(s * 0.72, s * 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 0.72, s * 0.3);
      ctx.lineTo(s * 0.56, s * 0.32);
      ctx.lineTo(s * 0.7, s * 0.46);
      ctx.closePath();
      ctx.fill();
    },
    'ic-elevator': (ctx, s) => {
      ctx.strokeRect(s * 0.32, s * 0.28, s * 0.36, s * 0.44);
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.34);
      ctx.lineTo(s * 0.42, s * 0.44);
      ctx.lineTo(s * 0.58, s * 0.44);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.66);
      ctx.lineTo(s * 0.42, s * 0.56);
      ctx.lineTo(s * 0.58, s * 0.56);
      ctx.closePath();
      ctx.fill();
    },
    'ic-gate': (ctx, s) => {
      ctx.beginPath();
      ctx.moveTo(s * 0.32, s * 0.26);
      ctx.lineTo(s * 0.32, s * 0.74);
      ctx.moveTo(s * 0.68, s * 0.26);
      ctx.lineTo(s * 0.68, s * 0.74);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 0.44, s * 0.5);
      ctx.lineTo(s * 0.58, s * 0.5);
      ctx.stroke();
    },
    'ic-walk': (ctx, s) => {
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.34, s * 0.07, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.42);
      ctx.lineTo(s * 0.5, s * 0.58);
      ctx.moveTo(s * 0.5, s * 0.58);
      ctx.lineTo(s * 0.4, s * 0.74);
      ctx.moveTo(s * 0.5, s * 0.58);
      ctx.lineTo(s * 0.62, s * 0.72);
      ctx.stroke();
    },
    'ic-sidewalk': (ctx, s) => {
      ctx.beginPath();
      ctx.moveTo(s * 0.24, s * 0.68);
      ctx.lineTo(s * 0.76, s * 0.68);
      ctx.moveTo(s * 0.28, s * 0.42);
      ctx.lineTo(s * 0.68, s * 0.42);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 0.76, s * 0.42);
      ctx.lineTo(s * 0.6, s * 0.32);
      ctx.lineTo(s * 0.6, s * 0.52);
      ctx.closePath();
      ctx.fill();
    },
    'ic-exit': (ctx, s) => {
      ctx.beginPath();
      ctx.moveTo(s * 0.28, s * 0.24);
      ctx.lineTo(s * 0.28, s * 0.76);
      ctx.moveTo(s * 0.42, s * 0.5);
      ctx.lineTo(s * 0.64, s * 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 0.74, s * 0.5);
      ctx.lineTo(s * 0.58, s * 0.4);
      ctx.lineTo(s * 0.58, s * 0.6);
      ctx.closePath();
      ctx.fill();
    },
  };
  for (const [name, draw] of Object.entries(icons)) {
    if (!map.hasImage(name)) {
      map.addImage(name, makeIcon(draw), { pixelRatio: 2.4 });
    }
  }

  if (!map.hasImage('ic-arrow')) {
    const s = 18;
    const c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(15,23,42,0.85)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(s * 0.72, s * 0.5);
    ctx.lineTo(s * 0.3, s * 0.24);
    ctx.lineTo(s * 0.42, s * 0.5);
    ctx.lineTo(s * 0.3, s * 0.76);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const img = ctx.getImageData(0, 0, s, s);
    map.addImage(
      'ic-arrow',
      { width: s, height: s, data: img.data },
      { pixelRatio: 2.6 }
    );
  }
}

// ---------------------------------------------------------------- map

const style = () => ({
  version: 8,
  sources: state.basemap
    ? {
        basemap: {
          type: 'raster',
          tiles: [
            `https://basemaps.cartocdn.com/rastertiles/${
              state.theme === 'dark' ? 'dark_all' : 'light_all'
            }/{z}/{x}/{y}.png`,
          ],
          tileSize: 256,
          attribution: 'CARTO / OpenStreetMap',
        },
      }
    : {},
  layers: [
    {
      id: 'bg',
      type: 'background',
      paint: {
        'background-color': state.theme === 'dark' ? '#0f172a' : '#eef2f6',
      },
    },
    ...(state.basemap
      ? [
          {
            id: 'basemap',
            type: 'raster',
            source: 'basemap',
            paint: { 'raster-opacity': 0.9 },
          },
        ]
      : []),
  ],
});

const map = new maplibregl.Map({
  container: 'map',
  style: style(),
  center: CENTER,
  zoom: 17.4,
  hash: false,
});
map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

let focusedId = null;
let labelMarker = null;
let pulseRaf = null;

const OWN_LAYERS = [
  'ground-fill',
  'ground-line',
  'routes',
  // Both the single-layer (palette off) and per-category ids.
  ...['solid', 'horizontal', 'vertical', 'access'].flatMap((key) => [
    `pathways-casing-${key}`,
    `pathways-line-${key}`,
  ]),
  'pathways-icons',
  'pathways-arrows',
  'pathway-badges',
  'pathway-badge-icons',
  'stops-pulse',
  'stops-halo',
  'stops-halo-ring',
  'stops-background',
  'stops-station-dot',
  'stops-focus-top',
  'stops-clickarea',
];
const OWN_SOURCES = ['ground', 'routes', 'pathways', 'pathway-badges', 'stops'];

function teardown() {
  if (pulseRaf) {
    cancelAnimationFrame(pulseRaf);
    pulseRaf = null;
  }
  for (const id of OWN_LAYERS) {
    if (map.getLayer(id)) {
      map.removeLayer(id);
    }
  }
  for (const id of OWN_SOURCES) {
    if (map.getSource(id)) {
      map.removeSource(id);
    }
  }
}

const focusedExpr = ['boolean', ['feature-state', 'focused'], false];
const focusFilter = () => ['==', ['get', 'stop_id'], focusedId ?? '\u0000'];

// Mirrors LayerManager.stopRadiusAt: radius encodes location_type, scaled per
// zoom stop, with a focus multiplier.
function stopRadiusAt(plainRadius, scale) {
  const byType = (mult) => [
    'case',
    ['==', ['get', 'location_type'], 1],
    8 * scale * mult,
    ['==', ['get', 'location_type'], 2],
    4.5 * scale * mult,
    ['==', ['get', 'location_type'], 3],
    4.5 * scale * mult,
    ['==', ['get', 'location_type'], 4],
    5 * scale * mult,
    plainRadius * scale * mult,
  ];
  const mult = { none: 1, 1.2: 1.2, 1.7: 1.7 }[state.growth];
  return ['case', focusedExpr, byType(mult), byType(1)];
}

function radiusInterp(plainRadius) {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    11,
    stopRadiusAt(plainRadius, 0.45),
    13.5,
    stopRadiusAt(plainRadius, 0.7),
    16,
    stopRadiusAt(plainRadius, 1),
    19,
    stopRadiusAt(plainRadius, 1.5),
  ];
}

function stopsFilter() {
  if (!state.isolate) {
    return ['!=', ['get', 'stop_id'], '\u0000'];
  }
  return [
    'any',
    ['==', ['get', 'stop_id'], STATION_ID],
    ['==', ['get', 'station_id'], STATION_ID],
  ];
}

function addPathwayLayers(before) {
  const { lines, badges } = pathwaysGeoJSON();
  map.addSource('pathways', {
    type: 'geojson',
    data: lines,
    promoteId: 'pathway_id',
  });
  map.addSource('pathway-badges', { type: 'geojson', data: badges });

  const colorExpr = (table) => {
    const e = ['case'];
    for (const [mode, color] of Object.entries(table)) {
      e.push(['==', ['get', 'pathway_mode'], Number(mode)], color);
    }
    e.push('#ffffff');
    return e;
  };

  const groups = state.muted
    ? DASH_GROUPS
    : [{ key: 'solid', modes: [1, 2, 3, 4, 5, 6, 7], dash: null }];
  const color = colorExpr(state.muted ? MODE_COLOR_MUTED : MODE_COLOR);
  const width = [
    'case',
    ['boolean', ['feature-state', 'focused'], false],
    6,
    3,
  ];

  // Casings first so no core line is painted over by a neighbour's casing.
  if (state.casing) {
    for (const g of groups) {
      map.addLayer(
        {
          id: `pathways-casing-${g.key}`,
          type: 'line',
          source: 'pathways',
          filter: ['in', ['get', 'pathway_mode'], ['literal', g.modes]],
          paint: {
            'line-color': state.theme === 'dark' ? '#0b1220' : '#1f2937',
            'line-width': ['+', width, 3.5],
            'line-opacity': 0.85,
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        },
        before
      );
    }
  }

  for (const g of groups) {
    const paint = { 'line-color': color, 'line-width': width };
    if (g.dash) {
      paint['line-dasharray'] = g.dash;
    }
    map.addLayer(
      {
        id: `pathways-line-${g.key}`,
        type: 'line',
        source: 'pathways',
        filter: ['in', ['get', 'pathway_mode'], ['literal', g.modes]],
        paint,
        layout: {
          // Round caps turn the near-zero dash of the dotted group into dots.
          'line-cap': g.key === 'dotted' || !g.dash ? 'round' : 'butt',
          'line-join': 'round',
        },
      },
      before
    );
  }

  if (state.icons) {
    const iconExpr = ['case'];
    for (const [mode, name] of Object.entries(MODE_ICON)) {
      iconExpr.push(['==', ['get', 'pathway_mode'], Number(mode)], name);
    }
    iconExpr.push('');
    map.addLayer(
      {
        id: 'pathways-icons',
        type: 'symbol',
        source: 'pathways',
        filter: ['!=', ['get', 'degenerate'], true],
        layout: {
          'icon-image': iconExpr,
          'symbol-placement': 'line-center',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-rotation-alignment': 'viewport',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 16, 0.55, 19, 1],
        },
      },
      before
    );
  }

  if (state.arrows) {
    map.addLayer(
      {
        id: 'pathways-arrows',
        type: 'symbol',
        source: 'pathways',
        filter: ['==', ['get', 'is_bidirectional'], 0],
        layout: {
          'icon-image': 'ic-arrow',
          'symbol-placement': 'line',
          'symbol-spacing': 34,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-rotation-alignment': 'map',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 16, 0.5, 19, 0.9],
        },
      },
      before
    );
  }

  if (badges.features.length > 0) {
    map.addLayer(
      {
        id: 'pathway-badges',
        type: 'circle',
        source: 'pathway-badges',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 16, 6, 19, 11],
          'circle-color': state.muted ? MODE_COLOR_MUTED[5] : MODE_COLOR[5],
          'circle-stroke-color': state.theme === 'dark' ? '#0b1220' : '#ffffff',
          'circle-stroke-width': 1.6,
        },
      },
      before
    );
    map.addLayer(
      {
        id: 'pathway-badge-icons',
        type: 'symbol',
        source: 'pathway-badges',
        layout: {
          'icon-image': 'ic-elevator',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 16, 0.4, 19, 0.75],
        },
      },
      before
    );
  }
}

function stopStrokeColor() {
  return [
    'case',
    focusedExpr,
    state.invert ? '#ffffff' : accentColor(),
    ['==', ['get', 'has_own_coords'], false],
    '#9ca3af',
    ['==', ['get', 'location_type'], 1],
    '#111111',
    '#37474f',
  ];
}

function stopFillColor() {
  const base = [
    'case',
    ['==', ['get', 'location_type'], 1],
    '#ffffff',
    ['==', ['get', 'location_type'], 2],
    '#f59e0b',
    ['==', ['get', 'location_type'], 3],
    '#8b5cf6',
    ['==', ['get', 'location_type'], 4],
    '#10b981',
    '#ffffff',
  ];
  return state.invert ? ['case', focusedExpr, accentColor(), base] : base;
}

function stopStrokeWidth() {
  // The halo carries the selection, so the focused ring can stay thin.
  const f = state.halo ? [1.6, 2, 2.4] : [2.5, 3.5, 4.5];
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    11,
    ['case', focusedExpr, f[0], 1.2],
    16,
    ['case', focusedExpr, f[1], 2],
    19,
    ['case', focusedExpr, f[2], 2.8],
  ];
}

function stopOpacity() {
  if (!state.dim || !focusedId) {
    return 1;
  }
  return ['case', focusedExpr, 1, 0.25];
}

function addStopLayers() {
  map.addSource('stops', {
    type: 'geojson',
    data: stopsGeoJSON(),
    promoteId: 'stop_id',
  });

  if (state.pulse) {
    map.addLayer({
      id: 'stops-pulse',
      type: 'circle',
      source: 'stops',
      filter: focusFilter(),
      paint: {
        'circle-radius': 10,
        'circle-color': 'transparent',
        'circle-opacity': 0,
        'circle-stroke-color': accentColor(),
        'circle-stroke-width': 2,
        'circle-stroke-opacity': 0.6,
      },
    });
  }

  if (state.halo) {
    map.addLayer({
      id: 'stops-halo',
      type: 'circle',
      source: 'stops',
      filter: focusFilter(),
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          11,
          14,
          16,
          24,
          19,
          38,
        ],
        'circle-color': accentColor(),
        'circle-opacity': 0.18,
        'circle-stroke-width': 0,
      },
    });
    map.addLayer({
      id: 'stops-halo-ring',
      type: 'circle',
      source: 'stops',
      filter: focusFilter(),
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          11,
          14,
          16,
          24,
          19,
          38,
        ],
        'circle-color': 'transparent',
        'circle-opacity': 0,
        'circle-stroke-color': accentColor(),
        'circle-stroke-width': 1.4,
        'circle-stroke-opacity': 0.9,
      },
    });
  }

  const bgPaint = {
    'circle-radius': radiusInterp(5.5),
    'circle-color': stopFillColor(),
    'circle-stroke-color': stopStrokeColor(),
    'circle-stroke-width': stopStrokeWidth(),
    'circle-opacity': stopOpacity(),
    'circle-stroke-opacity': stopOpacity(),
  };
  if (state.transitions) {
    bgPaint['circle-radius-transition'] = { duration: 180 };
    bgPaint['circle-stroke-color-transition'] = { duration: 180 };
    bgPaint['circle-stroke-width-transition'] = { duration: 180 };
    bgPaint['circle-color-transition'] = { duration: 180 };
    bgPaint['circle-opacity-transition'] = { duration: 180 };
  }

  map.addLayer({
    id: 'stops-background',
    type: 'circle',
    source: 'stops',
    filter: stopsFilter(),
    paint: bgPaint,
  });

  map.addLayer({
    id: 'stops-station-dot',
    type: 'circle',
    source: 'stops',
    filter: ['all', ['==', ['get', 'location_type'], 1], stopsFilter()],
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        11,
        ['case', focusedExpr, 2.2, 1.3],
        16,
        ['case', focusedExpr, 4.5, 2.6],
        19,
        ['case', focusedExpr, 6, 3.8],
      ],
      'circle-color': '#111111',
      'circle-opacity': stopOpacity(),
      'circle-stroke-width': 0,
    },
  });

  if (state.top) {
    map.addLayer({
      id: 'stops-focus-top',
      type: 'circle',
      source: 'stops',
      filter: focusFilter(),
      paint: bgPaint,
    });
  }

  map.addLayer({
    id: 'stops-clickarea',
    type: 'circle',
    source: 'stops',
    filter: stopsFilter(),
    paint: {
      'circle-radius': 15,
      'circle-color': 'transparent',
      'circle-opacity': 0,
    },
  });
}

function startPulse() {
  if (!state.pulse || !focusedId || !map.getLayer('stops-pulse')) {
    return;
  }
  const t0 = performance.now();
  const tick = (t) => {
    const p = ((t - t0) % 1600) / 1600;
    const eased = 1 - Math.pow(1 - p, 2);
    map.setPaintProperty('stops-pulse', 'circle-radius', 12 + eased * 34);
    map.setPaintProperty(
      'stops-pulse',
      'circle-stroke-opacity',
      0.7 * (1 - eased)
    );
    pulseRaf = requestAnimationFrame(tick);
  };
  pulseRaf = requestAnimationFrame(tick);
}

function syncLabel() {
  if (labelMarker) {
    labelMarker.remove();
    labelMarker = null;
  }
  if (!state.label || !focusedId) {
    return;
  }
  const def = stopById.get(focusedId);
  const el = document.createElement('div');
  el.className = 'focus-label';
  el.textContent = def[1];
  labelMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
    .setLngLat(def[3])
    .addTo(map);
}

function rebuild() {
  teardown();

  if (state.ground) {
    map.addSource('ground', { type: 'geojson', data: groundGeoJSON() });
    map.addLayer({
      id: 'ground-fill',
      type: 'fill',
      source: 'ground',
      paint: {
        'fill-color': state.theme === 'dark' ? '#93c5fd' : '#1e3a8a',
        'fill-opacity': state.theme === 'dark' ? 0.1 : 0.07,
      },
    });
    map.addLayer({
      id: 'ground-line',
      type: 'line',
      source: 'ground',
      paint: {
        'line-color': state.theme === 'dark' ? '#93c5fd' : '#1e3a8a',
        'line-width': 1.2,
        'line-opacity': 0.45,
        'line-dasharray': [3, 2],
      },
    });
  }

  map.addSource('routes', { type: 'geojson', data: routesGeoJSON() });
  map.addLayer({
    id: 'routes',
    type: 'line',
    source: 'routes',
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 4,
      'line-opacity': 0.75,
    },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  });

  addPathwayLayers(undefined);
  addStopLayers();

  if (focusedId) {
    map.setFeatureState({ source: 'stops', id: focusedId }, { focused: true });
  }
  startPulse();
  syncLabel();
}

function setFocus(id) {
  if (focusedId && map.getSource('stops')) {
    map.setFeatureState({ source: 'stops', id: focusedId }, { focused: false });
  }
  focusedId = id;
  if (id) {
    map.setFeatureState({ source: 'stops', id }, { focused: true });
  }

  // Dim and the focus-only layers are filter/opacity driven, so they need a
  // rebuild rather than a feature-state flip.
  if (state.dim || state.top || state.halo || state.pulse || state.label) {
    rebuild();
  }
  syncLabel();
}

map.on('load', () => {
  addIcons(map);
  rebuild();
});

map.on('click', 'stops-clickarea', (e) => {
  e.preventDefault();
  setFocus(e.features[0].properties.stop_id);
});

map.on('click', (e) => {
  if (e.defaultPrevented) {
    return;
  }
  const hits = map.queryRenderedFeatures(e.point, {
    layers: ['stops-clickarea'],
  });
  if (hits.length === 0) {
    setFocus(null);
  }
});

map.on('mouseenter', 'stops-clickarea', () => {
  map.getCanvas().style.cursor = 'pointer';
});
map.on('mouseleave', 'stops-clickarea', () => {
  map.getCanvas().style.cursor = '';
});

// ---------------------------------------------------------------- panel

function restyle() {
  map.setStyle(style());
  map.once('style.load', () => {
    addIcons(map);
    rebuild();
  });
}

function buildToggles(container, defs) {
  for (const [key, prop, title, desc] of defs) {
    const label = document.createElement('label');
    label.className = 'row';
    label.innerHTML = `<input type="checkbox" ${state[prop] ? 'checked' : ''}>
      <span class="k">${key}</span>
      <span><b>${title}</b><span class="d">${desc}</span></span>`;
    label.querySelector('input').addEventListener('change', (e) => {
      state[prop] = e.target.checked;
      if (prop === 'basemap') {
        restyle();
      } else {
        rebuild();
      }
    });
    label.dataset.prop = prop;
    container.appendChild(label);
  }
}

function syncPanel() {
  document.querySelectorAll('label.row').forEach((l) => {
    l.querySelector('input').checked = !!state[l.dataset.prop];
  });
  document.querySelectorAll('#growth-radios input').forEach((r) => {
    r.checked = r.value === state.growth;
  });
}

const scene = document.getElementById('scene');
const themeRow = document.createElement('div');
themeRow.className = 'radios';
for (const t of ['dark', 'light']) {
  const l = document.createElement('label');
  l.innerHTML = `<input type="radio" name="theme" value="${t}" ${
    state.theme === t ? 'checked' : ''
  }> ${t}`;
  l.querySelector('input').addEventListener('change', () => {
    state.theme = t;
    restyle();
  });
  themeRow.appendChild(l);
}
scene.appendChild(themeRow);
buildToggles(scene, SCENE_TOGGLES);

const growthRow = document.getElementById('growth-radios');
for (const [val, text] of [
  ['none', 'no growth'],
  ['1.2', '1.2x (D)'],
  ['1.7', '1.7x (now)'],
]) {
  const l = document.createElement('label');
  l.innerHTML = `<input type="radio" name="growth" value="${val}" ${
    state.growth === val ? 'checked' : ''
  }> ${text}`;
  l.querySelector('input').addEventListener('change', () => {
    state.growth = val;
    rebuild();
  });
  growthRow.appendChild(l);
}

buildToggles(document.getElementById('focus-toggles'), FOCUS_TOGGLES);
buildToggles(document.getElementById('pathway-toggles'), PATHWAY_TOGGLES);

const allProps = [...FOCUS_TOGGLES, ...PATHWAY_TOGGLES].map((t) => t[1]);

function applyPreset(on, growth) {
  for (const p of allProps) {
    state[p] = on.includes(p);
  }
  state.growth = growth;
  syncPanel();
  rebuild();
}

document
  .getElementById('btn-baseline')
  .addEventListener('click', () => applyPreset([], '1.7'));
document
  .getElementById('btn-shortlist')
  .addEventListener('click', () => applyPreset(SHIPPED, 'none'));
document
  .getElementById('btn-all')
  .addEventListener('click', () => applyPreset(allProps, '1.2'));

// Keyboard shortcuts: the letter next to each toggle flips it.
const byKey = new Map(
  [...FOCUS_TOGGLES, ...PATHWAY_TOGGLES].map(([k, prop]) => [
    k.toLowerCase(),
    prop,
  ])
);
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') {
    return;
  }
  const prop = byKey.get(e.key.toLowerCase());
  if (!prop) {
    return;
  }
  state[prop] = !state[prop];
  syncPanel();
  rebuild();
});
