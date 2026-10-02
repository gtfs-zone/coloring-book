/**
 * README stills, one test per shot, written to docs/screenshots/<project>/.
 */

import { join } from 'path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  DEMO_FEED,
  FLEX_FIXTURES,
  SYNTHETIC_FEED,
  clearToasts,
  editField,
  fitBoston,
  go,
  jumpTo,
  loadFeed,
  manifest,
  projectToPage,
  seed,
  settle,
  shot,
} from './helpers';

const m = manifest();
const CHARLES_MGH = m.stations.charlesMgh.stationId;
// Bottom to top of the Alewife platform stairs
const STAIRS_PATHWAY = 'chmnl-030';
const RED_WEEKDAY = 'RTL20264-hms46011-Weekday-01';
const RED_TIMETABLE = `route=Red&modal=timetable&modal_route=Red&modal_service=${RED_WEEKDAY}`;
// Route 10 of the synthetic feed: a trip every 10 minutes
const LINE_TIMETABLE =
  'route=10&modal=timetable&modal_route=10&modal_service=weekday&modal_direction=0';
const DOWNTOWN: [number, number] = [-71.0589, 42.3555];
// A route 1 stop on Mass Ave, clear of other stops for the drag shot.
const BUS_STOP = { id: '72', lngLat: [-71.103074, 42.364915] as [number, number] };

async function open(page: Page, testInfo: TestInfo, zip = DEMO_FEED): Promise<void> {
  await seed(page, testInfo);
  await loadFeed(page, zip);
  await clearToasts(page);
}

/**
 * Scroll the timetable grid so its first stop row sits under the pinned trip
 * id row, and drop focus so no tooltip or focus ring shows.
 */
async function scrollToStopRows(page: Page): Promise<void> {
  await page
    .locator('[role=gridcell][data-stop-index="0"]')
    .first()
    .evaluate((cell) => {
      const row = cell.closest('tr')!;
      const scroller = row.closest<HTMLElement>('.overflow-x-auto')!;
      const pinned = scroller.querySelector('thead tr')!;
      scroller.scrollTop +=
        row.getBoundingClientRect().top - pinned.getBoundingClientRect().bottom;
    });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(300);
}

/** The visible modal box. */
function modal(page: Page) {
  return page.locator('.modal-open .modal-box, dialog[open] .modal-box').last();
}

