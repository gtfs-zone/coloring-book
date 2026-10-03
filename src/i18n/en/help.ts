/** Guide pages, in English. */
export const help = {
  'help.welcome.label': 'Welcome',
  'help.welcome.title': 'Load, edit, and export a GTFS feed',
  'help.intro':
    'edit.gtfs.zone is a browser-based GTFS transit data editor. All data stays in your browser. No server, no account required.',
  'help.welcome.load': 'Load a feed',
  'help.welcome.loadText': 'From a URL or a local file.',
  'help.welcome.edit': 'Edit any table',
  'help.welcome.editText':
    'Agencies, routes, stops, trips, and every other file.',
  'help.welcome.place': 'Place stops on the map',
  'help.welcome.placeText': 'Add and position stops directly on the map.',
  'help.welcome.check': 'Check the feed',
  'help.welcome.checkText': 'Validate against the GTFS spec as you go.',
  'help.welcome.export': 'Export a zip',
  'help.welcome.exportText': 'Download a ready-to-publish GTFS feed.',
  'help.welcome.hover':
    'Hover any property to see its GTFS description; click the property name to open the official GTFS reference.',
  'help.new.label': 'Writing a New Feed',
  'help.new.title': 'Building a feed from scratch',
  'help.new.lede':
    'Each object below references the one above it, so building in this order keeps everything connected.',
  'help.new.feedInfo': 'Fill in the feed information',
  'help.new.agency': 'Add an agency',
  'help.new.services': 'Add a few services',
  'help.new.servicesText': 'The days the service runs.',
  'help.new.routes': 'Add routes under the agency',
  'help.new.trip': 'Connect a route to a service',
  'help.new.tripText': 'Do this by creating a trip.',
  'help.new.stopTimes': 'Add stops and times',
  'help.new.stopTimesText': 'Fill in that trip’s stop times.',
  'help.specReference': 'Spec reference: {links}.',
  'help.spec.feedInfo': 'Feed Info',
  'help.spec.agencies': 'Agencies',
  'help.spec.calendar': 'Calendar',
  'help.spec.routes': 'Routes',
  'help.spec.trips': 'Trips',
  'help.spec.stopTimes': 'Stop Times',
  'help.spec.shapes': 'Shapes',
  'help.spec.fareProducts': 'Fare Products',
  'help.spec.fareMedia': 'Fare Media',
  'help.spec.fareLegRules': 'Fare Leg Rules',
  'help.spec.locations': 'Locations',
  'help.spec.bookingRules': 'Booking Rules',
  'help.spec.locationGroups': 'Location Groups',
  'help.revisit': 'You can revisit this at any time from the Guide menu.',
  'help.shapes.label': 'Shapes',
  'help.shapes.title': 'Creating route shapes',
  'help.shapes.lede':
    'A shape is the path a vehicle follows on the map. It is separate from the sequence of stops a trip makes.',
  'help.shapes.stops': 'Place your stops first',
  'help.shapes.stopsText': 'Get your route’s stops in the right spots.',
  'help.shapes.brouter': 'Plan the path on brouter',
  'help.shapes.brouterText':
    'Open a trip in that route’s timetable and click "open in brouter".',
  'help.shapes.gpx': 'Export as GPX',
  'help.shapes.gpxText': 'Export the planned path from brouter as a GPX file.',
  'help.shapes.import': 'Import the shape',
  'help.shapes.importText':
    'Import that GPX file here in the Shapes manager. The same button also takes a GTFS feed, to copy one shape out of an existing feed.',
  'help.shapes.link': 'Link the shape',
  'help.shapes.linkText': 'Link the imported shape to your trips.',
  'help.fares.label': 'Fares',
  'help.fares.title': 'How to specify fares in your GTFS feed',
  'help.fares.lede':
    'This editor uses GTFS-Fares V2. A few entities work together to describe what a rider pays.',
  'help.fares.products': 'Define fare products',
  'help.fares.productsText':
    'The things a rider can buy, like a single ride or a day pass.',
  'help.fares.media': 'Define fare media and rider categories',
  'help.fares.mediaText':
    'How a product is carried (e.g. a card, cash, an app) and who qualifies for it (e.g. adult, senior, student).',
  'help.fares.legs': 'Add fare leg rules',
  'help.fares.legsText':
    'Apply your fare products to specific legs of a journey.',
  'help.onDemand.label': 'On-Demand',
  'help.onDemand.title': 'Describing on-demand service (GTFS Flex)',
  'help.onDemand.lede':
    'On-demand service is service a rider books rather than catches at a fixed time. GTFS Flex describes it with a few pieces that plug into an ordinary trip.',
  'help.onDemand.zone': 'A zone is an area, not a stop',
  'help.onDemand.zoneText':
    'A polygon drawn on the map that a rider can be picked up in or dropped off anywhere inside. Zones live in locations.geojson, not in stops.txt.',
  'help.onDemand.group': 'A location group is a set of stops',
  'help.onDemand.groupText':
    'When the service serves a handful of named stops rather than a whole area, group those stops instead of drawing a zone.',
  'help.onDemand.booking': 'A booking rule says how to book',
  'help.onDemand.bookingText':
    'How far in advance a rider has to call or tap, and where. Real time, same day, or by a cutoff on a prior day.',
  'help.onDemand.stopTime': 'A stop_time ties them to a trip',
  'help.onDemand.stopTimeText':
    'Give a stop_time a pickup and drop-off window instead of an arrival and departure, point it at a zone or location group, and name the booking rule it uses.',
  'help.about.subject': 'edit.gtfs.zone feedback',
  'help.about.sibling': 'watch a GTFS Realtime feed on a live map',
  'help.mapKey.label': 'Map Key',
  'help.mapKey.title': 'Reading the map symbols',
  'help.mapKey.unlocated': 'Node with no location',
  'help.mapKey.pathways': 'Pathways',
  'help.publish.label': 'Publishing your Feed',
  'help.publish.title': 'Publishing your feed',
  'help.publish.lede':
    'A GTFS feed is only useful once riders and their apps can reach it. A few steps turn the file you just exported into a published feed.',
  'help.publish.validator': 'Validate with the {link}',
  'help.publish.validatorLink': 'canonical GTFS validator',
  'help.publish.validatorText': 'Catch anything this editor does not check.',
  'help.publish.license': "Keep the source feed's license",
  'help.publish.licenseText':
    "If you started from someone else's feed, their license still covers what you publish. Credit them in attributions.txt.",
  'help.publish.host': 'Host the zip at a stable URL',
  'help.publish.hostText':
    'Somewhere that does not move, so apps can keep fetching the latest version.',
  'help.publish.register': 'Register so apps can find your feed',
  'help.publish.registerText':
    'Add it to the {mdb} and {atlas}, and submit it to {google}.',
  'help.publish.realtime': 'Track your vehicles with {link}',
  'help.publish.realtimeText':
    'Once the schedule is published, live vehicle positions, trip updates and service alerts are the next step.',
  'help.publish.footnote':
    'You can revisit this at any time from the Guide menu. {link} covers the whole process.',
  'help.publish.footnoteLink': 'Publishing on gtfs.org',
} as const;
