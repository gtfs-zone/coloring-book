/**
 * The feed_info active range, held for date pickers to shade.
 *
 * Pickers open synchronously, so the range is read ahead of time and kept
 * here. Set only when feed_info carries both dates.
 */

import { feedBounds, type FeedBoundsSource } from './feed-bounds';
import { t } from '../i18n/messages';

export interface FeedActiveRange {
  /** `YYYY-MM-DD`, the inline editor's date format. */
  start: string;
  end: string;
  /** Legend text for the band. */
  label: string;
}

let current: FeedActiveRange | null = null;

/** `YYYYMMDD` to `YYYY-MM-DD`, or null when it is not a GTFS date. */
function gtfsToIso(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** Recompute the range from feed_info. */
export async function refreshFeedActiveRange(
  db: FeedBoundsSource
): Promise<void> {
  const bounds = await feedBounds(db);
  const start = bounds.start ? gtfsToIso(bounds.start) : null;
  const end = bounds.end ? gtfsToIso(bounds.end) : null;
  if ((bounds.start && !start) || (bounds.end && !end)) {
    console.warn(
      `[FeedActiveRange] feed_info dates are not YYYYMMDD: ${bounds.start} to ${bounds.end}`
    );
  }
  const next =
    start && end ? { start, end, label: t('bounds.feedActive') } : null;
  if (next?.start === current?.start && next?.end === current?.end) {
    return;
  }
  current = next;
  console.log(
    `[FeedActiveRange] ${next ? `${next.start} to ${next.end}` : 'cleared'}`
  );
}

export function getFeedActiveRange(): FeedActiveRange | null {
  return current;
}