test.describe('demo feed', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await open(page, testInfo);
  });

  test('01 home-overview', async ({ page }, testInfo) => {
    await fitBoston(page);
    await shot(page, testInfo, '01-home-overview');
  });

  test('02 home-zoomed-downtown', async ({ page }, testInfo) => {
    await jumpTo(page, DOWNTOWN, 14.5);
    await shot(page, testInfo, '02-home-zoomed-downtown');
  });

  test('03 search-typing', async ({ page }, testInfo) => {
    await page.locator('#map-search').pressSequentially('Park', { delay: 60 });
    await page.locator('#map-search-card [data-index]').first().waitFor();
    await settle(page);
    await shot(page, testInfo, '03-search-typing', { keepCursor: true });
  });

  // Shots driven by hash alone: [slug, hash]
  const HASH_SHOTS: [string, string][] = [
    ['04-agency', 'agency=1'],
    ['10-stop-station', `stop=${CHARLES_MGH}`],
    ['11-stop-platform', 'stop=70076'],
    ['15-pathway', `pathway=${STAIRS_PATHWAY}`],
    ['16-levels', `stop=${CHARLES_MGH}&modal=levels`],
    ['17-timetable-browser', 'modal=timetables'],
    ['23-shapes', 'modal=shapes'],
    ['25-calendar', 'modal=calendar'],
    ['26-service-page', `service=${RED_WEEKDAY}`],
    ['27-fares', 'modal=fares'],
    ['28-feed-data-transfers', 'modal=feed_data'],
    ['31-feed-issues', 'modal=feed_issues'],
  ];

  // Route pages, scrolled past the form to the services and the diagram.
  const ROUTE_SHOTS: [string, string][] = [
    ['05-route-red', 'Red'],
    ['06-route-green-e', 'Green-E'],
    ['07-route-bus', '1'],
    ['08-route-commuter-rail', 'CR-Providence'],
    ['09-route-ferry', 'Boat-F1'],
  ];

  for (const [slug, route_id] of ROUTE_SHOTS) {
    test(slug, async ({ page }, testInfo) => {
      await go(page, `route=${route_id}`);
      await page.locator('.route-diagram-row').first().evaluate((row) => {
        const section = row.closest('.p-4 > *')!;
        (section.previousElementSibling ?? section).scrollIntoView({ block: 'start' });
      });
      await page.waitForTimeout(300);
      await shot(page, testInfo, slug);
    });
  }

  const TIMETABLE_SHOTS: [string, string][] = [
    [
      '19-timetable-cr',
      'route=CR-Providence&modal=timetable&modal_route=CR-Providence&modal_service=Spring%2FSummerWeekday',
    ],
    [
      '20-timetable-bus-sat',
      'route=1&modal=timetable&modal_route=1&modal_service=BUS20264-hbc46046-Saturday-02',
    ],
  ];

  for (const [slug, hash] of TIMETABLE_SHOTS) {
    test(slug, async ({ page }, testInfo) => {
      await go(page, hash);
      await scrollToStopRows(page);
      await shot(page, testInfo, slug);
    });
  }

  for (const [slug, hash] of HASH_SHOTS) {
    test(slug, async ({ page }, testInfo) => {
      await go(page, hash);
      await shot(page, testInfo, slug);
    });
  }

  test('12 stop-inline-edit', async ({ page }, testInfo) => {
    await go(page, `stop=${BUS_STOP.id}`);
    await editField(page, 'stop_name', 'Massachusetts Ave @ Pe', { commit: false });
    await shot(page, testInfo, '12-stop-inline-edit', { keepCursor: true });
  });

  test('13 stop-drag', async ({ page }, testInfo) => {
    await go(page, `stop=${BUS_STOP.id}`);
    await jumpTo(page, BUS_STOP.lngLat, 17.5);
    const from = await projectToPage(page, BUS_STOP.lngLat);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 70, from.y - 40, { steps: 12 });
    await page.waitForTimeout(400);
    await shot(page, testInfo, '13-stop-drag', { keepCursor: true });
  });

  test('14 add-stop-tool', async ({ page }, testInfo) => {
    await jumpTo(page, DOWNTOWN, 15.5);
    await page.click('#add-stop-btn');
    const box = (await page.locator('#map').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
    await page.waitForTimeout(300);
    await shot(page, testInfo, '14-add-stop-tool', { keepCursor: true });
  });

  test('29 files-stops', async ({ page }, testInfo) => {
    await page.click('#files-btn');
    await page.locator('#file-list a', { hasText: 'stops.txt' }).first().click();
    await page.locator('#table-editor tbody input').first().waitFor();
    await settle(page);
    await shot(page, testInfo, '29-files-stops');
  });

  test('30 files-cell-edit', async ({ page }, testInfo) => {
    await page.click('#files-btn');
    await page.locator('#file-list a', { hasText: 'stops.txt' }).first().click();
    // Column 3 is stop_name.
    const cell = page.locator('#table-editor tbody tr').nth(3).locator('td').nth(2).locator('input');
    await cell.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Haymarket Stat', { delay: 30 });
    await page.waitForTimeout(300);
    await shot(page, testInfo, '30-files-cell-edit', { keepCursor: true });
  });

  test('32 history', async ({ page }, testInfo) => {
    await go(page, `stop=${BUS_STOP.id}`);
    await editField(page, 'stop_name', 'Mass Ave @ Pearl St');
    await go(page, 'route=1');
    await editField(page, 'route_desc', 'Key Bus Route');
    await go(page, 'agency=1');
    await editField(page, 'agency_phone', '617-222-3200 x1');
    await go(page, RED_TIMETABLE);
    await page.locator('[role=gridcell][data-field="departure_time"]').nth(1).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('05:26');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await go(page, `stop=${BUS_STOP.id}`);
    await jumpTo(page, BUS_STOP.lngLat, 17.5);
    const from = await projectToPage(page, BUS_STOP.lngLat);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 30, from.y + 20, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    await clearToasts(page);
    await page.click('#history-btn');
    await modal(page).waitFor();
    await settle(page);
    await shot(page, testInfo, '32-history');
  });

  test('33 load-modal', async ({ page }, testInfo) => {
    await page.click('#load-btn');
    await page.locator('#load-search').pressSequentially('Boston', { delay: 60 });
    await page.waitForTimeout(2500);
    await shot(page, testInfo, '33-load-modal', { keepCursor: true });
  });

  test('34 help', async ({ page }, testInfo) => {
    await page.click('#help-btn');
    await modal(page).waitFor();
    await settle(page);
    await shot(page, testInfo, '34-help');
  });

  test('35 shortcuts', async ({ page }, testInfo) => {
    await page.click('#help-btn');
    await modal(page).getByText('Keyboard Shortcuts', { exact: true }).first().click();
    await settle(page);
    await shot(page, testInfo, '35-shortcuts');
  });

  test('36 basemap-switcher', async ({ page }, testInfo) => {
    await jumpTo(page, DOWNTOWN, 13);
    await page.locator('.basemap-fab-main').focus();
    await page.waitForTimeout(500);
    await shot(page, testInfo, '36-basemap-switcher', { keepCursor: true });
  });

  test('37 basemap-satellite', async ({ page }, testInfo) => {
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).gtfsEditor.mapController.setBasemap('satellite');
    });
    await jumpTo(page, DOWNTOWN, 15);
    await settle(page, 1000);
    await shot(page, testInfo, '37-basemap-satellite');
  });
});

