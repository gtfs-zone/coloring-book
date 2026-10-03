/** Validation messages, in English. */
export const validation = {
  'rule.bothOrNeither': '{a} and {b} must both be set, or both left empty',
  'rule.requiredWhen': '{field} is required when {condition}',
  'rule.forbiddenWhen': '{field} is forbidden when {condition}',
  'rule.wallClock': '{field} must be a wall-clock time in HH:MM:SS format',
  'rule.notAfter24': '{field} must not be later than 24:00:00',
  'cond.transferType': 'transfer_type is {type}',
  'cond.transferTypeStops': 'transfer_type is empty, 0, 1, 2, or 3',
  'cond.window': 'a pickup/drop-off window is defined',
  'cond.times': 'arrival_time or departure_time is defined',
  'cond.defined': '{field} is defined',
  'cond.timepoint': 'timepoint=1',
  'flexRule.oneOf':
    'one of stop_id, location_group_id or location_id is required',
  'flexRule.exclusive': '{fields} are mutually exclusive: name exactly one',
  'flexRule.and': ' and ',
  'flexRule.windowRequired':
    'a pickup/drop-off window is required when {field} is defined',
  'flexRule.windowForbidden':
    'a pickup/drop-off window is forbidden when arrival_time or departure_time is defined',
  'flexRule.windowOrder':
    'start_pickup_drop_off_window must not be later than end_pickup_drop_off_window',
  'flexRule.pickupType':
    'pickup_type must be 1 or 2 when a pickup/drop-off window is defined',
  'flexRule.dropOffType':
    'drop_off_type must be 1, 2 or 3 when a pickup/drop-off window is defined',
  'flexRule.continuous':
    '{field} must be 1 or empty when a pickup/drop-off window is defined',
  'flexRule.firstLast':
    'arrival_time is required for the first and last stop of a trip',
  'flexRule.pickupForbidden':
    'pickup_type={value} is forbidden when a pickup/drop-off window is defined; it must be 1 or 2',
  'flexRule.pickupEmpty':
    'pickup_type must be 1 or 2 when a pickup/drop-off window is defined; empty is equivalent to 0',
  'flexRule.dropOffForbidden':
    'drop_off_type=0 is forbidden when a pickup/drop-off window is defined; it must be 1, 2 or 3',
  'flexRule.dropOffEmpty':
    'drop_off_type must be 1, 2 or 3 when a pickup/drop-off window is defined; empty is equivalent to 0',
  'flexRule.continuousForbidden':
    '{field}={value} is forbidden when a pickup/drop-off window is defined; it must be 1 or empty',
  'booking.requiredFor': '{field} is required for booking_type={type}',
  'booking.forbiddenFor': '{field} is forbidden for booking_type={type}',
  'booking.startDayMax':
    'prior_notice_start_day is forbidden for booking_type=1 when prior_notice_duration_max is defined',
  'booking.serviceOnly2':
    'prior_notice_service_id is only allowed for booking_type=2, not booking_type={type}',
  'ids.groupTaken':
    "location_group_id '{id}' is already used as {owner}; the ID must be unique across stops.txt, locations.geojson and location_groups.txt",
  'ids.taken':
    '"{id}" is already used as {owner}; the ID must be unique across stops.txt, locations.geojson and location_groups.txt.',
  'ids.ownerStop': 'a stops.txt stop_id',
  'ids.ownerZone': 'a locations.geojson id',
  'ids.ownerGroup': 'a location_groups.txt location_group_id',
  'freq.required': '{field} is required',
  'freq.invalidTime': "{field} '{value}' is not a valid time",
  'freq.endAfterStart': 'end_time must be later than start_time',
  'freq.headway':
    "headway_secs '{value}' must be a positive whole number of seconds",
  'freq.exactTimes': "exact_times '{value}' must be 0, 1 or empty",
  'freq.overlap': 'headway period {period} overlaps {other} on the same trip',
  'renameRule.empty': 'ID cannot be empty',
  'renameRule.whitespace': 'ID cannot start or end with whitespace',
  'renameRule.taken': '{table} already has a row with ID "{id}"',
  'renameRule.unchanged': 'ID is unchanged',
  'value.mustBeNumber': 'Must be a number',
  'value.required': 'This field is required',
  'value.invalid': 'Invalid value',
  'value.month': 'Month must be between 01 and 12',
  'value.day': 'Day must be between 01 and 31',
  'value.year': 'Year must be between 1900 and 2200',
  'value.timeNumbers': 'Time must contain valid numbers',
  'value.minutes': 'Minutes must be between 00 and 59',
  'value.seconds': 'Seconds must be between 00 and 59',
  'value.hoursNegative': 'Hours cannot be negative',
  'value.validNumber': 'Must be a valid number',
  'value.validInteger': 'Must be a valid integer',
  'value.integerNoDecimals': 'Must be an integer (no decimal places)',
  'value.languageCode': 'Must be a valid IETF BCP 47 language code',
  'value.currencyCode': 'Must be a 3-letter ISO 4217 currency code',
  'value.decimalAmount': 'Must be a valid decimal amount',
  'value.hexColor': 'Must be a 6-digit hexadecimal color',
  'value.dateFormat': 'Must be in YYYYMMDD format',
  'value.timeFormat': 'Must be in HH:MM:SS format',
  'value.notZero': 'Must not be 0',
  'value.unknownType': 'Unknown field type: {type}',
  'value.invalidFormat': 'Invalid format for {type}. {description}',
  'value.min': 'Value must be >= {min}',
  'value.max': 'Value must be <= {max}',
  'shapeGeo.noGeometry': 'That feature has no geometry.',
  'shapeGeo.multiLine':
    'A shape is one line, but this MultiLineString has {count} parts. Join them into a single LineString first.',
  'shapeGeo.notLine':
    'A shape is a line, but this feature is a {type}. Draw a LineString instead.',
  'shapeGeo.tooFew':
    'A shape needs at least two points, this line has {count}.',
  'shapeGeo.badPoint': 'Point {n} has a non-numeric coordinate.',
  'geoIo.decompress': 'Could not decompress the geojson.io payload: {message}',
  'geoIo.encoding':
    'Unsupported geojson.io payload encoding: expected a "{gz}" or "{json}" prefix.',
  'geoIo.nothingPasted': 'Nothing pasted.',
  'geoIo.notUrl': 'That does not parse as a URL.',
  'geoIo.noData':
    'This geojson.io URL carries no `data` parameter. Draw something first, or paste the GeoJSON itself.',
  'geoIo.notCollection': 'Expected a GeoJSON FeatureCollection, got {type}.',
  'gpx.noPoints': 'No track points found in GPX file',
  'gpx.noValidPoints': 'No valid track points found in GPX file',
  'coords.invalid': 'Invalid coordinates: lat={lat}, lng={lng}',
  'coords.lat': 'Invalid latitude: {lat}. Must be between -90 and 90',
  'coords.lng': 'Invalid longitude: {lng}. Must be between -180 and 180',
} as const;
