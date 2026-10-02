#!/usr/bin/env tsx
/**
 * Writes docs/screenshots/index.html: a review grid of every captured still
 * and GIF, light and dark side by side, with file sizes. Ticking images builds
 * a list of picks to copy.
 *
 * Run with: pnpm screenshots:sheet
 */

import { existsSync, readdirSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(__dirname, '..', '..', 'docs', 'screenshots');
const OUTPUT_PATH = join(SHOTS_DIR, 'index.html');

const PROJECTS = ['light', 'dark', 'mobile', 'gifs'] as const;
type Project = (typeof PROJECTS)[number];

interface Shot {
  project: Project;
  file: string;
  bytes: number;
}

function listShots(project: Project): Shot[] {
  const dir = join(SHOTS_DIR, project);
  if (!existsSync(dir)) {
    console.warn(`[contact-sheet] Missing ${dir}`);
    return [];
  }
  return readdirSync(dir)
    .filter((file) => /\.(png|gif)$/.test(file))
    .sort()
    .map((file) => ({
      project,
      file,
      bytes: statSync(join(dir, file)).size,
    }));
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

function slugOf(file: string): string {
  return file.replace(/\.(png|gif)$/, '');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function figure(shot: Shot): string {
  const src = `${shot.project}/${shot.file}`;
  return `<figure>
  <a href="${escapeHtml(src)}" target="_blank"><img src="${escapeHtml(src)}" loading="lazy"></a>
  <figcaption>${shot.project} - ${formatSize(shot.bytes)}</figcaption>
</figure>`;
}

// One card per slug, holding every project that has that slug
function card(slug: string, shots: Shot[]): string {
  const total = shots.reduce((sum, shot) => sum + shot.bytes, 0);
  return `<section class="card">
  <label><input type="checkbox" value="${escapeHtml(slug)}"> <b>${escapeHtml(slug)}</b> <span>${formatSize(total)}</span></label>
  <div class="row">${shots.map(figure).join('\n')}</div>
</section>`;
}

function group(title: string, shots: Shot[]): string {
  const bySlug = new Map<string, Shot[]>();
  for (const shot of shots) {
    const slug = slugOf(shot.file);
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), shot]);
  }
  const cards = [...bySlug.keys()]
    .sort()
    .map((slug) => card(slug, bySlug.get(slug)!));
  return `<h2>${title} (${bySlug.size})</h2>\n<div class="grid">${cards.join('\n')}</div>`;
}

function main(): void {
  const shots = Object.fromEntries(
    PROJECTS.map((project) => [project, listShots(project)])
  ) as Record<Project, Shot[]>;
  const all = PROJECTS.flatMap((project) => shots[project]);
  const totalBytes = all.reduce((sum, shot) => sum + shot.bytes, 0);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Screenshot review</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 16px; background: #f4f4f5; color: #18181b; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(640px, 1fr)); gap: 16px; }
  .card { background: #fff; border-radius: 8px; padding: 12px; }
  .card:has(input:checked) { outline: 3px solid #16a34a; }
  .card label { display: block; margin-bottom: 8px; cursor: pointer; }
  .card label span { color: #71717a; }
  .row { display: flex; gap: 8px; }
  figure { margin: 0; flex: 1; min-width: 0; }
  img { width: 100%; display: block; border: 1px solid #e4e4e7; }
  figcaption { color: #71717a; font-size: 12px; margin-top: 4px; }
  #picks { position: sticky; top: 0; z-index: 1; background: #fff; padding: 8px 12px; border-radius: 8px; box-shadow: 0 1px 4px #0002; }
  #picks textarea { width: 100%; height: 3em; font: 12px monospace; }
</style>
</head>
<body>
<h1>Screenshot review</h1>
<p>${all.length} files, ${formatSize(totalBytes)} total.</p>
<div id="picks">Picks (<span id="count">0</span>):<textarea id="list" readonly></textarea></div>
${group('Stills', [...shots.light, ...shots.dark])}
${group('Mobile', shots.mobile)}
${group('GIFs', shots.gifs)}
<script>
  const boxes = [...document.querySelectorAll('input[type=checkbox]')];
  const update = () => {
    const picked = boxes.filter((box) => box.checked).map((box) => box.value);
    document.getElementById('count').textContent = picked.length;
    document.getElementById('list').value = picked.join(' ');
  };
  boxes.forEach((box) => box.addEventListener('change', update));
</script>
</body>
</html>
`;

  writeFileSync(OUTPUT_PATH, html);
  for (const project of PROJECTS) {
    const bytes = shots[project].reduce((sum, shot) => sum + shot.bytes, 0);
    console.log(
      `[contact-sheet] ${project}: ${shots[project].length} files, ${formatSize(bytes)}`
    );
  }
  console.log(
    `[contact-sheet] Total: ${all.length} files, ${formatSize(totalBytes)}`
  );
  console.log(`[contact-sheet] Wrote ${OUTPUT_PATH}`);
}

main();
