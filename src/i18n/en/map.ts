/** Map, pathways and GeoJSON exchange, in English. */
export const map = {
  'map.newStop': 'New stop',
  'map.invalidStop': 'Invalid stop',
  'map.stationNotEndpoint':
    'Stations (location_type=1) cannot be pathway endpoints. Select a platform, entrance, generic node, or boarding area.',
  'map.pathwayFrom': 'From: {id}. Now click the second stop to connect.',
  'map.invalidPathway': 'Invalid pathway',
  'map.sameEndpoints': 'The two endpoints must be different stops.',
  'map.fromStop': 'From Stop',
  'map.toStop': 'To Stop',
  'map.newPathway': 'New Pathway',
  'map.createPathway': 'Create Pathway',
  'map.pathwayMode': 'Pathway Mode',
  'map.bidirectional': 'Bidirectional',
  'map.exitGateOneWay': 'Exit gates (mode 7) must not be bidirectional.',
  'map.clickTwoStops': 'Click two stops to make a pathway between them.',
  'map.ok': 'OK',
  'map.coordsFailed': 'Failed to update stop coordinates: {message}',
  'map.unnamedStop': 'Unnamed Stop',
  'map.servedBy': '{serves} of {total} trips',
  'map.servedByTitle': 'Served by {serves} of {total} trips',
  'map.routeDiagram': 'Route diagram',
  'geo.noId': '(no id)',
  'geo.nothing': 'nothing',
  'geo.noPolygon': 'No polygon for zone "{id}" in the GeoJSON. Found: {found}.',
  'geo.noGeometry':
    'This zone has no geometry. Draw it in geojson.io or paste GeoJSON below.',
  'geo.type': 'Type',
  'geo.vertices': 'Vertices',
  'geo.bounds': 'Bounds',
  'geo.zoneGone':
    'Zone {id} is no longer in locations.geojson. Reload the page.',
  'geo.zoneUpdated': 'Updated geometry for zone {id}',
  'geo.noFeatureWithId':
    'No feature with id "{id}" in the GeoJSON. Found: {found}.',
  'geo.expectedOne':
    'Expected one feature, got {count}. Keep only the one you want.',
  'geo.editorEmpty': 'The editor is empty.',
  'geo.invalidJson': 'Not valid JSON: {message}',
  'geo.noFeaturesArray': 'FeatureCollection has no features array.',
  'geo.expectedFeature':
    'Expected a GeoJSON Feature or FeatureCollection, got {type}.',
  'geo.importTitle': 'Import GeoJSON from URL',
  'geo.importBody':
    'Paste a geojson.io share link, or the URL of a GeoJSON file to fetch. Nothing is saved until you press Save.',
  'geo.url': 'URL',
  'geo.useCors': 'Use CORS proxy',
  'geo.fetch': 'Fetch',
  'geo.defaultHint':
    'To pull an edit back in, use Share in geojson.io and paste the link here. geojson.io no longer keeps the data in the address bar while you draw.',
  'geo.editIn': 'Edit in geojson.io',
  'geo.importFromUrl': 'Import from URL',
  'geo.pastedNoId':
    'A pasted feature has no id. Every zone needs an `id` matching its location_id.',
  'geo.duplicateId': 'Duplicate zone id in the pasted GeoJSON: {id}',
  'geo.notPolygon':
    'Zone {id} came back with geometry {type}, expected a Polygon or MultiPolygon. Draw the zone in geojson.io first, then Share and paste the link.',
  'search.zoneTerms': 'zone on-demand',
  'search.groupTerms': 'location group',
} as const;
