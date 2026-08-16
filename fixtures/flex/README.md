# GTFS Flex conformance fixtures

Four hand-written minimal feeds, one per worked example in the official
demand-responsive service documentation. They exist to be loaded by hand and
looked at: nothing automated reads them.

Build the zips (the Load dialog only accepts `.zip`), then drag one in:

```bash
./fixtures/flex/build.sh   # writes fixtures/flex/dist/*.zip
```

`dist/` is gitignored; the `.txt` sources are the checked-in artifact.

| Fixture          | Shape                                                                                                                                              | What it exercises                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `single-zone`    | Two trips, each with two stop_times on the **same** `location_id`, `(2,1)` then `(1,2)`                                                            | Two rows for one zone must not collapse into one. `stops.txt` is header-only, so it is also the zero-stops viewport fit. |
| `multiple-zones` | `dr2_weekday` serves `area_713` `(2,1)` then `area_714` `(1,2)`; `dr2_evening` serves `area_714` only                                              | Two zones on one trip, `booking_type=2` (prior day), and a zone row with cells on a trip that does not serve it.         |
| `location-group` | As `single-zone` but with `location_group_id`, plus `location_groups.txt` and `location_group_stops.txt`                                           | Location group rendering and hover over its member stops, `booking_type=0` (real time).                                  |
| `deviated-route` | One trip interleaving timed `stop_id` rows with windowed `location_id` rows at `(1,3)`, `shape_dist_traveled` on the fixed rows, plus `shapes.txt` | Interleaved order must survive; the fixed stops and the deviation zones must fit together.                               |

## What to check on each

- The route page renders without throwing.
- The diagram and the timetable show **one row per stop_time** - two rows for
  the same zone in `single-zone` and `location-group`, not one.
- The window renders in the two time spans, not as arrival/departure.
- The feed validator reports no false positives (a legitimately dangling
  reference is a true positive and should be reported).
- Export round-trips the flex columns: empty `arrival_time`/`departure_time` on
  flex rows, empty window columns on timed rows, and `deviated-route` keeps its
  interleaved `stop_sequence` order.
- In `multiple-zones`, the `area_713` rows are empty under `dr2_evening`: they
  must render as blank window spans with no badges, never as arrival/departure.
  Typing a window there creates the stop_time and copies `(2,1)` from
  `dr2_weekday`, announced in the notification.
- Clearing either window end of a zone row removes that trip's stop_time
  outright, as one entry in the Changes panel. Undo must bring it back with its
  types and booking rules intact.
