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
      type: 'Foreign ID',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if multiple agencies are defined in agency.txt, otherwise optional.',
      description: 'Agency for the specified route.',
      foreignKey: { file: 'agency.txt', field: 'agency_id' },
    },
    {
      name: 'route_short_name',
      type: 'Text',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if routes.txt does not contain route_long_name. Recommended if there is a brief service designation (e.g. "32", "100X", "Green").',
      description:
        'Short name of a route. Often a short, abstract identifier (e.g., "32", "100X", "Green") that riders use to identify a route. Both route_short_name and route_long_name may be defined.',
    },
    {
      name: 'route_long_name',
      type: 'Text',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if routes.txt does not contain route_short_name.',
      description:
        "Full name of a route. This name is generally more descriptive than the route_short_name and often includes the route's destination or stop. Both route_short_name and route_long_name may be defined.",
    },
    {
      name: 'route_desc',
      type: 'Text',
      presence: 'Optional',
      description:
        'Description of a route that provides useful, quality information. Should not be a duplicate of route_short_name or route_long_name.',
    },
    {
      name: 'route_type',
      type: 'Enum',
      presence: 'Required',
      description:
        'Indicates the type of transportation used on a route. Valid options are:\n\n0 - Tram, Streetcar, Light rail.\n1 - Subway, Metro.\n2 - Rail.\n3 - Bus.\n4 - Ferry.\n5 - Cable tram.\n6 - Aerial lift, suspended cable car.\n7 - Funicular.\n11 - Trolleybus.\n12 - Monorail.',
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
        'URL of a web page about the particular route. Should be different from the agency_url.',
    },
    {
      name: 'route_color',
      type: 'Color',
      presence: 'Optional',
      description:
        'Route color designation that matches public facing material. Defaults to white (FFFFFF) when omitted or left empty. The color difference between route_color and route_text_color should provide sufficient contrast when viewed on a black and white screen.',
    },
    {
      name: 'route_text_color',
      type: 'Color',
      presence: 'Optional',
      description:
        'Legible color to use for text drawn against a background of route_color. Defaults to black (000000) when omitted or left empty. The color difference between route_color and route_text_color should provide sufficient contrast when viewed on a black and white screen.',
    },
    {
      name: 'route_sort_order',
      type: 'Non-negative integer',
      presence: 'Optional',
      description:
        'Orders the routes in a way which is ideal for presentation to customers. Routes with smaller route_sort_order values should be displayed first.',
    },
    {
      name: 'continuous_pickup',
      type: 'Enum',
      presence: 'Optional',
      description:
        "Indicates that the rider can board the transit vehicle at any point along the vehicle's travel path as described by shapes.txt, on every trip of the route. Valid options are:\n\n0 - Continuous stopping pickup.\n1 (or empty) - No continuous stopping pickup.\n2 - Must phone agency to arrange continuous stopping pickup.\n3 - Must coordinate with driver to arrange continuous stopping pickup.\n\nValues for routes.continuous_pickup may be overridden by defining values in stop_times.continuous_pickup.",
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
      presence: 'Optional',
      description:
        "Indicates that the rider can alight from the transit vehicle at any point along the vehicle's travel path as described by shapes.txt, on every trip of the route. Valid options are:\n\n0 - Continuous stopping drop off.\n1 (or empty) - No continuous stopping drop off.\n2 - Must phone agency to arrange continuous stopping drop off.\n3 - Must coordinate with driver to arrange continuous stopping drop off.\n\nValues for routes.continuous_drop_off may be overridden by defining values in stop_times.continuous_drop_off.",
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
        'Identifies a network to which the route belongs. Mutually exclusive with the use of networks.txt and route_networks.txt. If those files are present, network_id must not be set here.',
    },
  ],
};
