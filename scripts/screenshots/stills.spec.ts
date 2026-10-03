/**
 * README stills, one test per shot, written to docs/screenshots/<project>/.
 */

import { test, type Page, type TestInfo } from '@playwright/test';
import {
  DEMO_FEED,
  SYNTHETIC_FEED,
  clearToasts,
  editField,
  fitBoston,
  go,
  jumpTo,
  loadFeed,
  manifest,
  projectToPage,
  scrollToStopRows,
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

  test('03 search-typing', async ({ page }, testInfo) => {
    await page.locator('#map-search').pressSequentially('Park', { delay: 60 });
    await page.locator('#map-search-card [data-index]').first().waitFor();
    await settle(page);
    await shot(page, testInfo, '03-search-typing', { keepCursor: true });
  });

  // Shots driven by hash alone: [slug, hash]
  const HASH_SHOTS: [string, string][] = [
    ['10-stop-station', `stop=${CHARLES_MGH}`],
    ['15-pathway', `pathway=${STAIRS_PATHWAY}`],
    ['26-service-page', `service=${RED_WEEKDAY}`],
    ['27-fares', 'modal=fares'],
    ['31-feed-issues', 'modal=feed_issues'],
  ];

  // Scrolled past the form to the services and the diagram.
  test('05 route-red', async ({ page }, testInfo) => {
    await go(page, 'route=Red');
    await page.locator('.route-diagram-row').first().evaluate((row) => {
      const section = row.closest('.p-4 > *')!;
      (section.previousElementSibling ?? section).scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(300);
    await shot(page, testInfo, '05-route-red');
  });

  test('19 timetable-cr', async ({ page }, testInfo) => {
    await go(
      page,
      'route=CR-Providence&modal=timetable&modal_route=CR-Providence&modal_service=Spring%2FSummerWeekday'
    );
    await scrollToStopRows(page);
    await shot(page, testInfo, '19-timetable-cr');
  });

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

  test('39 zone-page', async ({ page }, testInfo) => {
    await go(page, 'zone=northside');
    await shot(page, testInfo, '39-zone-page');
  });
});

test.describe('mobile', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await open(page, testInfo);
  });

  test('43 mobile-route @mobile', async ({ page }, testInfo) => {
    await go(page, 'route=Red');
    await shot(page, testInfo, '43-mobile-route');
  });
});
