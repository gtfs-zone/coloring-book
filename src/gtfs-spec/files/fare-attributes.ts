import type { GTFSFileSpec } from '../types';

export const fareAttributesSpec: GTFSFileSpec = {
  filename: 'fare_attributes.txt',
  presence: 'Optional',
  description:
    "**Versions**<br>\nThere are two modelling options for describing fares. GTFS-Fares V1 is the legacy option for describing minimal fare information. GTFS-Fares V2 is an updated method that allows for a more detailed account of an agency's fare structure. Both are allowed to be present in a dataset, but only one method should be used by a data consumer for a given dataset. It is recommended that GTFS-Fares V2 takes precedence over GTFS-Fares V1. <br><br>The files associated with GTFS-Fares V1 are: <br>- [fare_attributes.txt](#fare_attributestxt)<br>- [fare_rules.txt](#fare_rulestxt)<br><br>The files associated with GTFS-Fares V2 are: <br>- [fare_media.txt](#fare_mediatxt)<br>- [fare_products.txt](#fare_productstxt)<br>- [rider_categories.txt](#rider_categoriestxt)<br>- [fare_leg_rules.txt](#fare_leg_rulestxt)<br>- [fare_leg_join_rules.txt](#fare_leg_join_rulestxt)<br>- [fare_transfer_rules.txt](#fare_transfer_rulestxt)<br>- [timeframes.txt](#timeframestxt)<br>- [networks.txt](#networkstxt)<br>- [route_networks.txt](#route_networkstxt)<br>- [areas.txt](#areastxt)<br>- [stop_areas.txt](#stop_areastxt)\n<br>",
  fields: [
    {
      name: 'fare_id',
      type: 'Unique ID',
      presence: 'Required',
      description: 'Identifies a fare class.',
      isPrimaryKey: true,
    },
    {
      name: 'price',
      type: 'Non-negative float',
      presence: 'Required',
      description: 'Fare price, in the unit specified by `currency_type`.',
    },
    {
      name: 'currency_type',
      type: 'Currency code',
      presence: 'Required',
      description: 'Currency used to pay the fare.',
    },
    {
      name: 'payment_method',
      type: 'Enum',
      presence: 'Required',
      description:
        'Indicates when the fare must be paid. Valid options are:<br><br>`0` - Fare is paid on board.<br>`1` - Fare must be paid before boarding.',
      enumValues: [
        {
          value: 0,
          label: 'On board',
          description: 'Fare is paid on board.',
        },
        {
          value: 1,
          label: 'Before boarding',
          description: 'Fare must be paid before boarding.',
        },
      ],
    },
    {
      name: 'transfers',
      type: 'Enum',
      presence: 'Required',
      description:
        'Indicates the number of transfers permitted on this fare. Valid options are:<br><br>`0` - No transfers permitted on this fare.<br>`1` - Riders may transfer once.<br>`2` - Riders may transfer twice.<br>empty - Unlimited transfers are permitted.',
      enumValues: [
        {
          value: 0,
          label: 'No transfers',
          description: 'No transfers permitted on this fare.',
        },
        {
          value: 1,
          label: 'One transfer',
          description: 'Riders may transfer once.',
        },
        {
          value: 2,
          label: 'Two transfers',
          description: 'Riders may transfer twice.',
        },
        {
          value: '',
          label: 'Unlimited',
          description: 'Unlimited transfers are permitted.',
        },
      ],
    },
    {
      name: 'agency_id',
      type: 'Foreign ID referencing `agency.agency_id`',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required if multiple agencies are defined in agency.txt.',
      description:
        'Identifies the relevant agency for a fare. <br><br>Conditionally Required:<br>- **Required** if multiple agencies are defined in [agency.txt](#agencytxt).<br>- Recommended otherwise.',
      foreignKey: [{ file: 'agency.txt', field: 'agency_id' }],
    },
    {
      name: 'transfer_duration',
      type: 'Non-negative integer',
      presence: 'Optional',
      description:
        'Length of time in seconds before a transfer expires. When `transfers`=`0` this field may be used to indicate how long a ticket is valid for or it may be left empty.',
    },
  ],
};
