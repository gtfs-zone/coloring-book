/**
 * README GIFs, one test per clip, recorded by the gif project and written to
 * docs/screenshots/gifs/. Each test calls markStart() once the scene is set,
 * and the conversion drops everything before it.
 *
 * Run with: pnpm screenshots --project gif
 */

import { test, type Locator, type Page } from '@playwright/test';
import {
  DEMO_FEED,
  SYNTHETIC_FEED,
  clearToasts,
  fitBoston,
  go,
  jumpTo,
  loadFeed,
  manifest,
  seed,
  settle,
  showCursor,
  toGif,
} from './helpers';

const m = manifest();
const RED_WEEKDAY = 'RTL20264-hms46011-Weekday-01';
const DOWNTOWN: [number, number] = [-71.0589, 42.3555];

// One test runs at a time per worker, so module state is per clip.
let videoStart = 0;
let startSec = 0;

function markStart(): void {
  startSec = (Date.now() - videoStart) / 1000;
}

/** Move the mouse to a point slowly enough to read at 12 fps. */
async function glide(page: Page, x: number, y: number, steps = 20): Promise<void> {
  await page.mouse.move(x, y, { steps });
  await page.waitForTimeout(250);
}

/** Viewport position of the middle of an element. */
async function center(target: Locator): Promise<[number, number]> {
  const box = (await target.boundingBox())!;
  return [box.x + box.width / 2, box.y + box.height / 2];
}

/** Rest the mouse over the map, clear of the panel's hover tooltips. */
async function parkOnMap(page: Page): Promise<void> {
  const map = (await page.locator('#map').boundingBox())!;
  await page.mouse.move(map.x + map.width * 0.5, map.y + map.height * 0.7);
}

/** Glide to the middle of an element and click it. */
async function glideClick(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await glide(page, ...(await center(target)));
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
}

test.beforeEach(async ({ page }, testInfo) => {
  // The page fixture, and with it the recording, starts just before this hook.
  videoStart = Date.now();
  startSec = 0;
  await seed(page, testInfo);
  await showCursor(page);
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    return;
  }
  // Hold the final frame before the clip loops.
  await page.waitForTimeout(1500);
  const video = page.video();
  if (!video) {
    throw new Error('No video: run with --project gif');
  }
  await page.close();
  const slug = testInfo.title.replace(' @gif', '').replace(' ', '-');
  toGif(await video.path(), slug, startSec);
});

test('g02 search-to-route @gif', async ({ page }) => {
  await loadFeed(page, DEMO_FEED);
  await clearToasts(page);
  await fitBoston(page);
  markStart();
  await glideClick(page, page.locator('#map-search'));
  await page.locator('#map-search').pressSequentially('Red', { delay: 180 });
  const result = page.locator('#map-search-card [data-index]', { hasText: 'Red Line' }).first();
  await result.waitFor();
  await page.waitForTimeout(600);
  await glideClick(page, result);
  await page.waitForTimeout(600);
  await settle(page);
});

test('g03 browse-route-station-platform @gif', async ({ page }) => {
  await loadFeed(page, DEMO_FEED);
  await clearToasts(page);
  await go(page, 'route=Red');
  markStart();
  const stationRow = page.locator('.route-diagram-row', { hasText: 'Charles/MGH' }).first();
  await stationRow.evaluate((row) => row.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await page.waitForTimeout(1000);
  await glideClick(page, stationRow);
  await page.waitForTimeout(600);
  await settle(page);
  const platform = page.locator(`[data-stop-id="${m.stations.charlesMgh.platformIds[0]}"]`).first();
  await glideClick(page, platform);
  await page.waitForTimeout(600);
  await settle(page);
});

test('g06 add-stop @gif', async ({ page }) => {
  await loadFeed(page, DEMO_FEED);
  await clearToasts(page);
  await jumpTo(page, DOWNTOWN, 16);
  const map = (await page.locator('#map').boundingBox())!;
  await page.mouse.move(map.x + map.width * 0.7, map.y + map.height * 0.7);
  markStart();
  await glideClick(page, page.locator('#add-stop-btn'));
  await page.waitForTimeout(400);
  await glide(page, map.x + map.width * 0.55, map.y + map.height * 0.45, 30);
  await page.mouse.down();
  await page.mouse.up();
  const create = page
    .locator('.modal-open .modal-box, dialog[open] .modal-box')
    .last()
    .getByRole('button', { name: 'Create', exact: true });
  await create.waitFor();
  await page.waitForTimeout(800);
  await glideClick(page, create);
  const name = page.locator('.inline-editable-field[data-field="stop_name"]').first();
  await name.waitFor();
  await settle(page, 400);
  await glideClick(page, name);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Tremont St @ Winter St', { delay: 90 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
});

test('g08 calendar-edit @gif', async ({ page }) => {
  await loadFeed(page, DEMO_FEED);
  await clearToasts(page);
  await go(page, `service=${RED_WEEKDAY}`);
  await parkOnMap(page);
  markStart();
  for (const day of ['saturday', 'sunday']) {
    await glideClick(page, page.locator(`button[data-day="${day}"]`).first());
    await page.waitForTimeout(1000);
  }
  await clearToasts(page);
});

test('g10 zone-edit @gif', async ({ page }) => {
  await loadFeed(page, SYNTHETIC_FEED);
  await clearToasts(page);
  await go(page, 'zone=northside');
  const textarea = page.locator('.geojson-exchange-input').first();
  await textarea.scrollIntoViewIfNeeded();
  // Select the longitude of a vertex on the eastern edge and push it east.
  const lon = await textarea.evaluate((el) => {
    const area = el as HTMLTextAreaElement;
    const ring = (
      JSON.parse(area.value) as { geometry: { coordinates: number[][][] } }
    ).geometry.coordinates[0];
    const east = ring.slice(1, -1).reduce((a, b) => (b[0] > a[0] ? b : a));
    const text = String(east[0]);
    const at = area.value.indexOf(text);
    area.focus();
    area.setSelectionRange(at, at + text.length);
    area.blur();
    return east[0];
  });
  await parkOnMap(page);
  markStart();
  await glideClick(page, textarea);
  await textarea.evaluate((el, text) => {
    const area = el as HTMLTextAreaElement;
    const at = area.value.indexOf(text);
    area.setSelectionRange(at, at + text.length);
  }, String(lon));
  await page.waitForTimeout(600);
  await page.keyboard.type((lon + 0.025).toFixed(6), { delay: 140 });
  await page.waitForTimeout(400);
  await glideClick(page, page.locator('.geojson-exchange-apply').first());
  await page.waitForTimeout(600);
  await settle(page, 600);
});
