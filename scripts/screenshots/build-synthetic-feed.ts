#!/usr/bin/env tsx
/**
 * Builds a small synthetic feed for the README screenshots: one frequent bus
 * line with arrival and departure times only, for a dense timetable, and an
 * on-demand route over two irregular zones.
 *
 * Run with: pnpm screenshots:feed
 *
 * Writes .cache/synthetic-demo.zip. Everything is generated, so the output is
 * the same on every run.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import Papa from 'papaparse';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '.cache');
const OUTPUT_PATH = join(CACHE_DIR, 'synthetic-demo.zip');

const AGENCY_ID = 'demo';
const LINE_ROUTE_ID = '10';
const FLEX_ROUTE_ID = 'flex';

// West to east across Des Moines, with minutes from the previous stop
const LINE_STOPS: [name: string, minutes: number][] = [
  ['Westgate Transit Center', 0],
  ['Valley Rd & 63rd St', 3],
  ['Grand Ave & 56th St', 2],
  ['Grand Ave & 48th St', 2],
  ['Grand Ave & 42nd St', 2],
  ['Ingersoll Ave & 35th St', 3],
  ['Ingersoll Ave & 28th St', 2],
  ['Ingersoll Ave & 19th St', 2],
  ['High St & 12th St', 3],
  ['Locust St & 6th Ave', 2],
  ['Central Station', 2],
  ['East Village', 3],
  ['Grand Ave & E 14th St', 2],
  ['Capitol Heights', 3],
  ['Easton Blvd & E 30th St', 3],
  ['Eastgate Plaza', 2],
];
const LINE_WEST: [number, number] = [-93.7205, 41.5902];
const LINE_EAST: [number, number] = [-93.5612, 41.5951];

// Every `headway` minutes from `first` to `last`, per direction
const SERVICES = [
  {
    service_id: 'weekday',
    days: [1, 1, 1, 1, 1, 0, 0],
    first: '05:30',
    last: '23:30',
    headway: 10,
  },
  {
    service_id: 'saturday',
    days: [0, 0, 0, 0, 0, 1, 0],
    first: '06:30',
    last: '22:30',
    headway: 20,
  },
];

const ZONES = [
  {
    id: 'northside',
    name: 'Northside service area',
    center: [-93.632, 41.652] as [number, number],
    radiusKm: 3.6,
    seed: 7,
  },
  {
    id: 'riverbend',
    name: 'Riverbend service area',
    center: [-93.556, 41.548] as [number, number],
    radiusKm: 2.7,
    seed: 19,
  },
];

type Row = Record<string, string | number>;

function toCsv(rows: Row[]): string {
  return Papa.unparse(rows, { newline: '\n' }) + '\n';
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function formatTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/** Deterministic pseudo-random numbers in [0, 1). */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/**
 * A closed, counterclockwise ring with a lobed, uneven outline: a few low
 * harmonics for the overall shape and per-vertex jitter for the edges.
 */
function blob(
  center: [number, number],
  radiusKm: number,
  seed: number
): [number, number][] {
  const rand = random(seed);
  const harmonics = [2, 3, 5].map((k) => ({
    k,
    amp: 0.08 + rand() * 0.12,
    phase: rand() * Math.PI * 2,
  }));
  const kmPerDegLat = 110.574;
  const kmPerDegLon = 111.32 * Math.cos((center[1] * Math.PI) / 180);
  const ring: [number, number][] = [];
  const count = 56;
  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2;
    let r = 1;
    for (const { k, amp, phase } of harmonics) {
      r += amp * Math.sin(k * theta + phase);
    }
    r *= radiusKm * (0.96 + rand() * 0.08);
    ring.push([
      Number((center[0] + (r * Math.cos(theta)) / kmPerDegLon).toFixed(5)),
      Number((center[1] + (r * Math.sin(theta)) / kmPerDegLat).toFixed(5)),
    ]);
  }
  ring.push(ring[0]);
  return ring;
}

