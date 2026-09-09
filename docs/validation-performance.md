# Feed validation performance

Context for anyone picking up the remaining cost of `GTFSValidator.validateFeed`.
Everything here was measured in Firefox on 2026-09-08/09, in the app, foreground,
via `window.gtfsEditor.validator`.

## Feed measured

MBTA, restored from IndexedDB (`feedGeneration` 1):

| table          | rows      |
| -------------- | --------- |
| stop_times.txt | 4,494,139 |
| shapes.txt     | 541,740   |
| trips.txt      | 168,145   |
| stops.txt      | 10,309    |
| routes.txt     | 399       |

## Per-pass timings

`validateFeed` total: **3495ms**. Passes timed individually, after the
`Object.entries` fix in `bfb42ca`, with the pre-fix numbers alongside. These
are the numbers the time-format fast path below was measured against; re-run
the snippet at the end to refresh them.

| pass                        | ms       | before `bfb42ca` |
| --------------------------- | -------- | ---------------- |
| validateStopTimes           | 944      | 1042             |
| validateFieldWhitespace     | 864      | 2375             |
| validateForeignKeys         | 706      | 806              |
| validateFlexLocations       | 417      | 465              |
| validateConditionalPresence | 303      | 625              |
| validateReferences          | 241      | 214              |
| validateShapes              | 42       | 76               |
| validateTrips               | 32       | 32               |
| validateStops               | 10       | 18               |
| everything else             | 0-3 each | 0-2 each         |

Total was 6383ms before the fix, so replacing `Object.entries(row)` with
`for...in` in the whitespace pass took 45% off the whole validation (measured in
isolation: 894ms vs 142ms per million rows). The remaining four hot passes are
untouched.

The same breakdown on a 3-route feed totals 13ms, so this is purely a
rows-scale problem, not fixed overhead.

## Already ruled out

- **Yield overhead.** `yieldToEventLoop` is a MessageChannel round trip, not
  `setTimeout` (which a hidden tab clamps to ~1s; that was a separate bug, fixed
  in `dd8c47d`). `eachRow` yields every `HYDRATE_YIELD_ROWS = 25_000` rows, so
  stop_times costs ~180 yields at roughly 0.05ms each.
- **Row copying.** `getFileDataSyncTyped` returns the live array via
  `getFileDataSync` (`src/modules/gtfs-parser.ts:1900`); it does not clone. The
  copy-on-read invariant applies to `GTFSDatabase` virtual tables, not to this
  path.
- **Repeated table reads.** `validateForeignKeys` already groups declarations by
  file and memoizes target value sets in a per-call `valueCache`
  (`collectValues`, `gtfs-validator.ts:1557`).

## Where the remaining time goes

All four remaining hot passes are single linear walks of stop_times (4.5M rows),
so the cost is per-row work, not algorithmic blowup:

- `validateStopTimes` (`:586`) - per row: `String()` conversions, `parseInt`,
  and two `isValidTime` calls.
- `validateForeignKeys` (`:1372`) - per row per declared foreign key: a
  `String(row[field] ?? '')` and a `Set.has`.
- `validateConditionalPresence` (`:1156`) - runs `validateFlexStopTimeRow` on
  every stop_times row.
- `validateFlexLocations` (`:944`) - walks stop_times again for flex pairing
  (two walks at the time this was measured, one since).

Ideas worth evaluating:

1. ~~**One pass over stop_times instead of four.**~~ Tried and rejected, see
   "Fusing the four passes" below: the shared cost is the loop, and the loop is
   not where the time is.
2. **Skip work when the answer cannot change.** Validation runs on every feed
   swap and on every staleness-key change (`refreshFeedIssuesIfStale` in
   `src/modules/feed-issues.ts`). After an edit that touched three rows, the
   whole feed is swept again. A patch-scoped incremental revalidation is the
   real fix but is a design change, not a tweak.
3. **Move it off the main thread.** A worker would need its own copy of the
   rows, which conflicts with the parser owning the live arrays.

## Fusing the four passes: measured, rejected

The four hot passes were fused into a single walk of stop_times, each check
writing to its own bucket so the published messages stayed byte-identical. On a
1.5M-row synthetic feed under Node 25 the fused walk came out **slower** than
the four separate ones (`validateFeed` 1916ms fused against 1797ms unfused).

The premise was wrong. What four passes share is the loop, and the loop is
almost free: `eachRow` over 1.5M rows with an empty callback, yields included,
costs **7ms**. Fusing four walks of 4.5M rows can therefore save about 60ms out
of 2370ms, and that ceiling is below the cost of the extra per-row call
indirection the fused body needs. Per-row costs measured the same way, over
1.5M rows:

