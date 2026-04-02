import type { GTFSFileSpec } from '../types';

export const attributionsSpec: GTFSFileSpec = {
  filename: 'attributions.txt',
  presence: 'Optional',
  description: 'Defines the attributions applied to the dataset.',
  fields: [
    {
      name: 'attribution_id',
      type: 'Unique ID',
      presence: 'Optional',
      isPrimaryKey: true,
      description:
        'Identifies an attribution for the dataset or a subset of it. This is mostly useful for translations.',
    },
    {
      name: 'agency_id',
      type: 'Foreign ID',
      presence: 'Optional',
      description:
        'Agency to which the attribution applies. If one agency_id, route_id, or trip_id attribution is defined, the other ones must be empty. If none of them is specified, the attribution will apply to the whole dataset.',
      foreignKey: { file: 'agency.txt', field: 'agency_id' },
    },
    {
      name: 'route_id',
      type: 'Foreign ID',
      presence: 'Optional',
      description:
        'Route to which the attribution applies. If one agency_id, route_id, or trip_id attribution is defined, the other ones must be empty. If none of them is specified, the attribution will apply to the whole dataset.',
      foreignKey: { file: 'routes.txt', field: 'route_id' },
    },
    {
      name: 'trip_id',
      type: 'Foreign ID',
      presence: 'Optional',
      description:
        'Trip to which the attribution applies. If one agency_id, route_id, or trip_id attribution is defined, the other ones must be empty. If none of them is specified, the attribution will apply to the whole dataset.',
      foreignKey: { file: 'trips.txt', field: 'trip_id' },
    },
    {
      name: 'organization_name',
      type: 'Text',
      presence: 'Required',
      description:
        'Name of the organization that the dataset is attributed to.',
    },
    {
      name: 'is_producer',
      type: 'Enum',
      presence: 'Optional',
      description:
        'The role of the organization is producer. Allowed values: 0 or empty - Organization does not have this role. 1 - Organization does have this role.\n\nAt least one of the fields is_producer, is_operator, or is_authority should be set at 1.',
      enumValues: [
        {
          value: 0,
          label: 'Not producer',
          description: 'Organization does not have the role of producer.',
        },
        {
          value: 1,
          label: 'Producer',
          description: 'Organization does have the role of producer.',
        },
      ],
    },
    {
      name: 'is_operator',
      type: 'Enum',
      presence: 'Optional',
      description:
        'The role of the organization is operator. Allowed values: 0 or empty - Organization does not have this role. 1 - Organization does have this role.\n\nAt least one of the fields is_producer, is_operator, or is_authority should be set at 1.',
      enumValues: [
        {
          value: 0,
          label: 'Not operator',
          description: 'Organization does not have the role of operator.',
        },
        {
          value: 1,
          label: 'Operator',
          description: 'Organization does have the role of operator.',
        },
      ],
    },
    {
      name: 'is_authority',
      type: 'Enum',
      presence: 'Optional',
      description:
        'The role of the organization is authority. Allowed values: 0 or empty - Organization does not have this role. 1 - Organization does have this role.\n\nAt least one of the fields is_producer, is_operator, or is_authority should be set at 1.',
      enumValues: [
        {
          value: 0,
          label: 'Not authority',
          description: 'Organization does not have the role of authority.',
        },
        {
          value: 1,
          label: 'Authority',
          description: 'Organization does have the role of authority.',
        },
      ],
    },
    {
      name: 'attribution_url',
      type: 'URL',
      presence: 'Optional',
      description: 'URL of the organization.',
    },
    {
      name: 'attribution_email',
      type: 'Email',
      presence: 'Optional',
      description: 'Email of the organization.',
    },
    {
      name: 'attribution_phone',
      type: 'Phone number',
      presence: 'Optional',
      description: 'Phone number of the organization.',
    },
  ],
};
