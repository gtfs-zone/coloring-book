# GTFS Implementation Status

Tracks which GTFS Schedule files are supported in the GTFS.zone UI. Spec version: **2026-04-27**.

UI support levels:
- **Full**: dedicated view, editor or map visualization beyond the generic table viewer
- **Partial**: generic table viewer (Files) with field descriptions, validation, and foreign key awareness; no dedicated view
- **None**: no editing or visualization support

| File | File Presence | UI Support | Notes |
|------|---------------|------------|-------|
| `agency.txt` | Required | Full | Dedicated agency view with inline editing and related routes list |
| `stops.txt` | Required | Full | Map pin visualization, stop clustering, dedicated stop detail panel |
| `routes.txt` | Required | Full | Map route line rendering, color-coded by `route_color`, route detail panel |
| `trips.txt` | Required | Full | Schedule/timetable view, direction filtering |
| `stop_times.txt` | Required | Full | Timetable grid with arrival/departure times per trip |
| `calendar.txt` | Conditionally Required | Full | Service view with weekly pattern editor (Mon-Sun toggles) |
| `calendar_dates.txt` | Conditionally Required | Full | Exception date editing within the service view |
| `shapes.txt` | Optional | Full | Route shape polylines rendered on map, simplification, geojson.io round trip |
| `feed_info.txt` | Conditionally Required | Full | Dedicated inline-editable properties panel on the home page |
| `frequencies.txt` | Optional | Full | Headway periods edited per trip in the timetable |
| `transfers.txt` | Optional | Full | Drawn as edges from the focused stop on the map, listed on the stop page, edited in the Feed Data modal |
| `pathways.txt` | Optional | Full | Drawn on the map inside an expanded station, created from the map, own pathway page |
| `levels.txt` | Conditionally Required | Full | Levels editor with the stops on each level |
| `fare_attributes.txt` | Optional | Partial | Fares v1: table viewer only |
| `fare_rules.txt` | Optional | Partial | Fares v1: table viewer only |
| `fare_media.txt` | Optional | Full | Fares v2 editor |
| `fare_products.txt` | Optional | Full | Fares v2 editor; `amount` shown in the row's currency |
| `fare_leg_rules.txt` | Optional | Full | Fares v2 editor with pickers for every referenced table |
| `fare_leg_join_rules.txt` | Optional | Full | Fares v2 editor |
| `fare_transfer_rules.txt` | Optional | Full | Fares v2 editor |
| `timeframes.txt` | Optional | Full | Fares v2 editor |
| `rider_categories.txt` | Optional | Full | Fares v2 editor |
| `areas.txt` | Optional | Full | Fares v2 editor, with the stops in each area |
| `stop_areas.txt` | Optional | Full | Edited from the stop page; platforms inherit their station's areas |
| `networks.txt` | Conditionally Forbidden | Full | Fares v2 editor; canonical in-app form, see [architecture.md](architecture.md#networks) |
| `route_networks.txt` | Conditionally Forbidden | Full | Assigned from the route page; canonical in-app form |
| `location_groups.txt` | Optional | Full | On-demand editor, own location group page with members and routes, members shown on the map |
| `location_group_stops.txt` | Optional | Full | Members edited on the location group page and in the on-demand editor |
| `booking_rules.txt` | Optional | Full | On-demand editor; assigned from the timetable |
| `translations.txt` | Optional | Full | Feed Data modal; not yet applied to displayed labels |
| `attributions.txt` | Optional | Full | Feed Data modal; shown as cards on the home page |
| `locations.geojson` | Optional | Full | Zones on the map, own zone page, geometry edited through a geojson.io round trip |
