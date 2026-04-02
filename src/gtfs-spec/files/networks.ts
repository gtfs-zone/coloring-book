import type { GTFSFileSpec } from '../types';

export const networksSpec: GTFSFileSpec = {
  filename: 'networks.txt',
  presence: 'Conditionally Forbidden',
  presenceCondition:
    'Forbidden if network_id exists in routes.txt. Optional otherwise.',
  description:
    'Network grouping of routes. Networks are used in fare leg rules (fare_leg_rules.txt) to associate fare rules with groups of routes. Routes are assigned to networks via route_networks.txt.\n\nConditionally Forbidden: Forbidden if network_id exists in routes.txt. This reflects the two mutually exclusive approaches to defining route networks: either inline via routes.network_id, or via the separate networks.txt + route_networks.txt files.',
  fields: [
    {
      name: 'network_id',
      type: 'Unique ID',
      presence: 'Required',
      isPrimaryKey: true,
      description: 'Identifies a network. Must be unique in networks.txt.',
    },
    {
      name: 'network_name',
      type: 'Text',
      presence: 'Optional',
      description:
        'The name of the network that applies to the fare leg rules, as used by the local agency and its riders.',
    },
  ],
};
