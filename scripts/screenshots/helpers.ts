/**
 * Shared steps for the screenshot specs: seeding the page, loading a feed,
 * navigating by hash, waiting for the map, and writing a compressed PNG.
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { expect, type Page, type TestInfo } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../..');
const OUT_DIR = join(REPO_ROOT, 'docs/screenshots');

export const DEMO_FEED = join(__dirname, '.cache/mbta-demo.zip');
export const SYNTHETIC_FEED = join(__dirname, '.cache/synthetic-demo.zip');
export const FLEX_FIXTURES = join(REPO_ROOT, 'fixtures/flex/dist');

const HELP_PAGES = ['welcome', 'getting-started', 'shapes', 'fares', 'on-demand'];

interface Manifest {
  dates: Record<'weekday' | 'saturday' | 'sunday', string>;
  routesByMode: Record<string, string[]>;
  servicesByDay: Record<'weekday' | 'saturday' | 'sunday', string[]>;
  stations: Record<
    'charlesMgh',
    {
      stationId: string;
      platformIds: string[];
      entranceIds: string[];
      levelIds: string[];
      pathwayIds: string[];
    }
  >;
}

export function manifest(): Manifest {
  const path = join(__dirname, '.cache/demo-manifest.json');
  if (!existsSync(path)) {
    throw new Error(`${path} missing: run pnpm screenshots:feed first`);
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as Manifest;
}

/** Theme per project: the gif project records in dark. */
function themeFor(project: string): 'light' | 'dark' {
  return project === 'dark' || project === 'gif' ? 'dark' : 'light';
}

/**
 * Seed localStorage before any app script runs: the theme for this project
 * and every auto-shown help page marked seen.
 */
export async function seed(page: Page, testInfo: TestInfo): Promise<void> {
  const theme = themeFor(testInfo.project.name);
  await page.addInitScript(
    ({ theme, helpPages }) => {
      localStorage.setItem('theme', theme);
      for (const id of helpPages) {
        localStorage.setItem(`help.${id}.seen`, '1');
      }
    },
    { theme, helpPages: HELP_PAGES }
  );
}

/**
 * Open the app and load a feed zip through the boot load modal. Each test
 * gets a fresh context, so IndexedDB starts empty and edits never leak.
 */
export async function loadFeed(page: Page, zip: string): Promise<void> {
  await page.goto('/');
  await page.setInputFiles('#load-file-input', zip);
  // Logged once the layers are in, just before the map fits to the feed.
  const mapReady = page.waitForEvent('console', {
    predicate: (msg) => msg.text() === 'Map update completed',
    timeout: 60_000,
  });
  await page
    .locator('.modal-open, dialog[open]')
    .getByRole('button', { name: 'Load', exact: true })
    .click();
  await expect(page.locator('#export-btn')).toBeEnabled({ timeout: 60_000 });
  await mapReady;
  await waitForLoadingDone(page);
  await settle(page);
}

async function waitForLoadingDone(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const el = document.getElementById('global-loading-indicator');
    return !el || el.classList.contains('-translate-y-full');
  });
}

/** Navigate by hash, in the URLSearchParams format the app writes. */
export async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
  // The page renders from IndexedDB before the camera flies, so let the
  // flight start before waiting for the map to come to rest.
  await page.waitForTimeout(600);
  await waitForLoadingDone(page);
  await settle(page);
}

/**
 * Wait for the map to finish rendering with every tile in, then for fonts,
 * then a short pause for CSS transitions.
 */
export async function settle(page: Page, extraMs = 800): Promise<void> {
  // A camera move can start a moment after the change that causes it, so the
  // map has to stay still across 900 ms. The pause after covers raster fade-in.
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const map = (window as any).gtfsEditor?.mapController?.['map'];
        if (!map) {
          resolve(true);
          return;
        }
        const still = () =>
          map.loaded() && map.areTilesLoaded() && !map.isMoving();
        if (!still()) {
          resolve(false);
          return;
        }
        let checks = 0;
        const timer = setInterval(() => {
          checks += 1;
          if (!still()) {
            clearInterval(timer);
            resolve(false);
          } else if (checks === 3) {
            clearInterval(timer);
            resolve(true);
          }
        }, 300);
      }),
    undefined,
    { timeout: 30_000, polling: 250 }
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(extraMs);
}

/** Fit the map to the whole network. */
export async function fitBoston(page: Page): Promise<void> {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).gtfsEditor.mapController.focusFeed();
  });
  await settle(page);
}

/** Jump the map to a fixed view, no animation. */
export async function jumpTo(
  page: Page,
  center: [number, number],
  zoom: number
): Promise<void> {
  await page.evaluate(
    ({ center, zoom }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).gtfsEditor.mapController['map'].jumpTo({ center, zoom });
    },
    { center, zoom }
  );
  await settle(page);
}

/**
 * Screenshot to docs/screenshots/<project>/<slug>.png and run pngquant over
 * it in place. The mouse is parked off the page unless `keepCursor` is set.
 */
export async function shot(
  page: Page,
  testInfo: TestInfo,
  slug: string,
  { keepCursor = false }: { keepCursor?: boolean } = {}
): Promise<void> {
  if (!keepCursor) {
    await page.mouse.move(0, page.viewportSize()!.height - 1);
  }
  const dir = join(OUT_DIR, testInfo.project.name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${slug}.png`);
  await page.screenshot({ path });
  try {
    execFileSync('pngquant', [
      '--quality',
      '80-95',
      '--skip-if-larger',
      '--force',
      '--ext',
      '.png',
      path,
    ]);
  } catch (err) {
    // 98: quality floor not met, 99: result larger. Both keep the original.
    const status = (err as { status?: number }).status;
    if (status !== 98 && status !== 99) {
      throw err;
    }
  }
  console.log(`[screenshots] ${testInfo.project.name}/${slug}.png`);
}

/** Open an inline field on the current page and replace its value. */
export async function editField(
  page: Page,
  field: string,
  value: string,
  { commit = true }: { commit?: boolean } = {}
): Promise<void> {
  await page.locator(`.inline-editable-field[data-field="${field}"]`).first().click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(value, { delay: 20 });
  if (commit) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
  }
}

/** Remove notification toasts so they do not cover the shot. */
export async function clearToasts(page: Page): Promise<void> {
  await page.evaluate(() =>
    document.querySelectorAll('.notification-item').forEach((e) => e.remove())
  );
}

/** Viewport pixel position of a lng/lat on the map. */
export async function projectToPage(
  page: Page,
  lngLat: [number, number]
): Promise<{ x: number; y: number }> {
  return page.evaluate((ll) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = (window as any).gtfsEditor.mapController['map'];
    const p = map.project(ll);
    const rect = map.getCanvas().getBoundingClientRect();
    return { x: rect.left + p.x, y: rect.top + p.y };
  }, lngLat);
}
