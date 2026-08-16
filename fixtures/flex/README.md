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
| `single-zone`    | One trip, two stop_times on the **same** `location_id`, `(2,1)` then `(1,2)`                                                                       | Two rows for one zone must not collapse into one. `stops.txt` is header-only, so it is also the zero-stops viewport fit. |
| `multiple-zones` | One trip, `area_713` `(2,1)` then `area_714` `(1,2)`                                                                                               | Two zones on one trip, `booking_type=2` (prior day).                                                                     |
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
