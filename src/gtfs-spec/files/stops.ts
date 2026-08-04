import type { GTFSFileSpec } from '../types';

export const stopsSpec: GTFSFileSpec = {
  filename: 'stops.txt',
  presence: 'Conditionally Required',
  presenceCondition: 'Required if locations.geojson is not provided.',
  description:
    'Stops where vehicles pick up or drop off riders. Also defines stations and station entrances.',
  fields: [
    {
      name: 'stop_id',
      type: 'Unique ID',
      presence: 'Required',
      description:
        'Identifies a location: stop/platform, station, entrance/exit, generic node or boarding area (hereinafter referred to as "location"). Multiple routes may use the same stop_id.',
      isPrimaryKey: true,
    },
    {
      name: 'stop_code',
      type: 'Text',
      presence: 'Optional',
      description:
        "Short text or a number that identifies the location for riders. These codes are often used in phone-based transit information systems or printed on signage to make it easier for riders to get a particular location's information. The stop_code can be the same as stop_id if it is public facing. This field should be left empty for locations without a public code.",
    },
    {
      name: 'stop_name',
      type: 'Text',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required for locations that are stops (location_type=0), stations (location_type=1), or entrances/exits (location_type=2), otherwise optional.',
      description:
        'Name of the location. Use a name that people will understand in the local and tourist vernacular. When the location is a boarding area (location_type=4), the stop_name should contain the name of the boarding area as it is displayed by the agency. It could be just one letter (like on some European intercity railway stations), or text like "Wheelchair boarding area" (NYC\'s Subway) or "Head of short trains" (Paris\' RER).',
    },
    {
      name: 'tts_stop_name',
      type: 'Text',
      presence: 'Optional',
      description:
        'Readable version of the stop_name. See "Text-to-speech field" in the Term Definitions for more.',
    },
    {
      name: 'stop_desc',
      type: 'Text',
      presence: 'Optional',
      description:
        'Description of the location that provides useful, quality information. Should not be a duplicate of stop_name.',
    },
    {
      name: 'stop_lat',
      type: 'Latitude',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required for locations that are stops (location_type=0), stations (location_type=1), or entrances/exits (location_type=2), otherwise optional.',
      description:
        'Latitude of the location. For stops/platforms (location_type=0) and boarding areas (location_type=4), the coordinates must be those of the bus pole (if it exists) and otherwise of where travelers board the vehicle (on the sidewalk or the platform, and not on the roadway or the track where the vehicle stops).',
    },
    {
      name: 'stop_lon',
      type: 'Longitude',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required for locations that are stops (location_type=0), stations (location_type=1), or entrances/exits (location_type=2), otherwise optional.',
      description:
        'Longitude of the location. For stops/platforms (location_type=0) and boarding areas (location_type=4), the coordinates must be those of the bus pole (if it exists) and otherwise of where travelers board the vehicle (on the sidewalk or the platform, and not on the roadway or the track where the vehicle stops).',
    },
    {
      name: 'zone_id',
      type: 'ID',
      presence: 'Optional',
      presenceCondition:
        'Required if providing fare information using fare_rules.txt, otherwise optional. If this record represents a station or station entrance, the zone_id is ignored.',
      description:
        'Identifies the fare zone for a stop. If this record represents a station or station entrance, the zone_id is ignored.',
    },
    {
      name: 'stop_url',
      type: 'URL',
      presence: 'Optional',
      description:
        'URL of a web page about the location. This should be different from the agency_url and the route_url fields.',
    },
    {
      name: 'location_type',
      type: 'Enum',
      presence: 'Optional',
      description:
        'Location type. Valid options are:\n\n0 (or empty) - Stop (or Platform). A location where passengers board or disembark from a transit vehicle. Is called a platform when defined within a parent_station.\n1 - Station. A physical structure or area that contains one or more platform.\n2 - Entrance/Exit. A location where passengers can enter or exit a station from the street.\n3 - Generic Node. A location within a station, not matching any other location_type, that may be used to link together pathways defined in pathways.txt.\n4 - Boarding Area. A specific location on a platform, where passengers can board and/or alight vehicles.',
      enumValues: [
        {
          value: 0,
          label: 'Stop (or Platform)',
          description:
            'A location where passengers board or disembark from a transit vehicle. Is called a platform when defined within a parent_station. An empty value is equivalent to 0.',
        },
        {
          value: 1,
          label: 'Station',
          description:
            'A physical structure or area that contains one or more platform.',
        },
        {
          value: 2,
          label: 'Entrance/Exit',
          description:
            'A location where passengers can enter or exit a station from the street. If an entrance/exit belongs to multiple stations, it may be linked by pathways to both, but the data provider must pick one of them as parent.',
        },
        {
          value: 3,
          label: 'Generic Node',
          description:
            'A location within a station, not matching any other location_type, that may be used to link together pathways defined in pathways.txt.',
        },
        {
          value: 4,
          label: 'Boarding Area',
          description:
            'A specific location on a platform, where passengers can board and/or alight vehicles.',
        },
      ],
    },
    {
      name: 'parent_station',
      type: 'Foreign ID',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required for locations that are entrances/exits (location_type=2), generic nodes (location_type=3), or boarding areas (location_type=4). Optional for stops/platforms (location_type=0 or empty). Forbidden for stations (location_type=1).',
      description:
        'Defines hierarchy between the different locations defined in stops.txt. It contains the ID of the parent location, as follows: Stop/platform (location_type=0): the parent_station field contains the ID of a station. Entrance/exit (location_type=2): the parent_station field contains the ID of a station. Generic node (location_type=3): the parent_station field contains the ID of a station. Boarding area (location_type=4): the parent_station field contains the ID of a platform.',
      foreignKey: { file: 'stops.txt', field: 'stop_id' },
    },
    {
      name: 'stop_timezone',
      type: 'Timezone',
      presence: 'Optional',
      presenceCondition:
        "If empty for parentless stops and stations, the timezone is assumed to be the same as agency_timezone. Child stops inherit the parent station's timezone and ignore their own stop_timezone.",
      description:
        "Timezone of the location. If the location has a parent station, it inherits the parent station's timezone instead of applying the agency_timezone. Stations and parentless stops with empty stop_timezone inherit the timezone specified by agency_timezone. If stop_timezone values are provided, times in stop_times.txt should be entered as the time since midnight in the timezone specified by agency_timezone (and not stop_timezone) to simplify calculations over a trip that changes time zones.",
    },
    {
      name: 'wheelchair_boarding',
      type: 'Enum',
      presence: 'Optional',
      description:
        'Indicates whether wheelchair boardings are possible from the location. Valid options are:\n\nFor parentless stops:\n0 (or empty) - No accessibility information for the stop.\n1 - Some vehicles at this stop can be boarded by a rider in a wheelchair.\n2 - Wheelchair boarding is not possible at this stop.\n\nFor child stops:\n0 (or empty) - Stop will inherit its wheelchair_boarding behavior from the parent station, if specified in the parent.\n1 - There exists some accessible path from outside the station to the specific stop/platform.\n2 - There exists no accessible path from outside the station to the specific stop/platform.\n\nFor station entrances/exits:\n0 (or empty) - Station entrance will inherit its wheelchair_boarding behavior from the parent station, if specified for the parent.\n1 - Station entrance is wheelchair accessible.\n2 - No accessible path from station entrance to stops/platforms.',
      enumValues: [
        {
          value: 0,
          label: 'No information / Inherit',
          description:
            'For parentless stops: no accessibility information for the stop. For child stops: inherits wheelchair_boarding behavior from the parent station. For station entrances/exits: inherits from the parent station. An empty value is equivalent to 0.',
        },
        {
          value: 1,
          label: 'Accessible',
          description:
            'For parentless stops: some vehicles at this stop can be boarded by a rider in a wheelchair. For child stops: there exists some accessible path from outside the station to the specific stop/platform. For station entrances/exits: the entrance is wheelchair accessible.',
        },
        {
          value: 2,
          label: 'Not accessible',
          description:
            'For parentless stops: wheelchair boarding is not possible at this stop. For child stops: there exists no accessible path from outside the station to the specific stop/platform. For station entrances/exits: no accessible path from the entrance to stops/platforms.',
        },
      ],
    },
    {
      name: 'level_id',
      type: 'Foreign ID',
      presence: 'Optional',
      description:
        'Level of the location. The same level may be used by multiple unlinked stations.',
      foreignKey: { file: 'levels.txt', field: 'level_id' },
    },
    {
      name: 'platform_code',
      type: 'Text',
      presence: 'Optional',
      description:
        'Platform identifier for a platform stop (a stop belonging to a station). This should be just the platform identifier (e.g. G or 3). Words like "platform" or "track" (or the feed\'s language-specific equivalent) should not be included. This allows feed consumers to more easily internationalize and localize the platform identifier into other languages.',
    },
    {
      name: 'stop_access',
      type: 'Enum',
      presence: 'Conditionally Forbidden',
      presenceCondition:
        'Forbidden for locations that are stations (location_type=1), entrances/exits (location_type=2), generic nodes (location_type=3), or boarding areas (location_type=4). Forbidden if parent_station is empty.',
      description:
        'Indicates the method used to access the stop from the street network. Valid options are:\n\n0 - The stop is not directly accessible from the street; access is via station entrance or pathways.\n1 - Consuming applications should generate directions directly to the stop, independent of entrances or pathways.',
      enumValues: [
        {
          value: 0,
          label: 'Not street-accessible',
          description:
            'The stop is not directly accessible from the street; access is via station entrance or pathways.',
        },
        {
          value: 1,
          label: 'Street-accessible',
          description:
            'Consuming applications should generate directions directly to the stop, independent of entrances or pathways.',
        },
      ],
    },
  ],
};