async function main(): Promise<void> {
  const files: Record<string, string> = {};

  files['agency.txt'] = toCsv([
    {
      agency_id: AGENCY_ID,
      agency_name: 'Demo Transit',
      agency_url: 'https://example.com',
      agency_timezone: 'America/Chicago',
      agency_lang: 'en',
    },
  ]);

  files['calendar.txt'] = toCsv(
    SERVICES.map(({ service_id, days }) => ({
      service_id,
      monday: days[0],
      tuesday: days[1],
      wednesday: days[2],
      thursday: days[3],
      friday: days[4],
      saturday: days[5],
      sunday: days[6],
      start_date: '20260101',
      end_date: '20261231',
    }))
  );

  files['routes.txt'] = toCsv([
    {
      route_id: LINE_ROUTE_ID,
      agency_id: AGENCY_ID,
      route_short_name: '10',
      route_long_name: 'Crosstown',
      route_type: 3,
      route_color: '0E7C86',
      route_text_color: 'FFFFFF',
    },
    {
      route_id: FLEX_ROUTE_ID,
      agency_id: AGENCY_ID,
      route_short_name: 'Flex',
      route_long_name: 'Northside - Riverbend On Demand',
      route_type: 3,
      route_color: '7C3AED',
      route_text_color: 'FFFFFF',
    },
  ]);

  // Stops evenly spaced on the line, with a slight bow so it is not ruler-straight
  const stops = LINE_STOPS.map(([name], i) => {
    const t = i / (LINE_STOPS.length - 1);
    const bow = Math.sin(t * Math.PI) * 0.004;
    return {
      stop_id: `s${String(i + 1).padStart(2, '0')}`,
      stop_name: name,
      stop_lat: Number(
        (LINE_WEST[1] + (LINE_EAST[1] - LINE_WEST[1]) * t + bow).toFixed(6)
      ),
      stop_lon: Number(
        (LINE_WEST[0] + (LINE_EAST[0] - LINE_WEST[0]) * t).toFixed(6)
      ),
    };
  });
  files['stops.txt'] = toCsv(stops);

  const shapes: Row[] = [];
  for (const direction of [0, 1]) {
    const ordered = direction === 0 ? stops : [...stops].reverse();
    ordered.forEach((stop, i) =>
      shapes.push({
        shape_id: `10_${direction}`,
        shape_pt_lat: stop.stop_lat,
        shape_pt_lon: stop.stop_lon,
        shape_pt_sequence: i,
      })
    );
  }
  files['shapes.txt'] = toCsv(shapes);

  const trips: Row[] = [];
  const stopTimes: Row[] = [];
  const offsets = LINE_STOPS.reduce<number[]>(
    (acc, [, m], i) => [...acc, (acc[i - 1] ?? 0) + m],
    []
  );
  const runMinutes = offsets[offsets.length - 1];
  for (const { service_id, first, last, headway } of SERVICES) {
    for (const direction of [0, 1]) {
      const ordered = direction === 0 ? stops : [...stops].reverse();
      const dirOffsets =
        direction === 0
          ? offsets
          : offsets.map((o) => runMinutes - o).reverse();
      for (
        let start = minutes(first);
        start <= minutes(last);
        start += headway
      ) {
        const trip_id = `10_${service_id}_${direction}_${formatTime(start).slice(0, 5).replace(':', '')}`;
        trips.push({
          route_id: LINE_ROUTE_ID,
          service_id,
          trip_id,
          trip_headsign:
            direction === 0 ? 'Eastgate Plaza' : 'Westgate Transit Center',
          direction_id: direction,
          shape_id: `10_${direction}`,
        });
        ordered.forEach((stop, i) => {
          const time = formatTime(start + dirOffsets[i]);
          stopTimes.push({
            trip_id,
            arrival_time: time,
            departure_time: time,
            stop_id: stop.stop_id,
            stop_sequence: i + 1,
          });
        });
      }
    }
  }

  // On-demand: out to Riverbend in the morning, back in the afternoon
  const flexTrips = [
    {
      trip_id: 'flex_am',
      headsign: 'Riverbend',
      from: 'northside',
      to: 'riverbend',
      window: ['06:00:00', '12:00:00'],
    },
    {
      trip_id: 'flex_pm',
      headsign: 'Northside',
      from: 'riverbend',
      to: 'northside',
      window: ['12:00:00', '19:00:00'],
    },
  ];
  for (const flex of flexTrips) {
    trips.push({
      route_id: FLEX_ROUTE_ID,
      service_id: 'weekday',
      trip_id: flex.trip_id,
      trip_headsign: flex.headsign,
      direction_id: flex.trip_id === 'flex_am' ? 0 : 1,
      shape_id: '',
    });
  }
  files['trips.txt'] = toCsv(trips);

  const flexStopTimes: Row[] = flexTrips.flatMap((flex) => [
    {
      trip_id: flex.trip_id,
      location_id: flex.from,
      stop_sequence: 1,
      start_pickup_drop_off_window: flex.window[0],
      end_pickup_drop_off_window: flex.window[1],
      pickup_type: 2,
      drop_off_type: 1,
      pickup_booking_rule_id: 'same_day',
    },
    {
      trip_id: flex.trip_id,
      location_id: flex.to,
      stop_sequence: 2,
      start_pickup_drop_off_window: flex.window[0],
      end_pickup_drop_off_window: flex.window[1],
      pickup_type: 1,
      drop_off_type: 2,
      drop_off_booking_rule_id: 'same_day',
    },
  ]);
  const stopTimeFields = [
    'trip_id',
    'arrival_time',
    'departure_time',
    'stop_id',
    'location_id',
    'stop_sequence',
    'start_pickup_drop_off_window',
    'end_pickup_drop_off_window',
    'pickup_type',
    'drop_off_type',
    'pickup_booking_rule_id',
    'drop_off_booking_rule_id',
  ];
  files['stop_times.txt'] =
    Papa.unparse(
      {
        fields: stopTimeFields,
        data: [...stopTimes, ...flexStopTimes].map((row) =>
          stopTimeFields.map((f) => row[f] ?? '')
        ),
      },
      { newline: '\n' }
    ) + '\n';

  files['booking_rules.txt'] = toCsv([
    {
      booking_rule_id: 'same_day',
      booking_type: 1,
      prior_notice_duration_min: 60,
      message: 'Book at least an hour ahead by phone or in the app.',
      phone_number: '+1-555-0100',
    },
  ]);

  files['locations.geojson'] =
    JSON.stringify(
      {
        type: 'FeatureCollection',
        features: ZONES.map((zone) => ({
          type: 'Feature',
          id: zone.id,
          properties: { stop_name: zone.name },
          geometry: {
            type: 'Polygon',
            coordinates: [blob(zone.center, zone.radiusKm, zone.seed)],
          },
        })),
      },
      null,
      2
    ) + '\n';

  mkdirSync(CACHE_DIR, { recursive: true });
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) {
    zip.file(name, text);
  }
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  writeFileSync(OUTPUT_PATH, buffer);
  console.log(
    `[synthetic-feed] ${trips.length} trips, ${stopTimes.length + flexStopTimes.length} stop_times, ${ZONES.length} zones`
  );
  console.log(
    `[synthetic-feed] Wrote ${OUTPUT_PATH} (${(buffer.length / 1024).toFixed(0)} KB)`
  );
}

main().catch((error) => {
  console.error('[synthetic-feed] Failed:', error);
  process.exit(1);
});