| per-row work                            | ms  |
| --------------------------------------- | --- |
| `isValidTime` x2 (`validateValue`)      | 784 |
| `String(v) + Set.has` (one foreign key) | 113 |
| `parseInt(stop_sequence)`               | 31  |
| `String(row.trip_id)`                   | 24  |
| bare `eachRow` walk, empty callback     | 7   |

The passes do not share per-row work with each other - they read different
fields - so the only thing worth attacking is the per-row work itself.

## What changed

Two changes, both keeping every code, entity payload and message byte-identical
(verified by diffing full `ValidationResults` before and after on a feed
exercising all five stop_times checks):

- **A canonical-time fast path** (`isCanonicalTime` in
  `src/utils/field-formatters.ts`). `timeFormatter.validate` trimmed, ran a
  regex, then `split(':')` and three `parseInt`s; the validator calls it twice
  per stop_times row. Reading eight character codes instead costs 52ms against
  665ms over 1.5M rows, two calls each. The shortcut is deliberately narrower
  than the rule - `8:00:00`, or anything needing a trim, falls through to the
  full path - so it can skip work but never change a verdict. Checked against
  the pre-change verdict over all 1,000,000 `HH:MM:SS` combinations plus 31
  malformed shapes: no disagreement.
- **One walk instead of two in `validateFlexRowPairing`.** Only a row that is
  one half of a documented pair can ever be reported, so the counting walk now
  keeps those rows and the reporting phase iterates them rather than the whole
  table again.

Node 25, synthetic feed, 1.5M stop_times rows, median of repeated runs:

| pass                        | before | after |
| --------------------------- | ------ | ----- |
| validateFeed                | 2258   | 1167  |
| validateStopTimes           | 805    | 147   |
| validateFlexLocations       | 152    | 83    |
| validateForeignKeys         | 415    | 429   |
| validateConditionalPresence | 197    | 214   |
| validateFieldWhitespace     | 271    | 231   |

Node is not Firefox and a synthetic feed is not the MBTA one, so the table
above the fold still needs refreshing in the app with the snippet below. What
should carry across engines is the shape: stop_times' time validation stops
being the largest single cost.

## What is left

`validateForeignKeys` (~700ms in the app) is now the biggest per-row cost, and
it is already down to a `String()` and a `Set.has` per declared key. Squeezing
it further means avoiding the `String()` on values that are already strings,
which is worth maybe a third of it. After that the remaining ideas are the
incremental revalidation in point 2 above and the worker in point 3.

## Constraints any fix must respect (from CLAUDE.md)

- **Copy-on-read**: virtual table query methods return shallow copies. Do not
  cache a query result and assume it stays current.
- **Feed-scoped caches key on `feedGeneration` or subscribe to
  `onFeedReplaced`**: a cache guarded only by `if (this.cache)` pins the empty
  boot scaffold for the session. Any memoization added here must carry
  `parser.feedGeneration` (and the patch version, which is the other half of the
  staleness key) in its key.
- **Never yield with `setTimeout`** on a long job; use `yieldToEventLoop`.

## How to re-measure

Paste into the app console with the feed loaded, foreground. It prints a total
plus the per-pass breakdown and copies the result to the clipboard.

```js
window.__names = [
  'validateRequiredFiles',
  'validateAgencies',
  'validateRoutes',
  'validateTrips',
  'validateStops',
  'validateStopTimes',
  'validateCalendar',
  'validateShapes',
  'validateNetworks',
  'validateStopAreas',
  'validateFlexLocations',
  'validateTransfers',
  'validateFrequencies',
  'validateConditionalPresence',
  'validateRiderCategoryDefaults',
  'validateForeignKeys',
  'validateFieldWhitespace',
  'validateConstrainedCodes',
  'validateReferences',
];
window.__passes = async function () {
  var v = window.gtfsEditor.validator;
  var out = {};
  var s0 = performance.now();
  await v.validateFeed();
  out.__total_ms = Math.round(performance.now() - s0);
  for (var n of window.__names) {
    var s = performance.now();
    try {
      await v[n]();
    } catch (e) {
      out[n] = 'ERR ' + e.message;
      continue;
    }
    out[n] = Math.round(performance.now() - s);
  }
  var t = 'PASSES ' + JSON.stringify(out);
  window.__last = t;
  console.log(t);
  try {
    copy(t);
  } catch (e) {}
  return t;
};
__passes();
```
