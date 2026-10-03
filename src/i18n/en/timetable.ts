/** Timetables, in English. */
export const timetable = {
  'tt.route': 'Route',
  'tt.service': 'Service',
  'tt.direction': 'Direction',
  'tt.addDirection': 'Add direction',
  'tt.bothDirections':
    'Both directions already exist: GTFS only defines direction_id 0 and 1',
  'tt.brouterTitle': 'Open in BRouter',
  'tt.brouterText':
    "Routes this trip's {count} stops in BRouter in a new tab, to draw or check a shape against the road or rail network. Nothing in the feed changes.",
  'tt.brouterDisabled':
    'Open in BRouter needs at least two stops with coordinates on this trip',
  'tt.uploadTitle': 'Upload shape for this trip',
  'tt.uploadText':
    "Reads a GPX file, or one shape out of a GTFS feed, into new shapes.txt rows and points this trip's shape_id at them. Undoable from the Changes panel.",
  'tt.shapeActions': 'Shape actions',
  'tt.addHeadwayTitle': 'Add a headway period to {trip}',
  'tt.addHeadwayText':
    "Appends a <code>frequencies.txt</code> row: a service window and the seconds between departures in it. The trip's stop_times become a template of offsets from its first departure.",
  'tt.addFrequency': '+ frequency',
  'tt.addPeriod': '+ period',
  'tt.frequencyN': 'frequency {n}',
  'tt.deleteHeadwayTitle': 'Delete this headway period',
  'tt.deleteHeadwayText':
    "Removes the <code>frequencies.txt</code> row for {trip} at {start}: {period}. The trip's stop_times stay as they are.",
  'tt.minutes': '{field} - {n} minutes',
  'tt.seconds': '{field} - {n} seconds',
  'tt.emptyEquivalent': '{field} - empty, equivalent to 0',
  'tt.frequencyTripTitle': 'Frequency-based trip',
  'tt.frequencyTripText':
    'The stop_times below are a template: only their offsets from the first departure carry meaning, and a vehicle leaves every headway through each period.',
  'tt.deleteTripTitle': 'Delete trip {trip}',
  'tt.deleteTripText':
    'Removes the trip and its stop_times. Undoable from the Changes panel.',
  'tt.outOfOrder': "This trip's stop_times are not in chronological order.",
  'tt.sortTripTitle': 'Sort trip {trip} by time',
  'tt.sortTripText':
    "Renumbers this trip's stop_times into chronological order. Stops can change column on the strip. Undoable from the Changes panel.",
  'tt.copyTripTitle': 'Copy trip {trip}',
  'tt.copyTripText':
    'Asks for a time offset and whether to reverse the stop order, then creates the copy with a generated trip ID. Copies the stop_times and frequencies too.',
  'tt.reverseTripTitle': 'Reverse trip {trip}',
  'tt.reverseTripText':
    'Reverses and renumbers the stop_times, mirroring the times so the trip still runs forward. Clears the shape. Leaves direction_id alone, so you likely want to update it on the trip afterwards. Undoable from the Changes panel.',
  'tt.shiftTripTitle': 'Shift trip {trip}',
  'tt.shiftTripText':
    'Adds a signed offset to every time of this trip. Stop order is unchanged. Undoable from the Changes panel.',
  'tt.newTrip': 'New trip',
  'tt.stop': 'Stop',
  'tt.tripActions': 'Trip actions',
  'tt.stopOrder': 'Stop order',
  'tt.focusStop': 'Focus this stop on the map',
  'tt.visit': '(visit {n})',
  'tt.servedBy': 'Served by {serves} of {total} trips',
  'tt.stopShowingTitle': 'Stop showing {field}',
  'tt.stopShowingText':
    'Removes the sub-row from every cell. Values already in the feed are untouched, and the field returns on its own merit once any cell has one.',
  'tt.changeStop': 'Change stop',
  'tt.group': 'Group',
  'tt.zone': 'Zone',
  'tt.openGroup': 'Open this location group',
  'tt.openZone': 'Open this zone',
  'tt.pendingFlex': 'Pending on-demand row',
  'tt.pendingStop': 'Pending stop',
  'tt.addTripFirst': 'Add a trip first: stop times belong to a trip',
  'tt.addStopOrZone': 'Add stop or zone...',
  'tt.noTripsInDirection':
    'This direction of the route has no trips yet. Stop times belong to a trip, so add one before adding stops.',
  'tt.addFirstTrip': 'Add first trip',
  'tt.directionNoTrips': '{name}: No trips',
  'tt.error': 'Error',
  'tt.noTrips': 'This feed has no trips yet, so there is no timetable.',
  'tt.title': 'Timetable',
  'tt.browserTitle': 'Timetables',
  'tt.noAgency': 'No agency',
  'tt.noRoutes': 'No routes.',
  'tt.newTimetable': 'New timetable',
  'tt.openTimetable': 'Open timetable',
  'tt.feedNoRoutes': 'This feed has no routes yet.',
  'tt.fromFirstDeparture': '{offset} from first departure',
  'tt.addFieldTitle': 'Show another {file} field',
  'tt.addFieldText':
    'Picks a field to add as a sub-row of every cell in this table. It is not written to the feed until a value is typed, and it is dropped on leaving the timetable.',
  'tt.noRecord': 'No record with {field} {value} exists',
  'tt.noStopTimeYet': 'no stop_time on this trip yet',
  'tt.outbound': 'Outbound',
  'tt.inbound': 'Inbound',
  'tt.directionN': 'Direction {id}',
  'tt.routeNotFound': 'Route {id} not found',
  'tt.stopMissing':
    'Stop {id} not found in stops.txt but referenced in stop_times.txt',
  'tt.invalidTime': 'Invalid time format: {time}. Must be HH:MM:SS format.',
  'tt.dbLost': 'Database connection lost',
  'tt.arrivalAfterDeparture':
    'Arrival time must be before or equal to departure time',
} as const;
