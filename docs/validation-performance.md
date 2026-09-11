# Feed validation performance

Context for anyone picking up the cost of `GTFSValidator.validateFeed`.
Everything here was measured in Firefox, in the app, foreground, via
`window.gtfsEditor.validator`, on 2026-09-08/10.

## Feed measured

MBTA, restored from IndexedDB:

| table          | rows      |
| -------------- | --------- |
| stop_times.txt | 4,494,139 |
| shapes.txt     | 541,740   |
| trips.txt      | 168,145   |
| stops.txt      | 10,309    |
| routes.txt     | 399       |

The same breakdown on a 3-route feed totals 13ms, so this is purely a
rows-scale problem, not fixed overhead.

## Where the time goes

A cold `validateFeed` is **3165ms**. Six passes walk stop_times and are
almost all of it:

| pass                        | ms       |
| --------------------------- | -------- |
| validateFieldWhitespace     | 903      |
| validateForeignKeys         | 657      |
| validateStopTimes           | 656      |
| validateConditionalPresence | 402      |
| validateFlexLocations       | 232      |
| validateReferences          | 158      |
| validateShapes              | 43       |
| validateTrips               | 35       |
| validateStops               | 8        |
| everything else             | 0-2 each |

The six that touch stop_times are `validateStopTimes`, `validateForeignKeys`,
`validateFlexLocations`, `validateConditionalPresence`, `validateFieldWhitespace`
(which walks every table) and `validateReferences` (which builds the set of
trip_ids that have stop times, for TRIP_WITHOUT_STOP_TIMES). Each is a single
linear walk, so the cost is per-row work, not algorithmic blowup.

## Already ruled out

- **Yield overhead.** `yieldToEventLoop` is a MessageChannel round trip, not
  `setTimeout` (which a hidden tab clamps to ~1s; that was a separate bug, fixed
  in `dd8c47d`). `eachRow` yields every `HYDRATE_YIELD_ROWS = 25_000` rows, so
  stop_times costs ~180 yields at roughly 0.05ms each.
- **Row copying.** `getFileDataSyncTyped` returns the live array via
  `getFileDataSync` (`src/modules/gtfs-parser.ts`); it does not clone. The
  copy-on-read invariant applies to `GTFSDatabase` virtual tables, not to this
  path.
- **Repeated table reads.** `validateForeignKeys` groups declarations by file
  and memoizes target value sets in a per-call `valueCache` (`collectValues`).
- **Fusing the hot passes into one walk.** Tried, measured, rejected. On a
  1.5M-row synthetic feed under Node 25 the fused walk came out _slower_ than
  the separate ones (`validateFeed` 1916ms fused against 1797ms unfused). The
  premise was wrong: what the passes share is the loop, and the loop is almost
  free. Per-row costs over 1.5M rows, measured the same way:

  | per-row work                            | ms  |
  | --------------------------------------- | --- |
  | `isValidTime` x2 (`validateValue`)      | 784 |
  | `String(v) + Set.has` (one foreign key) | 113 |
  | `parseInt(stop_sequence)`               | 31  |
  | `String(row.trip_id)`                   | 24  |
  | bare `eachRow` walk, empty callback     | 7   |

  Fusing four walks of 4.5M rows can therefore save about 60ms out of 2370ms,
  below the cost of the extra per-row call indirection a fused body needs. The
  passes read different fields, so they share no per-row work with each other.

- **A worker.** It would need its own copy of the rows, which conflicts with
  the parser owning the live arrays.

## What has been done

### Cheaper per-row work

Three changes, each keeping every code, entity payload and message
byte-identical:

- **`for...in` instead of `Object.entries(row)`** in the whitespace pass
  (`bfb42ca`). Building a pairs array for each of stop_times' millions costs
  more than the check itself: 894ms against 142ms per million rows. This alone
  took the total from 6383ms to 3495ms.
- **A canonical-time fast path** (`isCanonicalTime` in
  `src/utils/field-formatters.ts`). `timeFormatter.validate` trimmed, ran a
  regex, then `split(':')` and three `parseInt`s; the validator calls it twice
  per stop_times row. Reading eight character codes instead costs 52ms against
  665ms over 1.5M rows. The shortcut is deliberately narrower than the rule -
  `8:00:00`, or anything needing a trim, falls through to the full path - so it
  can skip work but never change a verdict. Checked against the pre-change
  verdict over all 1,000,000 `HH:MM:SS` combinations plus 31 malformed shapes:
  no disagreement.
