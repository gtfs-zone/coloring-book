import type { GTFSFileSpec } from '../types';

export const stopsSpec: GTFSFileSpec = {
  filename: 'stops.txt',
  presence: 'Conditionally Required',
  presenceCondition: 'Required if locations.geojson is not provided.',
  description:
    'Stops where vehicles pick up or drop off riders. Also defines stations and station entrances. <br><br>Conditionally Required:<br> - Optional if demand-responsive zones are defined in [locations.geojson](#locationsgeojson). <br>- **Required** otherwise.',
  fields: [
    {
      name: 'stop_id',
      type: 'Unique ID',
      presence: 'Required',
      description:
        'Identifies a location: stop/platform, station, entrance/exit, generic node or boarding area (see `location_type`). <br><br>ID must be unique across all `stops.stop_id`, locations.geojson `id`, and `location_groups.location_group_id` values. <br><br>Multiple routes may use the same `stop_id`.',
      isPrimaryKey: true,
    },
    {
      name: 'stop_code',
      type: 'Text',
      presence: 'Optional',
      description:
        'Short text or a number that identifies the location for riders. These codes are often used in phone-based transit information systems or printed on signage to make it easier for riders to get information for a particular location. The `stop_code` may be the same as `stop_id` if it is public facing. This field should be left empty for locations without a code presented to riders.',
    },
    {
      name: 'stop_name',
      type: 'Text',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required for locations that are stops (location_type=0), stations (location_type=1), or entrances/exits (location_type=2), otherwise optional.',
      description:
        "Name of the location. The `stop_name` should match the agency's rider-facing name for the location as printed on a timetable, published online, or represented on signage. For translations into other languages, use [translations.txt](#translationstxt).<br><br>When the location is a boarding area (`location_type=4`), the `stop_name` should contains the name of the boarding area as displayed by the agency. It could be just one letter (like on some European intercity railway stations), or text like “Wheelchair boarding area” (NYC’s Subway) or “Head of short trains” (Paris’ RER).<br><br>Conditionally Required:<br>- **Required** for locations which are stops (`location_type=0`), stations (`location_type=1`) or entrances/exits (`location_type=2`).<br>- Optional for locations which are generic nodes (`location_type=3`) or boarding areas (`location_type=4`).",
    },
    {
      name: 'tts_stop_name',
      type: 'Text',
      presence: 'Optional',
      description:
        'Readable version of the `stop_name`. See "Text-to-speech field" in the [Term Definitions](#term-definitions) for more.',
    },
    {
      name: 'stop_desc',
      type: 'Text',
      presence: 'Optional',
      description:
        'Description of the location that provides useful, quality information. Should not be a duplicate of `stop_name`.',
    },
    {
      name: 'stop_lat',
      type: 'Latitude',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required for locations that are stops (location_type=0), stations (location_type=1), or entrances/exits (location_type=2), otherwise optional.',
      description:
        'Latitude of the location.<br><br>For stops/platforms (`location_type=0`) and boarding area (`location_type=4`), the coordinates must be the ones of the bus pole — if exists — and otherwise of where the travelers are boarding the vehicle (on the sidewalk or the platform, and not on the roadway or the track where the vehicle stops). <br><br>Conditionally Required:<br>- **Required** for locations which are stops (`location_type=0`), stations (`location_type=1`) or entrances/exits (`location_type=2`).<br>- Optional for locations which are generic nodes (`location_type=3`) or boarding areas (`location_type=4`).',
    },
    {
      name: 'stop_lon',
      type: 'Longitude',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required for locations that are stops (location_type=0), stations (location_type=1), or entrances/exits (location_type=2), otherwise optional.',
      description:
        'Longitude of the location.<br><br>For stops/platforms (`location_type=0`) and boarding area (`location_type=4`), the coordinates must be the ones of the bus pole — if exists — and otherwise of where the travelers are boarding the vehicle (on the sidewalk or the platform, and not on the roadway or the track where the vehicle stops). <br><br>Conditionally Required:<br>- **Required** for locations which are stops (`location_type=0`), stations (`location_type=1`) or entrances/exits (`location_type=2`).<br>- Optional for locations which are generic nodes (`location_type=3`) or boarding areas (`location_type=4`).',
    },
    {
      name: 'zone_id',
      type: 'ID',
      presence: 'Optional',
      presenceCondition:
        'Required if providing fare information using fare_rules.txt, otherwise optional. If this record represents a station or station entrance, the zone_id is ignored.',
      description:
        'Identifies the fare zone for a stop. If this record represents a station or station entrance, the `zone_id` is ignored.',
    },
    {
      name: 'stop_url',
      type: 'URL',
      presence: 'Optional',
      description:
        'URL of a web page about the location. This should be different from the `agency.agency_url` and the `routes.route_url` field values.',
    },
    {
      name: 'location_type',
      type: 'Enum',
      presence: 'Optional',
      description:
        'Location type. Valid options are:<br><br>`0` (or empty) - **Stop** (or **Platform**). A location where passengers board or disembark from a transit vehicle. Is called a platform when defined within a `parent_station`.<br>`1` - **Station**. A physical structure or area that contains one or more platform.<br>`2` - **Entrance/Exit**. A location where passengers can enter or exit a station from the street. If an entrance/exit belongs to multiple stations, it may be linked by pathways to both, but the data provider must pick one of them as parent.<br>`3` - **Generic Node**. A location within a station, not matching any other `location_type`, that may be used to link together pathways define in [pathways.txt](#pathwaystxt).<br>`4` - **Boarding Area**. A specific location on a platform, where passengers can board and/or alight vehicles.',
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
      type: 'Foreign ID referencing `stops.stop_id`',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required for locations that are entrances/exits (location_type=2), generic nodes (location_type=3), or boarding areas (location_type=4). Optional for stops/platforms (location_type=0 or empty). Forbidden for stations (location_type=1).',
      description:
        'Defines hierarchy between the different locations defined in [stops.txt](#stopstxt). It contains the ID of the parent location, as followed:<br><br>- **Stop/platform** (`location_type=0`): the `parent_station` field contains the ID of a station.<br>- **Station** (`location_type=1`): this field must be empty.<br>- **Entrance/exit** (`location_type=2`) or **generic node** (`location_type=3`): the `parent_station` field contains the ID of a station (`location_type=1`)<br>- **Boarding Area** (`location_type=4`): the `parent_station` field contains ID of a platform.<br><br>Conditionally Required:<br>- **Required** for locations which are entrances (`location_type=2`), generic nodes (`location_type=3`) or boarding areas (`location_type=4`).<br>- Optional for stops/platforms (`location_type=0`).<br>- Forbidden for stations (`location_type=1`).',
      foreignKey: [{ file: 'stops.txt', field: 'stop_id' }],
    },
    {
      name: 'stop_timezone',
      type: 'Timezone',
      presence: 'Optional',
      presenceCondition:
        "If empty for parentless stops and stations, the timezone is assumed to be the same as agency_timezone. Child stops inherit the parent station's timezone and ignore their own stop_timezone.",
      description:
        'Timezone of the location. If the location has a parent station, it inherits the parent station’s timezone instead of applying its own. Stations and parentless stops with empty `stop_timezone` inherit the timezone specified by `agency.agency_timezone`. The times provided in [stop_times.txt](#stop_timestxt) are in the timezone specified by `agency.agency_timezone`, not `stop_timezone`. This ensures that the time values in a trip always increase over the course of a trip, regardless of which timezones the trip crosses.',
    },
    {
      name: 'wheelchair_boarding',
      type: 'Enum',
      presence: 'Optional',
      description:
        'Indicates whether wheelchair boardings are possible from the location. Valid options are: <br><br>For parentless stops:<br>`0` or empty - No accessibility information for the stop.<br>`1` - Some vehicles at this stop can be boarded by a rider in a wheelchair.<br>`2` - Wheelchair boarding is not possible at this stop. <br><br>For child stops: <br>`0` or empty - Stop will inherit its `wheelchair_boarding` behavior from the parent station, if specified in the parent.<br>`1` - There exists some accessible path from outside the station to the specific stop/platform.<br>`2` - There exists no accessible path from outside the station to the specific stop/platform.<br><br> For station entrances/exits: <br>`0` or empty - Station entrance will inherit its `wheelchair_boarding` behavior from the parent station, if specified for the parent.<br>`1` - Station entrance is wheelchair accessible.<br>`2` - No accessible path from station entrance to stops/platforms.',
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
      type: 'Foreign ID referencing `levels.level_id`',
      presence: 'Optional',
      description:
        'Level of the location. The same level may be used by multiple unlinked stations.',
      foreignKey: [{ file: 'levels.txt', field: 'level_id' }],
    },
    {
      name: 'platform_code',
      type: 'Text',
      presence: 'Optional',
      description:
        'Platform identifier for a platform stop (a stop belonging to a station). This should be just the platform identifier (eg. "G" or "3"). Words like “platform” or "track" (or the feed’s language-specific equivalent) should not be included. This allows feed consumers to more easily internationalize and localize the platform identifier into other languages.',
    },
    {
      name: 'stop_access',
      type: 'Enum',
      presence: 'Conditionally Forbidden',
      presenceCondition:
        'Forbidden for locations that are stations (location_type=1), entrances/exits (location_type=2), generic nodes (location_type=3), or boarding areas (location_type=4). Forbidden if parent_station is empty.',
      description:
        'Indicates how the stop is accessed for a particular station. Valid options are: <br><br>`0` - The stop/platform cannot be directly accessed from the street network. It must be accessed from a station entrance if there is one defined for the station, otherwise the station itself. If there are pathways defined for the station, they must be used to access the stop/platform.<br>`1` - Consuming applications should generate directions for access directly to the stop, independent of any entrances or pathways of the parent station.<br><br>When `stop_access` is empty, the access for the specified stop or platform is considered undefined.<br><br>**Conditionally Forbidden**:<br>- **Forbidden** for locations which are stations (`location_type=1`), entrances (`location_type=2`), generic nodes (`location_type=3`) or boarding areas (`location_type=4`).<br>- **Forbidden** if `parent_station` is empty.<br> - Optional otherwise.',
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
