/** Home and entity pages, in English. */
export const pages = {
  'page.readOnly': 'This feed is open read-only, so it cannot be fixed',
  'page.loadFailed': 'Failed to load content. Please try again.',
  'page.cleanFeed': 'Everything look good? Export your feed and publish.',
  'page.publishingGuide': 'Publishing guide',
  'page.noPatchManager': 'No patch manager available',
  'page.trimAllTitle':
    "Set every service's start_date to {date}, and remove every exception before it",
  'page.extendAllTitle':
    "Set every service's end_date to {date}, and remove every exception after it",
  'page.noFeedStart': 'feed_info has no feed_start_date',
  'page.noFeedEnd': 'feed_info has no feed_end_date',
  'page.feedIssues': 'Feed issues',
  'page.agencies': 'Agencies',
  'page.newAgency': '+ New agency',
  'page.noAgencies': 'No agencies found in GTFS data.',
  'page.services': 'Services',
  'page.trimAll': 'Trim all to feed start',
  'page.extendAll': 'Extend all to feed end',
  'page.newService': '+ New service',
  'page.noServices': 'No services found in GTFS data.',
  'page.feedInfo': 'Feed Information',
  'page.attributions': 'Attributions',
  'page.manageAttributions': 'Manage attributions',
  'page.producer': 'Producer',
  'page.operator': 'Operator',
  'page.authority': 'Authority',
  'page.noOrganization': 'No organization name',
  'page.scopeMissing': '{label}: {id} {missing}',
  'page.scopeNoSuch': '(no such {entity})',
  'page.scope': '{label}: {name}',
  'page.wholeDataset': 'Applies to the whole dataset',
  'page.timetable': 'Timetable',
  'page.addTimetable': 'Add timetable for service:',
  'page.noServicesYet': 'No services yet: create one first',
  'page.chooseService': 'Choose a service...',
  'page.newServiceOption': 'New service…',
  'page.timetables': 'Timetables',
  'page.noServicesFound': 'No services found.',
  'page.createOne': 'Create one',
  'page.noTimetables':
    'No timetables yet. Select a service above to create one.',
  'page.network': 'Network',
  'page.notInNetwork': 'Not in a network',
  'page.selectNetwork': 'Select network',
  'page.createNetwork': '+ Create a new network...',
  'page.newNetwork': 'New network',
  'page.networkNote':
    'Naming a network makes the feed export networks.txt and route_networks.txt rather than a network_id column on routes.txt.',
  'page.newAgencyTitle': 'New agency',
  'page.newRouteTitle': 'New route',
  'page.alreadyAtBound': 'Every service is already at that bound',
  'page.trimmed': 'Trimmed {services}',
  'page.extended': 'Extended {services}',
  'page.trimmedRemoved': 'Trimmed {services}, removed {exceptions}',
  'page.extendedRemoved': 'Extended {services}, removed {exceptions}',
  'page.deleteRouteTitle': 'Delete route?',
  'page.deleteRouteEmpty':
    'This route has no trips. Are you sure you want to delete it?',
  'page.routeHasTrips': 'Route has trips',
  'page.routeHasTripsBody': 'This route has {trips} and {stopTimes}.',
  'page.routeCascade':
    'Deleting this route will cascade-delete all its trips and stop_times (reversible via undo). Or cancel to keep it.',
  'page.deleteServiceTitle': 'Delete service?',
  'page.deleteServiceEmpty':
    'This service has no trips or calendar dates. Are you sure you want to delete it?',
  'page.serviceHasDependents': 'Service has dependents',
  'page.serviceHasBody': 'This service has {parts}.',
  'page.serviceCascade':
    'Deleting this service will cascade-delete all its trips, stop_times, and calendar_dates (reversible via undo). Or cancel to keep it.',
  'page.deleteAgencyTitle': 'Delete agency?',
  'page.deleteAgencyEmpty':
    'This agency has no routes. Are you sure you want to delete it?',
  'page.agencyHasRoutes': 'Agency has routes',
  'page.agencyHasBody': 'This agency has {routes}, {trips}, and {stopTimes}.',
  'page.agencyCascade':
    'Deleting this agency will cascade-delete all its routes, trips, and stop_times (reversible via undo). Or cancel to keep it.',
  'page.stopHasVisits': 'Stop has scheduled visits',
  'page.stopReferenced':
    'This stop is referenced by {stopTimes} across {trips}:',
  'page.stopCascade':
    'You can cascade-delete the stop and all its stop_times (reversible via undo), or cancel.',
  'page.zoneHasPickups': 'Zone has scheduled pickups',
  'page.zoneReferenced':
    'This zone is referenced by {stopTimes} across {trips}:',
  'page.zoneCascade':
    'You can cascade-delete the zone and all its stop_times (reversible via undo), or cancel.',
} as const;
