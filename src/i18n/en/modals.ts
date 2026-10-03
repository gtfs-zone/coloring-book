/** Fares, feed data and on-demand modals, in English. */
export const modals = {
  'fares.missingMember': '{id} (missing from {table})',
  'fares.editMembers': 'Edit {label} on {table}',
  'fares.specificDates': 'Specific dates',
  'fares.group.Definitions': 'Definitions',
  'fares.group.Rules': 'Rules',
  'fares.group.Geography': 'Geography',
  'fares.timeframes': 'Timeframes',
  'fares.timeframesHint':
    'Add one row per interval. Rows sharing a timeframe_group_id form one group, which a fare leg rule can then name.',
  'fares.riderCategories': 'Rider Categories',
  'fares.riderCategoriesHint':
    'Add one to price fares differently for, say, seniors or students.',
  'fares.media': 'Fare Media',
  'fares.mediaHint':
    'Add one to describe how a fare is carried: a paper ticket, a transit card, a phone.',
  'fares.products': 'Fare Products',
  'fares.productsHint': 'Add one to give a fare a price.',
  'fares.legRules': 'Fare Leg Rules',
  'fares.legRulesHint':
    'Add one to say which fare product pays for a leg. An empty network or area matches everything the other rules do not name.',
  'fares.legJoinRules': 'Fare Leg Join Rules',
  'fares.legJoinRulesHint':
    'Add one to make two legs across a transfer price as a single leg.',
  'fares.legJoinRulesNote':
    'The stop fields go together: name both, or neither. Only stops and stations may be named.',
  'fares.transferRules': 'Fare Transfer Rules',
  'fares.transferRulesHint':
    'Add one to price the transfer between two leg groups.',
  'fares.transferRulesNote':
    'A fare transfer rule defined from from_leg_group_id to to_leg_group_id does not apply in the reverse direction. The duration fields go together: set both, or neither.',
  'fares.areas': 'Areas',
  'fares.areasHint':
    'An area is the group of stops a fare leg rule starts or ends in.',
  'fares.areasNote':
    'Stops join an area here or on the stop page. A station in an area carries its platforms with it, unless a platform is assigned to an area of its own; only the stops named directly are listed.',
  'fares.stops': 'Stops',
  'fares.andPlatforms': ', and its platforms',
  'fares.networks': 'Networks',
  'fares.networksHint':
    'A network is the group of routes a fare leg rule applies to.',
  'fares.networksNote':
    'Routes join a network here or on the route page. Giving a network a name makes the feed export networks.txt and route_networks.txt; an unnamed network is exported as a network_id column on routes.txt instead.',
  'fares.routes': 'Routes',
  'fares.intro':
    'Fares v2: the products a rider can buy, the rules that price a journey out of them, and the geography those rules refer to. Fares v1 ({files}) is not edited here: open those tables in the file viewer.',
  'fares.reference': 'GTFS reference',
  'fares.title': 'Fares',
  'feedData.attrOneScope':
    'Only one of agency_id, route_id or trip_id may be set (found {found})',
  'feedData.forbiddenFeedInfo':
    '{field} is forbidden when table_name is feed_info',
  'feedData.exclusive':
    'record_id and field_value are mutually exclusive: set one or the other',
  'feedData.eitherRequired': 'Either record_id or field_value is required',
  'feedData.subIdNeedsId': 'record_sub_id requires record_id',
  'feedData.stopTimesSubId':
    'record_sub_id (the stop_sequence) is required when translating stop_times by record_id',
  'feedData.transfers': 'Transfers',
  'feedData.transfersHint':
    'Add one to override how a connection between two stops is treated: to make it timed, to give it a minimum time, or to rule it out.',
  'feedData.transfersNote':
    'Transfer types 4 and 5 link two trips of the same vehicle and name trips instead of stops. A transfer from a station applies to all of its child stops.',
  'feedData.attributions': 'Attributions',
  'feedData.attributionsHint':
    'Add one to credit an organization for the dataset, or for one agency, route or trip in it.',
  'feedData.attributionsNote':
    'Leave agency_id, route_id and trip_id empty to attribute the whole dataset; setting one scopes the attribution to it. At least one of is_producer, is_operator and is_authority should be 1.',
  'feedData.translations': 'Translations',
  'feedData.translationsHint':
    'Add one per translated value. Name what to translate either by record_id, or by field_value to translate every field holding that exact value.',
  'feedData.translationsNote':
    'Translations are stored and exported, but are not yet applied to labels shown in the app. record_id is the first field of the named table’s primary key; it is not checked against that table, since which table it names varies per row.',
  'feedData.intro':
    'Feed-level tables that describe the rest of the feed rather than adding anything to the map: the connections between stops, who the data is attributed to, and the translations of its text.',
  'feedData.title': 'Feed Data',
  'flex.zonesHint':
    'A zone is an area a rider can be picked up in or dropped off in. Zones arrive by importing a feed with locations.geojson, or you can draw one in geojson.io and create it here.',
  'flex.name': 'Name',
  'flex.geometry': 'Geometry',
  'flex.newZone': 'New zone',
  'flex.zoneNamePlaceholder': 'e.g. North service area',
  'flex.geometryHint':
    'Draw the zone in geojson.io, then Share and paste the link here. A Polygon or MultiPolygon Feature, or a FeatureCollection holding one, works too.',
  'flex.idRequired': 'location_id is required.',
  'flex.needsPolygon': 'A zone needs a Polygon or MultiPolygon, got {type}.',
  'flex.emptyPolygon': 'That polygon has no coordinates. Draw the zone first.',
  'flex.bookingRules': 'Booking Rules',
  'flex.bookingRulesHint':
    'Add one to say how far in advance a rider has to book, and how. A stop_time then names it as its pickup or drop-off rule.',
  'flex.bookingRulesNote':
    'Which prior-notice fields apply depends on booking_type: real time (0) takes none, same-day (1) takes a duration in minutes, prior day (2) takes a last day and time.',
  'flex.locationGroups': 'Location Groups',
  'flex.locationGroupsHint':
    'A location group is the set of stops a rider may request pickup or drop off at. Add one, then join its stops in the Stops column.',
  'flex.locationGroupsNote':
    'Stops join a location group here or on the location group page. A location_group_id shares one ID namespace with stops.stop_id and locations.geojson id, so it may not collide with either.',
  'flex.zones': 'Zones',
  'flex.zonesNote':
    'The zone list is read-only here. Open a zone to see its geometry and edit it in geojson.io.',
  'flex.group.Booking': 'Booking',
  'flex.group.Geography': 'Geography',
  'flex.intro':
    'On-demand service (GTFS Flex): the rules a rider books under, the groups of stops they can be served at, and the zones they can be served in. A trip becomes on-demand in its timetable, by giving a stop_time a pickup and drop-off window instead of an arrival and departure.',
  'flex.title': 'On-Demand',
} as const;