- **One walk instead of two in `validateFlexRowPairing`.** Only a row that is
  one half of a documented pair can ever be reported, so the counting walk keeps
  those rows and the reporting phase iterates them rather than the whole table
  again.

### Incremental revalidation of stop_times

`refreshFeedIssuesIfStale` re-runs `validateFeed` whenever
`${feedGeneration}:${patchManager.version}` moves, so an edit touching three
rows used to re-walk 4.5M of them. `src/modules/stop-times-validation-cache.ts`
now remembers what the six stop_times passes produced and watches the patch log,
and `validateFeed` reuses it when the edit could not have changed it.

Measured on the MBTA feed:

| sweep                                | ms   |
| ------------------------------------ | ---- |
| cold (nothing cached)                | 3395 |
| warm, nothing edited                 | 356  |
| warm, one edited row rechecked       | 459  |
| end to end, edit to published issues | 610  |

The correctness bar is that the published `ValidationResults` after a warm sweep
is byte-identical to what a cold one would have produced. That is structural
rather than tested after the fact: each row-local check lives in one function
(`stopTimeRowIssues`, `conditionalRowIssues`, `whitespaceRowIssues`,
`foreignKeyRowIssues`, `flexLocationRowIssues`) used by both the cold walk and
the recheck, the passes run in the same order, and each pass's cached chunk is
replayed in row order. Verified on the MBTA feed by comparing the `file:code:field`
issue-group map across a cold and a warm sweep.

**What the cache holds.** Five sparse lists of `{ index, messages }` sorted by
row index, one per row-local chunk; `validateFlexRowPairing`'s warnings whole,
because it is an aggregate over every trip on a route; and
`validateReferences`' `tripsWithStopTimes` set. Only offending rows get an
entry, so on a clean feed the cache is empty.

**What forces a full sweep.** The model is deliberately conservative: anything
it cannot prove falls back, and the reason is logged with a
`[StopTimesValidationCache]` prefix.

- An insert or delete in stop_times. Row numbers are in both the message text
  (`Row N`) and `line`, so one added row shifts every later message. This is the
  largest fallback and there is no way around it short of dropping row numbers.
- A stop_times update touching `trip_id` or `stop_sequence` (it re-keys the row)
  or `location_id` / `location_group_id` (it moves the row in or out of the flex
  aggregates).
- A stop*times update touching `pickup_type` or `drop_off_type` \_on a row that
  names a location group or zone*. A row naming neither never enters
  `validateFlexRowPairing`, so the common timetable edit stays on the fast path.
  Which it is gets settled during the recheck walk, where the row is in hand.
- An edit to a table whose values the stop_times passes read: an insert or
  delete, or an update touching the field itself. The list is derived from the
  spec's foreign keys filtered to stop_times.txt (trips.trip_id, stops.stop_id,
  location_groups.location_group_id, booking_rules.booking_rule_id), plus two
  curated additions - `trips.route_id`, because pairing groups a trip's rows by
  its route, and any patch at all on locations.geojson, which is one JSON row
  rather than a column. Everything else (routes, calendar, shapes, fares) leaves
  the cache valid.
- A history jump, which carries no patch to classify.
- More than 200 touched rows, where the bookkeeping stops being cheaper than the
  walk.

**Why patch events rather than version numbers.** After an undo followed by a
new edit, `appendAndPush` deletes the discarded branch and reuses the version
number, so version N before and after can be two different patches. The cache
subscribes to `change` / `undo` / `redo` / `jump` instead. Direction does not
matter: an update's forward and inverse changes carry the same field names, and
an insert or delete forces a sweep either way.

Two guards catch anything the events missed, both logged loudly: the patch
version must have moved exactly as far as the observed events said, and the
stop_times row count must match what was cached.

**Finding an edited row's number** is the one linear step left on the warm path.
Row numbers are only available by position, and copy-on-read rules out matching
the stored row by identity, so `resolveTouchedRows` does a single walk with a
trip_id pre-filter, building the composite key only for rows that pass it. One
walk regardless of how many rows were edited.

### Sweeps are serialized

`validateFeed` yields between passes, and a patch event landing in one of those
gaps re-renders the home panel, which asks for the issues, which asks to
validate. Two sweeps interleaving wrote into the same results object and the
same cache. Callers now queue behind a running sweep, and `getValidationResults`
returns the last _completed_ sweep rather than the partially filled one.

## Where this stops

Validation work is done. The two rounds landed different things and only one of
them helps a reload:

