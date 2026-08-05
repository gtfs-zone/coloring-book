import type { GTFSFileSpec } from '../types';

export const networksSpec: GTFSFileSpec = {
  filename: 'networks.txt',
  presence: 'Conditionally Forbidden',
  presenceCondition:
    'Forbidden if network_id exists in routes.txt. Optional otherwise.',
  description: 'Defines network identifiers that apply for fare leg rules.',
  fields: [
    {
      name: 'network_id',
      type: 'Unique ID',
      presence: 'Required',
      description:
        'Identifies a network. Must be unique in [networks.txt](#networkstxt).',
      isPrimaryKey: true,
    },
    {
      name: 'network_name',
      type: 'Text',
      presence: 'Optional',
      description:
        'The name of the network that apply for fare leg rules, as used by the local agency and its riders.',
    },
  ],
};
