import type { GTFSFileSpec } from '../types';

export const routeNetworksSpec: GTFSFileSpec = {
  filename: 'route_networks.txt',
  presence: 'Conditionally Forbidden',
  presenceCondition:
    'Forbidden if network_id exists in routes.txt. Optional otherwise.',
  description: 'Assigns routes from [routes.txt](#routestxt) to networks.',
  fields: [
    {
      name: 'network_id',
      type: 'Foreign ID referencing `networks.network_id`',
      presence: 'Required',
      description:
        'Identifies a network to which one or multiple `route_id`s belong. A `route_id` can only be defined in one `network_id`.',
      foreignKey: [{ file: 'networks.txt', field: 'network_id' }],
    },
    {
      name: 'route_id',
      type: 'Foreign ID referencing `routes.route_id`',
      presence: 'Required',
      description: 'Identifies a route.',
      foreignKey: [{ file: 'routes.txt', field: 'route_id' }],
    },
  ],
};
