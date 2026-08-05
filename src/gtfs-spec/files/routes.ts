import type { GTFSFileSpec } from '../types';

export const routesSpec: GTFSFileSpec = {
  filename: 'routes.txt',
  presence: 'Required',
  description:
    'Transit routes. A route is a group of trips that are displayed to riders as a single service.',
  fields: [
    {
      name: 'route_id',
      type: 'Unique ID',
      presence: 'Required',
      description: 'Identifies a route.',
      isPrimaryKey: true,
    },
    {
      name: 'agency_id',
      type: 'Foreign ID referencing `agency.agency_id`',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if multiple agencies are defined in agency.txt, otherwise optional.',
      description:
        'Agency for the specified route.<br><br>Conditionally Required:<br>- **Required** if multiple agencies are defined in [agency.txt](#agency). <br>- Recommended otherwise.',
      foreignKey: [{ file: 'agency.txt', field: 'agency_id' }],
    },
    {
      name: 'route_short_name',
      type: 'Text',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if routes.txt does not contain route_long_name. Recommended if there is a brief service designation (e.g. "32", "100X", "Green").',
      description:
        'Short name of a route. Often a short, abstract identifier (e.g., "32", "100X", "Green") that riders use to identify a route. Both `route_short_name` and `route_long_name` may be defined.<br><br>Conditionally Required:<br>- **Required** if `routes.route_long_name` is empty.<br>- Recommended if there is a brief service designation. This should be the commonly-known passenger name of the service, and should be no longer than 12 characters.',
    },
    {
      name: 'route_long_name',
      type: 'Text',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if routes.txt does not contain route_short_name.',
      description:
        "Full name of a route. This name is generally more descriptive than the `route_short_name` and often includes the route's destination or stop. Both `route_short_name` and `route_long_name` may be defined.<br><br>Conditionally Required:<br>- **Required** if `routes.route_short_name` is empty.<br>- Optional otherwise.",
    },
    {
      name: 'route_desc',
      type: 'Text',
      presence: 'Optional',
      description:
        'Description of a route that provides useful, quality information. Should not be a duplicate of `route_short_name` or `route_long_name`. <hr> _Example: "A" trains operate between Inwood-207 St, Manhattan and Far Rockaway-Mott Avenue, Queens at all times. Also from about 6AM until about midnight, additional "A" trains operate between Inwood-207 St and Lefferts Boulevard (trains typically alternate between Lefferts Blvd and Far Rockaway)._',
    },
    {
      name: 'route_type',
      type: 'Enum',
      presence: 'Required',
      description:
        'Indicates the type of transportation used on a route. Valid options are: <br><br>`0` - Tram, Streetcar, Light rail. Any light rail or street level system within a metropolitan area.<br>`1` - Subway, Metro. Any underground rail system within a metropolitan area.<br>`2` - Rail. Used for intercity or long-distance travel.<br>`3` - Bus. Used for short- and long-distance bus routes.<br>`4` - Ferry. Used for short- and long-distance boat service.<br>`5` - Cable tram. Used for street-level rail cars where the cable runs beneath the vehicle (e.g., cable car in San Francisco).<br>`6` - Aerial lift, suspended cable car (e.g., gondola lift, aerial tramway). Cable transport where cabins, cars, gondolas or open chairs are suspended by means of one or more cables.<br>`7` - Funicular. Any rail system designed for steep inclines.<br>`11` - Trolleybus. Electric buses that draw power from overhead wires using poles.<br>`12` - Monorail. Railway in which the track consists of a single rail or a beam.',
      enumValues: [
        {
          value: 0,
          label: 'Tram, Streetcar, Light rail',
          description:
            'Any light rail or street level system within a metropolitan area.',
        },
        {
          value: 1,
          label: 'Subway, Metro',
          description:
            'Any underground rail system within a metropolitan area.',
        },
        {
          value: 2,
          label: 'Rail',
          description: 'Used for intercity or long-distance travel.',
        },
        {
          value: 3,
          label: 'Bus',
          description: 'Used for short- and long-distance bus routes.',
        },
        {
          value: 4,
          label: 'Ferry',
          description: 'Used for short- and long-distance boat service.',
        },
        {
          value: 5,
          label: 'Cable tram',
          description:
            'Used for street-level rail cars where the cable runs beneath the vehicle (e.g., cable car in San Francisco).',
        },
        {
          value: 6,
          label: 'Aerial lift, suspended cable car',
          description:
            'Cable transport where cabins, cars, gondolas or open chairs are suspended by means of one or more cables (e.g., gondola lift, aerial tramway).',
        },
        {
          value: 7,
          label: 'Funicular',
          description: 'Any rail system designed for steep inclines.',
        },
        {
          value: 11,
          label: 'Trolleybus',
          description:
            'Electric buses that draw power from overhead wires using poles.',
        },
        {
          value: 12,
          label: 'Monorail',
          description:
            'Railway in which the track consists of a single rail or a beam.',
        },
      ],
    },
    {
      name: 'route_url',
      type: 'URL',
      presence: 'Optional',
      description:
        'URL of a web page about the particular route. Should be different from the `agency.agency_url` value.',
    },
    {
      name: 'route_color',
      type: 'Color',
      presence: 'Optional',
      description:
        'Route color designation that matches public facing material. Defaults to white (`FFFFFF`) when omitted or left empty. The color difference between `route_color` and `route_text_color` should provide sufficient contrast when viewed on a black and white screen.',
    },
    {
      name: 'route_text_color',
      type: 'Color',
      presence: 'Optional',
      description:
        'Legible color to use for text drawn against a background of `route_color`. Defaults to black (`000000`) when omitted or left empty. The color difference between `route_color` and `route_text_color` should provide sufficient contrast when viewed on a black and white screen.',
    },
    {
      name: 'route_sort_order',
      type: 'Non-negative integer',
      presence: 'Optional',
      description:
        'Orders the routes in a way which is ideal for presentation to customers. Routes with smaller `route_sort_order` values should be displayed first.',
    },
    {
      name: 'continuous_pickup',
      type: 'Enum',
      presence: 'Conditionally Forbidden',
      description:
        'Indicates that the rider can board the transit vehicle at any point along the vehicle’s travel path as described by [shapes.txt](#shapestxt), on every trip of the route. Valid options are: <br><br>`0` - Continuous stopping pickup. <br>`1` or empty - No continuous stopping pickup. <br>`2` - Must phone agency to arrange continuous stopping pickup. <br>`3` - Must coordinate with driver to arrange continuous stopping pickup.  <br><br>Values for `routes.continuous_pickup` may be overridden by defining values in `stop_times.continuous_pickup` for specific `stop_time`s along the route. <br><br>**Conditionally Forbidden**:<br>- Any value other than `1` or empty is **Forbidden** if `stop_times.start_pickup_drop_off_window` or `stop_times.end_pickup_drop_off_window` are defined for any trip of this route.<br> - Optional otherwise.',
      enumValues: [
        {
          value: 0,
          label: 'Continuous stopping pickup',
          description:
            "The rider can board the transit vehicle at any point along the vehicle's travel path.",
        },
        {
          value: 1,
          label: 'No continuous stopping pickup',
          description:
            'No continuous stopping pickup. An empty value is equivalent to 1.',
        },
        {
          value: 2,
          label: 'Phone agency',
          description:
            'Must phone agency to arrange continuous stopping pickup.',
        },
        {
          value: 3,
          label: 'Coordinate with driver',
          description:
            'Must coordinate with driver to arrange continuous stopping pickup.',
        },
      ],
    },
    {
      name: 'continuous_drop_off',
      type: 'Enum',
      presence: 'Conditionally Forbidden',
      description:
        'Indicates that the rider can alight from the transit vehicle at any point along the vehicle’s travel path as described by [shapes.txt](#shapestxt), on every trip of the route. Valid options are: <br><br>`0` - Continuous stopping drop off. <br>`1` or empty - No continuous stopping drop off. <br>`2` - Must phone agency to arrange continuous stopping drop off. <br>`3` - Must coordinate with driver to arrange continuous stopping drop off. <br><br>Values for `routes.continuous_drop_off` may be overridden by defining values in `stop_times.continuous_drop_off` for specific `stop_time`s along the route. <br><br>**Conditionally Forbidden**:<br>- Any value other than `1` or empty is **Forbidden** if `stop_times.start_pickup_drop_off_window` or `stop_times.end_pickup_drop_off_window` are defined for any trip of this route.<br> - Optional otherwise.',
      enumValues: [
        {
          value: 0,
          label: 'Continuous stopping drop off',
          description:
            "The rider can alight from the transit vehicle at any point along the vehicle's travel path.",
        },
        {
          value: 1,
          label: 'No continuous stopping drop off',
          description:
            'No continuous stopping drop off. An empty value is equivalent to 1.',
        },
        {
          value: 2,
          label: 'Phone agency',
          description:
            'Must phone agency to arrange continuous stopping drop off.',
        },
        {
          value: 3,
          label: 'Coordinate with driver',
          description:
            'Must coordinate with driver to arrange continuous stopping drop off.',
        },
      ],
    },
    {
      name: 'network_id',
      type: 'ID',
      presence: 'Conditionally Forbidden',
      presenceCondition:
        'Forbidden if networks.txt or route_networks.txt exists. If neither file exists, network_id may be used to identify the network to which a route belongs.',
      description:
        'Identifies a group of routes. Multiple rows in [routes.txt](#routestxt) may have the same `network_id`.<br><br>Conditionally Forbidden:<br>- **Forbidden** if the [route_networks.txt](#route_networkstxt) or [networks.txt](#networkstxt) file exists.<br>- Optional otherwise.',
    },
    {
      name: 'cemv_support',
      type: 'Enum',
      presence: 'Optional',
      description:
        'Indicates if riders can access a transit service (i.e., trip) associated with this route by using a contactless EMV (Europay, Mastercard, and Visa) card or mobile device as fare media at a fare validator (such as in pay-as-you-go or open-loop systems). This field does not indicate that cEMV can be used to purchase other fare products or to add value to another fare media. <br><br> Support for cEMVs should only be indicated if all services under this route are accessible with the use of cEMV cards or mobile devices as fare media. <br><br> Valid options are: <br><br>`0` or empty - No cEMV information for trips associated with this route. <br>`1` - Riders may use cEMVs as fare media for trips associated with this route. <br>`2` - cEMVs are not supported as fare media for trips associated with this route. <br><br> If both `agency.cemv_support` and `routes.cemv_support` are provided for the same service, the value in `routes.cemv_support` shall take precedence. <br><br> This field is independent of all other fare-related files and may be used separately.  If there is conflicting information between this field and any fare-related file (such as [fare_media.txt](#fare_mediatxt), [fare_products.txt](#fare_productstxt), or [fare_leg_rules.txt](#fare_leg_rulestxt)), the information in those files shall take precedence over `agency.cemv_support`.',
      enumValues: [
        {
          value: 0,
          label: 'No information',
          description:
            'No cEMV information for trips associated with this route. An empty value is equivalent to 0.',
        },
        {
          value: 1,
          label: 'cEMV supported',
          description:
            'Riders may use cEMVs as fare media for trips associated with this route.',
        },
        {
          value: 2,
          label: 'cEMV not supported',
          description:
            'cEMVs are not supported as fare media for trips associated with this route.',
        },
      ],
    },
  ],
};
