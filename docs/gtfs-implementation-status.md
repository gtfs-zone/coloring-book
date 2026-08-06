# GTFS Implementation Status

Tracks which GTFS Schedule files are supported in the GTFS.zone UI. Spec version: **2026-04-27**.

UI support levels:
- **Full**: dedicated view or map visualization beyond the generic table editor
- **Partial**: generic table editor with field descriptions, validation, and foreign key awareness; no dedicated view
- **None**: no editing or visualization support

| File | File Presence | UI Support | Notes |
|------|---------------|------------|-------|
| `agency.txt` | Required | Full | Dedicated agency view with inline editing and related routes list |
| `stops.txt` | Required | Full | Map pin visualization, stop clustering, dedicated stop detail panel |
| `routes.txt` | Required | Full | Map route line rendering, color-coded by `route_color`, route detail panel |
| `trips.txt` | Required | Full | Schedule/timetable view, direction filtering |
| `stop_times.txt` | Required | Full | Timetable grid with arrival/departure times per trip |
| `calendar.txt` | Conditionally Required | Full | Service view with weekly pattern editor (Mon–Sun toggles) |
| `calendar_dates.txt` | Conditionally Required | Full | Exception date editing within the service view |
| `shapes.txt` | Optional | Full | Route shape polylines rendered on map |
| `feed_info.txt` | Conditionally Required | Full | Dedicated inline-editable properties panel on the home page |
| `frequencies.txt` | Optional | Partial | Table editor only |
| `transfers.txt` | Optional | Partial | Table editor only |
| `pathways.txt` | Optional | Partial | Table editor only |
| `levels.txt` | Conditionally Required | Partial | Table editor only |
| `fare_attributes.txt` | Optional | Partial | Fares v1: table editor only |
| `fare_rules.txt` | Optional | Partial | Fares v1: table editor only |
| `fare_media.txt` | Optional | Full | Fares v2 editor |
| `fare_products.txt` | Optional | Full | Fares v2 editor; `amount` shown in the row's currency |
| `fare_leg_rules.txt` | Optional | Full | Fares v2 editor with pickers for every referenced table |
| `fare_leg_join_rules.txt` | Optional | Full | Fares v2 editor |
| `fare_transfer_rules.txt` | Optional | Full | Fares v2 editor |
| `timeframes.txt` | Optional | Full | Fares v2 editor |
| `rider_categories.txt` | Optional | Full | Fares v2 editor |
| `areas.txt` | Optional | Full | Fares v2 editor, with the stops in each area |
| `stop_areas.txt` | Optional | Full | Edited from the stop page; platforms inherit their station's areas |
| `networks.txt` | Conditionally Forbidden | Full | Fares v2 editor; canonical in-app form, see the networks invariant in CLAUDE.md |
| `route_networks.txt` | Conditionally Forbidden | Full | Assigned from the route page; canonical in-app form |
| `location_groups.txt` | Optional | Partial | Flex transit: table editor only |
| `location_group_stops.txt` | Optional | Partial | Flex transit: table editor only |
| `booking_rules.txt` | Optional | Partial | Flex transit: table editor only |
| `translations.txt` | Optional | Partial | Table editor only |
| `attributions.txt` | Optional | Partial | Table editor only |
| `locations.geojson` | Optional | None | GeoJSON format; not supported by the table editor |
