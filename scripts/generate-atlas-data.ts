#!/usr/bin/env tsx
/**
 * Fetches GTFS feed data from transitland-atlas and emits public/atlas-feeds.json.
 * Run with: npm run atlas
 *
 * Uses GITHUB_TOKEN env var if present to avoid rate limiting.
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface AtlasFeed {
  id: string;
  name: string;
  operator_name: string;
  location: string;
  url: string;
}

interface DmfrFeed {
  id: string;
  spec?: string;
  name?: string;
  urls?: {
    static_current?: string;
    [key: string]: string | undefined;
  };
  associated_operators?: string[];
}

interface DmfrOperator {
  onestop_id?: string;
  name?: string;
  short_name?: string;
  tags?: {
    country_code?: string;
    metro_area?: string;
    [key: string]: string | undefined;
  };
  associated_feeds?: Array<{ feed_onestop_id?: string }>;
}

interface DmfrFile {
  feeds?: DmfrFeed[];
  operators?: DmfrOperator[];
}

interface GitHubTreeItem {
  path: string;
  type: string;
  url: string;
}

interface GitHubTree {
  tree: GitHubTreeItem[];
  truncated: boolean;
}

const REPO = 'transitland/transitland-atlas';
const headers: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'gtfs.zone-atlas-generator',
};

if (process.env.GITHUB_TOKEN) {
  headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  console.log('[atlas] Using GITHUB_TOKEN for authentication');
} else {
  console.warn('[atlas] No GITHUB_TOKEN found — unauthenticated (60 req/hr limit)');
}

async function githubFetch(url: string): Promise<unknown> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText} — ${url}`);
  }
  return res.json();
}

async function main() {
  console.log('[atlas] Fetching file tree from transitland-atlas...');
  const tree = (await githubFetch(
    `https://api.github.com/repos/${REPO}/git/trees/HEAD?recursive=1`,
  )) as GitHubTree;

  if (tree.truncated) {
    console.warn('[atlas] Warning: GitHub tree response was truncated — some files may be missing');
  }

  const feedFiles = tree.tree.filter(
    (item) => item.type === 'blob' && item.path.startsWith('feeds/') && item.path.endsWith('.json'),
  );

  console.log(`[atlas] Found ${feedFiles.length} DMFR feed files`);

  const allFeeds: AtlasFeed[] = [];
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  // Fetch in batches to be kind to the API
  const BATCH_SIZE = 10;
  for (let i = 0; i < feedFiles.length; i += BATCH_SIZE) {
    const batch = feedFiles.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (file) => {
        try {
          const raw = (await githubFetch(
            `https://raw.githubusercontent.com/${REPO}/HEAD/${file.path}`,
          )) as DmfrFile;

          const dmfr = raw as DmfrFile;
          const operators = dmfr.operators ?? [];

          for (const feed of dmfr.feeds ?? []) {
            if (feed.spec !== 'gtfs') {
              skipped++;
              continue;
            }
            const url = feed.urls?.static_current;
            if (!url) {
              skipped++;
              continue;
            }

            // Find associated operator: prefer one linked via associated_feeds, else first in file
            let operator: DmfrOperator | undefined;
            if (operators.length > 0) {
              operator =
                operators.find((op) =>
                  op.associated_feeds?.some((af) => af.feed_onestop_id === feed.id),
                ) ?? operators[0];
            }

            const location =
              operator?.tags?.metro_area ?? operator?.tags?.country_code ?? '';

            allFeeds.push({
              id: feed.id,
              name: feed.name || feed.id,
              operator_name: operator?.name ?? '',
              location,
              url,
            });
            processed++;
          }
        } catch (err) {
          console.warn(`[atlas] Warning: failed to process ${file.path}: ${err}`);
          errors++;
        }
      }),
    );

    if ((i + BATCH_SIZE) % 100 === 0 || i + BATCH_SIZE >= feedFiles.length) {
      console.log(
        `[atlas] Progress: ${Math.min(i + BATCH_SIZE, feedFiles.length)}/${feedFiles.length} files`,
      );
    }
  }

  const outPath = join(__dirname, '..', 'public', 'atlas-feeds.json');
  writeFileSync(outPath, JSON.stringify(allFeeds));

  console.log(`[atlas] Done: ${processed} feeds written, ${skipped} skipped, ${errors} errors`);
  console.log(`[atlas] Output: ${outPath}`);
}

main().catch((err) => {
  console.error('[atlas] Fatal error:', err);
  process.exit(1);
});
