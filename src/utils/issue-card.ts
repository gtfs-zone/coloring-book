/**
 * Feed issue card.
 *
 * A warning card listing data-quality problems as label/count rows with an
 * optional explanatory note. Renders nothing when every count is zero, so a
 * clean feed does not leave an empty card as furniture.
 *
 * Shared shape with test-track's status page, which repeats this markup in
 * renderMapIssues / renderStationIssues / renderPaddedColumns.
 */

import { escapeHtml } from './escape-html.js';

export interface IssueRow {
  label: string;
  count: number;
  note?: string;
}

export function renderIssueCard(title: string, rows: IssueRow[]): string {
  const present = rows.filter((row) => row.count > 0);
  if (present.length === 0) {
    return '';
  }

  const body = present
    .map(
      (row) => `
        <div>
          <div class="flex justify-between gap-2 text-sm">
            <span>${escapeHtml(row.label)}</span>
            <span class="tabular-nums font-semibold">${row.count}</span>
          </div>
          ${
            row.note
              ? `<p class="text-xs opacity-50">${escapeHtml(row.note)}</p>`
              : ''
          }
        </div>
      `
    )
    .join('');

  return `
    <section class="space-y-2">
      <h3 class="font-semibold text-sm">${escapeHtml(title)}</h3>
      <div class="rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-2">
        ${body}
      </div>
    </section>
  `;
}
