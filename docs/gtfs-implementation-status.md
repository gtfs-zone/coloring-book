# GTFS Implementation Status

Tracks which GTFS Schedule files are supported in the GTFS.zone UI. Spec version: **2026-04**.

UI support levels:
- **Full** — dedicated view or map visualization beyond the generic table editor
- **Partial** — generic table editor with field descriptions, validation, and foreign key awareness; no dedicated view
- **None** — no editing or visualization support

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
| `feed_info.txt` | Conditionally Required | Partial | Table editor only |
| `frequencies.txt` | Optional | Partial | Table editor only |
| `transfers.txt` | Optional | Partial | Table editor only |
| `pathways.txt` | Optional | Partial | Table editor only |
| `levels.txt` | Conditionally Required | Partial | Table editor only |
| `fare_attributes.txt` | Optional | Partial | Fares v1 — table editor only |
| `fare_rules.txt` | Optional | Partial | Fares v1 — table editor only |
| `fare_media.txt` | Optional | Partial | Fares v2 — table editor only |
| `fare_products.txt` | Optional | Partial | Fares v2 — table editor only |
| `fare_leg_rules.txt` | Optional | Partial | Fares v2 — table editor only |
| `fare_leg_join_rules.txt` | Optional | Partial | Fares v2 — table editor only |
| `fare_transfer_rules.txt` | Optional | Partial | Fares v2 — table editor only |
| `timeframes.txt` | Optional | Partial | Fares v2 — table editor only |
| `rider_categories.txt` | Optional | Partial | Fares v2 — table editor only |
| `areas.txt` | Optional | Partial | Table editor only |
| `stop_areas.txt` | Optional | Partial | Table editor only |
| `networks.txt` | Conditionally Forbidden | Partial | Table editor only; mutually exclusive with `routes.network_id` |
| `route_networks.txt` | Conditionally Forbidden | Partial | Table editor only; mutually exclusive with `routes.network_id` |
| `location_groups.txt` | Optional | Partial | Flex transit — table editor only |
| `location_group_stops.txt` | Optional | Partial | Flex transit — table editor only |
| `booking_rules.txt` | Optional | Partial | Flex transit — table editor only |
| `translations.txt` | Optional | Partial | Table editor only |
| `attributions.txt` | Optional | Partial | Table editor only |
| `locations.geojson` | Optional | None | GeoJSON format; not supported by the table editor |
