/** Feed issues, in English. */
export const issues = {
  'issues.rows': '{file} rows {text}',
  'issues.missingRequiredField': 'missing a required field',
  'issues.missingRequiredFile': 'missing a required file',
  'issues.routesBadAgency': 'routes with an agency_id not in agency.txt',
  'issues.badRefField': '{file} rows with a {field} that does not exist',
  'issues.badRef': '{file} rows referencing a record that does not exist',
  'issues.routesBadAgencyNote':
    "These routes won't appear under any agency until agency_id is fixed.",
  'issues.empty': 'empty',
  'issues.duplicateId': 'duplicate id',
  'issues.invalidCoordinate': 'invalid coordinate',
  'issues.invalidDate': 'invalid date',
  'issues.invalidTime': 'invalid time',
  'issues.invalidNumber': 'invalid number',
  'issues.invalidUrl': 'invalid URL',
  'issues.invalidCode': '{file} rows whose {field} is not a valid code',
  'issues.value': 'value',
  'issues.invalidGeometry': '{file} zones with an invalid geometry',
  'issues.conditional': 'missing a conditionally required field',
  'issues.unknownRouteType': 'unknown route_type',
  'issues.unknownLocationType': 'unknown location_type',
  'issues.invalidExceptionType': 'invalid exception_type',
  'issues.invalidArea': 'invalid area assignment',
  'issues.noStopTimes': 'without any stop_times',
  'issues.deleteTrips': 'Delete trips',
  'issues.deleteTripsConfirm':
    'Delete {trips} with no stop_times, and any frequencies rows of those trips? This is one undo step.',
  'issues.orphaned': 'with no coordinates of their own or from a parent',
  'issues.orphanedNote':
    'These are not drawn on the map. Give each one coordinates, or a parent_station that has them.',
  'issues.unpairedFlex': 'with an unpaired pickup/drop-off window',
  'issues.unpairedFlexNote':
    'Other trips on the route pair this window with a second row for the other direction of travel.',
  'issues.riderDefault':
    'fare products without exactly one default rider category',
  'issues.networkConflict': 'conflicting network_id',
  'issues.missingCalendar': 'missing calendar file',
  'issues.inheritedCoords': 'inheriting coordinates from a parent',
  'issues.hiddenWhitespaceField':
    '{file} rows whose {field} carries hidden whitespace',
  'issues.hiddenWhitespace': 'with hidden whitespace in a value',
  'issues.hiddenWhitespaceNote':
    'A quoted CSV field that swallowed the line ending. The extra characters are invisible but count, so an id carrying them matches nothing.',
  'issues.fix': 'Fix',
  'issues.fixConfirm':
    'Clean the hidden whitespace in {values}? This is one undo step.',
  'issues.values_one': '{count} value',
  'issues.values_other': '{count} values',
  'issues.duplicateKey': 'sharing a primary key with another row',
  'issues.frequencyOverlap': 'with overlapping headway periods',
  'issues.frequencyEnd': 'whose end_time lands on a departure',
  'issues.recordTitle': 'Issues with this record',
  'issues.danglingRef': "{field} refers to '{value}', which does not exist",
  'issues.danglingNote':
    'Pick an existing value below, or create the record it refers to.',
  'issues.gone': 'This issue is already gone',
  'issues.unknownAction': 'Unknown issue action {id}',
  'issues.confirmTitle': '{label}?',
  'issues.title': 'Feed issues',
} as const;