- The per-row cost cuts took a cold sweep from 6383ms to 3165ms. A cold sweep is
  on the reload path (restore the feed, `validateAndUpdateInfo`, then the home
  panel awaits `refreshFeedIssuesIfStale` before it draws), so that is ~3s off
  every load of a large feed.
- The stop_times cache is in memory and keyed on `feedGeneration`, so every
  reload is still a cold sweep. What it buys is edit responsiveness: issues
  republish in ~610ms after an edit rather than ~3.4s.

The remaining validation item below (the other large tables) is **not being
done**. It targets the ~350ms residual of a warm sweep, which is under what a
user notices, and it would mean a second invalidation model for two more tables.
That is the wrong trade against "reliability over performance" and "simplicity
over abstraction". Reopen it only if a measurement shows a warm sweep mattering.

The blob-flush item is worth doing and is not validation cost. The next thing to
measure for load time is boot itself: set `DEBUG_BOOT` in `src/config.ts` and
read `[boot] restore stored feed` against `[boot] refresh after feed swap`.

## What is left

- **The other large tables.** Not planned, see above. A warm sweep is still
  ~350ms, and most of that is the non-stop_times half of
  `validateFieldWhitespace` and `validateForeignKeys` walking shapes (541k rows)
  and trips (168k). The same cache shape would apply; it was left out
  deliberately to keep the invalidation model small.
- **Blob persistence contending with the sweep.** A burst of edits triggers the
  debounced blob flush, which serialises the whole stop_times table on the main
  thread. Measured during a three-edit burst, warm sweeps that recheck a single
  row took 3894-4335ms rather than ~460ms, each one immediately after a
  `[GTFSParser] feed summary written` line. That is not validation cost, but it
  is what a user feels.
- **`validateForeignKeys`** is the biggest remaining per-row cost on a cold
  sweep, and it is down to a `String()` and a `Set.has` per declared key.
  Avoiding the `String()` on values that are already strings is worth maybe a
  third of it.

## Constraints any fix must respect (from CLAUDE.md)

- **Copy-on-read**: virtual table query methods return shallow copies. Do not
  cache a query result and assume it stays current.
- **Feed-scoped caches key on `feedGeneration` or subscribe to
  `onFeedReplaced`**: a cache guarded only by `if (this.cache)` pins the empty
  boot scaffold for the session. The stop_times cache carries `feedGeneration`
  and is dropped from the `onFeedReplaced` block in `src/index.ts`.
- **Never yield with `setTimeout`** on a long job; use `yieldToEventLoop`.

## How to re-measure

Paste into the app console with the feed loaded, foreground. It forces a cold
sweep, then times a warm one and each pass individually - a pass called on its
own always runs cold, so its number is comparable to the table above.

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
  await new Promise((r) => setTimeout(r, 2000));
  v.invalidateStopTimesCache('measurement');
  var s0 = performance.now();
  await v.validateFeed();
  out.__cold_ms = Math.round(performance.now() - s0);
  var s1 = performance.now();
  await v.validateFeed();
  out.__warm_ms = Math.round(performance.now() - s1);
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
  console.log(t);
  try {
    copy(t);
  } catch (e) {}
  return t;
};
__passes();
```

To check that a warm sweep still agrees with a cold one, compare the
`file:code:field` group maps either side of an edit:

```js
(async () => {
  const ed = window.gtfsEditor;
  const groups = (r) =>
    [...r.errors, ...r.warnings].reduce(
      (m, x) =>
        m.set(
          `${x.file}:${x.code}:${x.field ?? ''}`,
          (m.get(`${x.file}:${x.code}:${x.field ?? ''}`) ?? 0) + 1
        ),
      new Map()
    );
  ed.validator.invalidateStopTimesCache('measurement');
  const before = groups(await ed.validator.validateFeed());
  const rows = ed.gtfsParser.getFileDataSync('stop_times.txt');
  const row = rows[Math.floor(rows.length / 2)];
  await ed.patchManager.recordUpdate(
    'stop_times',
    `${row.trip_id}:${row.stop_sequence}`,
    { stop_headsign: row.stop_headsign ?? '' },
    { stop_headsign: 'probe ' + Date.now() }
  );
  await new Promise((r) => setTimeout(r, 5000));
  const after = groups(await ed.validator.validateFeed());
  const same =
    before.size === after.size &&
    [...before].every(([k, v]) => after.get(k) === v);
  console.log(`groupsUnchanged=${same}`, [...before], [...after]);
})();
```