test.describe('synthetic feed', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await open(page, testInfo, SYNTHETIC_FEED);
  });

  test('18 timetable-dense', async ({ page }, testInfo) => {
    await go(page, LINE_TIMETABLE);
    await scrollToStopRows(page);
    await shot(page, testInfo, '18-timetable-dense');
  });

  test('21 timetable-cell-edit', async ({ page }, testInfo) => {
    await go(page, LINE_TIMETABLE);
    await scrollToStopRows(page);
    await page
      .locator('[role=gridcell][data-field="departure_time"][data-stop-index="4"]')
      .nth(3)
      .click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('06:1', { delay: 40 });
    await page.waitForTimeout(300);
    await shot(page, testInfo, '21-timetable-cell-edit', { keepCursor: true });
  });

  test('22 timetable-invalid', async ({ page }, testInfo) => {
    await go(page, LINE_TIMETABLE);
    await scrollToStopRows(page);
    // The third stop's arrival, set before the trip's first departure.
    await page
      .locator('[role=gridcell][data-field="arrival_time"][data-stop-index="2"]')
      .first()
      .click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('05:00');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    // Enter moves the selection down a cell; drop its focus ring.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await clearToasts(page);
    await shot(page, testInfo, '22-timetable-invalid');
  });

  test('38 on-demand', async ({ page }, testInfo) => {
    await go(page, 'modal=on_demand');
    await shot(page, testInfo, '38-on-demand');
  });

  test('39 zone-page', async ({ page }, testInfo) => {
    await go(page, 'zone=northside');
    await shot(page, testInfo, '39-zone-page');
  });

  // The zone editor is a GeoJSON textarea, not a map vertex editor.
  test('40 zone-geometry-edit', async ({ page }, testInfo) => {
    await go(page, 'zone=northside');
    const textarea = page.locator('.geojson-exchange-input').first();
    await textarea.scrollIntoViewIfNeeded();
    await textarea.click();
    await page.keyboard.press('ControlOrMeta+End');
    await settle(page);
    await shot(page, testInfo, '40-zone-geometry-edit', { keepCursor: true });
  });
});

test.describe('flex fixtures', () => {
  test('41 location-group', async ({ page }, testInfo) => {
    await open(page, testInfo, join(FLEX_FIXTURES, 'location-group.zip'));
    await go(page, 'location_group=lg_downtown');
    await shot(page, testInfo, '41-location-group');
  });
});

test.describe('mobile', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await open(page, testInfo);
  });

  test('42 mobile-home @mobile', async ({ page }, testInfo) => {
    await jumpTo(page, DOWNTOWN, 12);
    await shot(page, testInfo, '42-mobile-home');
  });

  test('43 mobile-route @mobile', async ({ page }, testInfo) => {
    await go(page, 'route=Red');
    await shot(page, testInfo, '43-mobile-route');
  });

  test('44 mobile-timetable @mobile', async ({ page }, testInfo) => {
    await go(page, RED_TIMETABLE);
    await expect(modal(page)).toBeVisible();
    await scrollToStopRows(page);
    await shot(page, testInfo, '44-mobile-timetable');
  });
});
