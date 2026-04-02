import type { GTFSFileSpec } from '../types';

export const routeNetworksSpec: GTFSFileSpec = {
  filename: 'route_networks.txt',
  presence: 'Conditionally Forbidden',
  presenceCondition:
    'Forbidden if network_id exists in routes.txt. Optional otherwise.',
  description:
    'Rules to assign routes to networks. Assigns one or more routes to a network defined in networks.txt for use in fare leg rules.\n\nConditionally Forbidden: Forbidden if network_id exists in routes.txt. This reflects the two mutually exclusive approaches to defining route networks: either inline via routes.network_id, or via the separate networks.txt + route_networks.txt files.',
  fields: [
    {
      name: 'network_id',
      type: 'Foreign ID',
      presence: 'Required',
      description:
        "Identifies a network to which one or multiple route_id's belong. The same route_id may appear in only one network_id entry.",
      foreignKey: { file: 'networks.txt', field: 'network_id' },
    },
    {
      name: 'route_id',
      type: 'Foreign ID',
      presence: 'Required',
      description:
        'Identifies a route. A given route_id may only be assigned to one network_id.',
      foreignKey: { file: 'routes.txt', field: 'route_id' },
    },
  ],
};
