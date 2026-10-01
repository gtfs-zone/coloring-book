#!/usr/bin/env tsx
/**
 * Builds a small MBTA demo feed for the README screenshots.
 *
 * Run with: pnpm screenshots:feed
 *   pnpm screenshots:feed --refresh   # redownload the MBTA feed
 *
 * Keeps typical route patterns only, a few trips per pattern on one weekday,
 * Saturday and Sunday of a reference week, and everything those trips
 * reference. Writes .cache/mbta-demo.zip and .cache/demo-manifest.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import Papa from 'papaparse';

const SOURCE_URL = 'https://cdn.mbta.com/MBTA_GTFS.zip';

const TRIPS_PER_PATTERN = { weekday: 6, saturday: 3, sunday: 3 };

// Stations kept with every child (entrances, nodes, boarding areas) and pathway
const SHOWCASE_STATIONS = {
  parkStreet: 'place-pktrm',
  southStation: 'place-sstat',
};

// Files copied whole
const WHOLE_FILES = [
  'agency.txt',
  'feed_info.txt',
  'areas.txt',
  'fare_media.txt',
  'fare_products.txt',
  'fare_leg_rules.txt',
  'fare_transfer_rules.txt',
  'timeframes.txt',
  'networks.txt',
];

const ROUTE_TYPE_NAMES: Record<string, string> = {
  '0': 'tram',
  '1': 'subway',
  '2': 'rail',
  '3': 'bus',
  '4': 'ferry',
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '.cache');
const SOURCE_PATH = join(CACHE_DIR, 'MBTA_GTFS.zip');
const OUTPUT_PATH = join(CACHE_DIR, 'mbta-demo.zip');
const MANIFEST_PATH = join(CACHE_DIR, 'demo-manifest.json');

type Row = Record<string, string>;
type Day = keyof typeof TRIPS_PER_PATTERN;
const DAYS: Day[] = ['weekday', 'saturday', 'sunday'];

interface Table {
  fields: string[];
  rows: Row[];
}

async function download(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  if (existsSync(SOURCE_PATH) && !process.argv.includes('--refresh')) {
    console.log(`[demo-feed] Using cached ${SOURCE_PATH}`);
    return;
  }
  console.log(`[demo-feed] Downloading ${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  writeFileSync(SOURCE_PATH, Buffer.from(await res.arrayBuffer()));
}

async function readText(zip: JSZip, name: string): Promise<string | null> {
  const file = zip.file(name);
  return file ? file.async('string') : null;
}

// Streams rows through `keep` so large files never materialize in full
async function readTable(
  zip: JSZip,
  name: string,
  keep: (row: Row) => boolean = () => true
): Promise<Table | null> {
  const text = await readText(zip, name);
  if (text === null) {
    return null;
  }
  const rows: Row[] = [];
  let fields: string[] = [];
  Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: true,
    step: (result) => {
      if (result.errors.length > 0) {
        throw new Error(`${name}: ${result.errors[0].message}`);
      }
      fields = result.meta.fields ?? fields;
      if (keep(result.data)) {
        rows.push(result.data);
      }
    },
  });
  return { fields, rows };
}

async function requireTable(
  zip: JSZip,
  name: string,
  keep?: (row: Row) => boolean
): Promise<Table> {
  const table = await readTable(zip, name, keep);
  if (!table) {
    throw new Error(`${name} missing from source feed`);
  }
  return table;
}

function parseDate(yyyymmdd: string): Date {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function timeToSeconds(time: string): number {
  const [h, m, s] = time.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

// Wednesday, Saturday and Sunday of every Monday-Sunday week inside [start, end]
function fullWeeks(start: string, end: string): Record<Day, string>[] {
  const startDate = parseDate(start);
  const weeks: Record<Day, string>[] = [];
  let monday = addDays(startDate, (8 - startDate.getUTCDay()) % 7);
  while (formatDate(addDays(monday, 6)) <= end) {
    weeks.push({
      weekday: formatDate(addDays(monday, 2)),
      saturday: formatDate(addDays(monday, 5)),
      sunday: formatDate(addDays(monday, 6)),
    });
    monday = addDays(monday, 7);
  }
  if (weeks.length === 0) {
    throw new Error(`No full week between ${start} and ${end}`);
  }
  return weeks;
}

const WEEKDAY_COLUMNS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

function activeServices(
  calendar: Row[],
  calendarDates: Row[],
  date: string
): Set<string> {
  const active = new Set<string>();
  const column = WEEKDAY_COLUMNS[parseDate(date).getUTCDay()];
  for (const row of calendar) {
    if (row[column] === '1' && row.start_date <= date && date <= row.end_date) {
      active.add(row.service_id);
    }
  }
  for (const row of calendarDates) {
    if (row.date !== date) {
      continue;
    }
    if (row.exception_type === '1') {
      active.add(row.service_id);
    } else if (row.exception_type === '2') {
      active.delete(row.service_id);
    }
  }
  return active;
}

// Picks `count` items spread evenly across a sorted list, ends included
function spread<T>(items: T[], count: number): T[] {
  if (items.length <= count) {
    return items;
  }
  if (count === 1) {
    return [items[0]];
  }
  const picked = new Set<number>();
  for (let i = 0; i < count; i++) {
    picked.add(Math.round((i * (items.length - 1)) / (count - 1)));
  }
  return [...picked].map((i) => items[i]);
}

function toCsv(table: Table): string {
  return (
    Papa.unparse(table.rows, { columns: table.fields, newline: '\n' }) + '\n'
  );
}

async function main(): Promise<void> {
  await download();
  const source = await JSZip.loadAsync(readFileSync(SOURCE_PATH));
  const out: Record<string, Table> = {};

  // Typical-pattern trips. MBTA's canonical_route_pattern flag mostly marks
  // synthetic patterns with no real trips, so typicality is the filter that
  // covers every route.
  const routePatterns = await requireTable(source, 'route_patterns.txt');
  const typicalPatterns = new Set(
    routePatterns.rows
      .filter((row) => row.route_pattern_typicality === '1')
      .map((row) => row.route_pattern_id)
  );
  const typicalTrips = await requireTable(
    source,
    'trips.txt',
    (row) =>
      typicalPatterns.has(row.route_pattern_id) &&
      !row.trip_id.startsWith('canonical-')
  );

  // Reference week: the full week whose three reference days cover the most
  // routes, so diversions running on typical patterns' place are avoided
  const feedInfo = await requireTable(source, 'feed_info.txt');
  const calendar = await requireTable(source, 'calendar.txt');
  const calendarDates = await requireTable(source, 'calendar_dates.txt');
  const { feed_start_date, feed_end_date } = feedInfo.rows[0];
  const servicesFor = (week: Record<Day, string>) =>
    Object.fromEntries(
      DAYS.map((day) => [
        day,
        activeServices(calendar.rows, calendarDates.rows, week[day]),
      ])
    ) as Record<Day, Set<string>>;
  const coverage = (services: Record<Day, Set<string>>) =>
    DAYS.reduce(
      (sum, day) =>
        sum +
        new Set(
          typicalTrips.rows
            .filter((row) => services[day].has(row.service_id))
            .map((row) => row.route_id)
        ).size,
      0
    );
  const weeks = fullWeeks(feed_start_date, feed_end_date).map((dates) => {
    const services = servicesFor(dates);
    return { dates, services, score: coverage(services) };
  });
  const best = weeks.reduce((a, b) => (b.score > a.score ? b : a));
  const { dates } = best;
  const activeByDay = best.services;
  console.log(
    `[demo-feed] Reference dates: ${JSON.stringify(dates)} (${best.score} route-days)`
  );

  // Candidate trips: active on a reference day
  const trips: Table = {
    fields: typicalTrips.fields,
    rows: typicalTrips.rows.filter((row) =>
      DAYS.some((day) => activeByDay[day].has(row.service_id))
    ),
  };
  const candidateIds = new Set(trips.rows.map((row) => row.trip_id));
  console.log(
    `[demo-feed] ${typicalPatterns.size} typical patterns, ${candidateIds.size} candidate trips`
  );

  // First departure per candidate trip
  const firstDeparture = new Map<string, number>();
  await readTable(source, 'stop_times.txt', (row) => {
    if (candidateIds.has(row.trip_id) && row.departure_time) {
      const seconds = timeToSeconds(row.departure_time);
      const current = firstDeparture.get(row.trip_id);
      if (current === undefined || seconds < current) {
        firstDeparture.set(row.trip_id, seconds);
      }
    }
    return false;
  });

  // Keep TRIPS_PER_PATTERN[day] trips per pattern per day
  const keptTripIds = new Set<string>();
  for (const day of DAYS) {
    const byPattern = new Map<string, Row[]>();
    for (const trip of trips.rows) {
      if (!activeByDay[day].has(trip.service_id)) {
        continue;
      }
      const list = byPattern.get(trip.route_pattern_id) ?? [];
      list.push(trip);
      byPattern.set(trip.route_pattern_id, list);
    }
    for (const list of byPattern.values()) {
      list.sort(
        (a, b) =>
          (firstDeparture.get(a.trip_id) ?? 0) -
          (firstDeparture.get(b.trip_id) ?? 0)
      );
      for (const trip of spread(list, TRIPS_PER_PATTERN[day])) {
        keptTripIds.add(trip.trip_id);
      }
    }
  }
  out['trips.txt'] = {
    fields: trips.fields,
    rows: trips.rows.filter((row) => keptTripIds.has(row.trip_id)),
  };
  const keptTrips = out['trips.txt'].rows;
  const keptServices = new Set(keptTrips.map((row) => row.service_id));
  const keptRoutes = new Set(keptTrips.map((row) => row.route_id));
  const keptShapes = new Set(keptTrips.map((row) => row.shape_id));
  const keptPatterns = new Set(keptTrips.map((row) => row.route_pattern_id));

  // Patterns whose representative trip was dropped point at a kept trip
  const representative = new Map<string, string>();
  for (const trip of keptTrips) {
    if (!representative.has(trip.route_pattern_id)) {
      representative.set(trip.route_pattern_id, trip.trip_id);
    }
  }
  out['route_patterns.txt'] = {
    fields: routePatterns.fields,
    rows: routePatterns.rows
      .filter((row) => keptPatterns.has(row.route_pattern_id))
      .map((row) => ({
        ...row,
        representative_trip_id: keptTripIds.has(row.representative_trip_id)
          ? row.representative_trip_id
          : representative.get(row.route_pattern_id)!,
      })),
  };

  out['stop_times.txt'] = await requireTable(source, 'stop_times.txt', (row) =>
    keptTripIds.has(row.trip_id)
  );
  out['shapes.txt'] = await requireTable(source, 'shapes.txt', (row) =>
    keptShapes.has(row.shape_id)
  );
  out['calendar.txt'] = {
    fields: calendar.fields,
    rows: calendar.rows.filter((row) => keptServices.has(row.service_id)),
  };
  out['calendar_dates.txt'] = {
    fields: calendarDates.fields,
    rows: calendarDates.rows.filter((row) => keptServices.has(row.service_id)),
  };
  out['routes.txt'] = await requireTable(source, 'routes.txt', (row) =>
    keptRoutes.has(row.route_id)
  );
  const keptLines = new Set(out['routes.txt'].rows.map((row) => row.line_id));
  out['directions.txt'] = await requireTable(source, 'directions.txt', (row) =>
    keptRoutes.has(row.route_id)
  );
  out['lines.txt'] = await requireTable(source, 'lines.txt', (row) =>
    keptLines.has(row.line_id)
  );
  const keptCheckpoints = new Set(
    out['stop_times.txt'].rows.map((row) => row.checkpoint_id).filter(Boolean)
  );
  out['checkpoints.txt'] = await requireTable(
    source,
    'checkpoints.txt',
    (row) => keptCheckpoints.has(row.checkpoint_id)
  );

  // Stops: served stops, their parents, and every descendant of the showcase stations
  const stops = await requireTable(source, 'stops.txt');
  const stopById = new Map(stops.rows.map((row) => [row.stop_id, row]));
  const keptStops = new Set(
    out['stop_times.txt'].rows.map((row) => row.stop_id)
  );
  const showcaseStops = new Set<string>(Object.values(SHOWCASE_STATIONS));
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of stops.rows) {
      if (
        row.parent_station &&
        showcaseStops.has(row.parent_station) &&
        !showcaseStops.has(row.stop_id)
      ) {
        showcaseStops.add(row.stop_id);
        grew = true;
      }
    }
  }
  for (const id of showcaseStops) {
    keptStops.add(id);
  }
  for (const id of [...keptStops]) {
    let parent = stopById.get(id)?.parent_station;
    while (parent && !keptStops.has(parent)) {
      keptStops.add(parent);
      parent = stopById.get(parent)?.parent_station;
    }
  }
  out['stops.txt'] = {
    fields: stops.fields,
    rows: stops.rows.filter((row) => keptStops.has(row.stop_id)),
  };
  const keptLevels = new Set(
    out['stops.txt'].rows.map((row) => row.level_id).filter(Boolean)
  );
  out['levels.txt'] = await requireTable(source, 'levels.txt', (row) =>
    keptLevels.has(row.level_id)
  );
  out['pathways.txt'] = await requireTable(
    source,
    'pathways.txt',
    (row) =>
      showcaseStops.has(row.from_stop_id) && showcaseStops.has(row.to_stop_id)
  );

  const stopRefKept = (id: string | undefined) => !id || keptStops.has(id);
  const tripRefKept = (id: string | undefined) => !id || keptTripIds.has(id);
  const routeRefKept = (id: string | undefined) => !id || keptRoutes.has(id);
  out['transfers.txt'] = await requireTable(
    source,
    'transfers.txt',
    (row) =>
      stopRefKept(row.from_stop_id) &&
      stopRefKept(row.to_stop_id) &&
      tripRefKept(row.from_trip_id) &&
      tripRefKept(row.to_trip_id) &&
      routeRefKept(row.from_route_id) &&
      routeRefKept(row.to_route_id)
  );

  // Fares v2: whole, except the rows that reference stops
  for (const name of WHOLE_FILES) {
    const table = await readTable(source, name);
    if (table) {
      out[name] = table;
    }
  }
  out['stop_areas.txt'] = await requireTable(source, 'stop_areas.txt', (row) =>
    keptStops.has(row.stop_id)
  );
  const joinRules = await readTable(
    source,
    'fare_leg_join_rules.txt',
    (row) => stopRefKept(row.from_stop_id) && stopRefKept(row.to_stop_id)
  );
  if (joinRules) {
    out['fare_leg_join_rules.txt'] = joinRules;
  }
  const routeNetworks = await readTable(source, 'route_networks.txt', (row) =>
    keptRoutes.has(row.route_id)
  );
  if (routeNetworks) {
    out['route_networks.txt'] = routeNetworks;
  }

  // Write the zip
  const zip = new JSZip();
  for (const [name, table] of Object.entries(out)) {
    zip.file(name, toCsv(table));
    console.log(`[demo-feed] ${name}: ${table.rows.length} rows`);
  }
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  writeFileSync(OUTPUT_PATH, buffer);
  console.log(
    `[demo-feed] Wrote ${OUTPUT_PATH} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`
  );

  // Manifest of IDs the screenshot tests deep-link to
  const routesByMode: Record<string, string[]> = {};
  for (const row of out['routes.txt'].rows) {
    const mode = ROUTE_TYPE_NAMES[row.route_type] ?? `type_${row.route_type}`;
    (routesByMode[mode] ??= []).push(row.route_id);
  }
  const servicesByDayKept = Object.fromEntries(
    DAYS.map((day) => [
      day,
      [...activeByDay[day]].filter((id) => keptServices.has(id)).sort(),
    ])
  );
  const stations = Object.fromEntries(
    Object.entries(SHOWCASE_STATIONS).map(([key, stationId]) => {
      const children = out['stops.txt'].rows.filter(
        (row) => row.parent_station === stationId
      );
      const descendants = new Set<string>();
      const collect = (id: string) => {
        for (const row of out['stops.txt'].rows) {
          if (row.parent_station === id) {
            descendants.add(row.stop_id);
            collect(row.stop_id);
          }
        }
      };
      collect(stationId);
      return [
        key,
        {
          stationId,
          platformIds: children
            .filter((row) => (row.location_type || '0') === '0')
            .map((row) => row.stop_id),
          entranceIds: children
            .filter((row) => row.location_type === '2')
            .map((row) => row.stop_id),
          levelIds: [
            ...new Set(children.map((row) => row.level_id).filter(Boolean)),
          ],
          pathwayIds: out['pathways.txt'].rows
            .filter((row) => descendants.has(row.from_stop_id))
            .map((row) => row.pathway_id),
        },
      ];
    })
  );
  const manifest = {
    source: SOURCE_URL,
    feedVersion: feedInfo.rows[0].feed_version,
    dates,
    routesByMode,
    servicesByDay: servicesByDayKept,
    stations,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[demo-feed] Wrote ${MANIFEST_PATH}`);
}

main().catch((error) => {
  console.error('[demo-feed] Failed:', error);
  process.exit(1);
});
