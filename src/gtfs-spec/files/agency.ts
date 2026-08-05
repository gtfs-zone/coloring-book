import type { GTFSFileSpec } from '../types';

export const agencySpec: GTFSFileSpec = {
  filename: 'agency.txt',
  presence: 'Required',
  description: 'Transit agencies with service represented in this dataset.',
  fields: [
    {
      name: 'agency_id',
      type: 'Unique ID',
      presence: 'Conditionally Required',
      presenceCondition:
        'Required when the dataset contains data for multiple transit agencies, otherwise optional.',
      description:
        'Identifies a transit brand which is often synonymous with a transit agency. Note that in some cases, such as when a single agency operates multiple separate services, agencies and brands are distinct. This document uses the term "agency" in place of "brand". A dataset may contain data from multiple agencies. <br><br>Conditionally Required:<br>- **Required** when the dataset contains data for multiple transit agencies. <br>- Recommended otherwise.',
      isPrimaryKey: true,
    },
    {
      name: 'agency_name',
      type: 'Text',
      presence: 'Required',
      description: 'Full name of the transit agency.',
    },
    {
      name: 'agency_url',
      type: 'URL',
      presence: 'Required',
      description: 'URL of the transit agency.',
    },
    {
      name: 'agency_timezone',
      type: 'Timezone',
      presence: 'Required',
      description:
        'Timezone where the transit agency is located. If multiple agencies are specified in the dataset, each must have the same `agency_timezone`.',
    },
    {
      name: 'agency_lang',
      type: 'Language code',
      presence: 'Optional',
      description:
        'Primary language used by this transit agency. Should be provided to help GTFS consumers choose capitalization rules and other language-specific settings for the dataset.',
    },
    {
      name: 'agency_phone',
      type: 'Phone number',
      presence: 'Optional',
      description:
        'A voice telephone number for the specified agency. This field is a string value that presents the telephone number as typical for the agency\'s service area. It may contain punctuation marks to group the digits of the number. Dialable text (for example, TriMet\'s "503-238-RIDE") is permitted, but the field must not contain any other descriptive text.',
    },
    {
      name: 'agency_fare_url',
      type: 'URL',
      presence: 'Optional',
      description:
        "URL of a web page where a rider can purchase tickets or other fare instruments for that agency, or a web page containing information about that agency's fares.",
    },
    {
      name: 'agency_email',
      type: 'Email',
      presence: 'Optional',
      description:
        'Email address actively monitored by the agency’s customer service department. This email address should be a direct contact point where transit riders can reach a customer service representative at the agency.',
    },
    {
      name: 'cemv_support',
      type: 'Enum',
      presence: 'Optional',
      description:
        'Indicates if riders can access a transit service (i.e., trip) associated with this agency by using a contactless EMV (Europay, Mastercard, and Visa) card or mobile device as fare media at a fare validator (such as in pay-as-you-go or open-loop systems). This field does not indicate that cEMV can be used to purchase other fare products or to add value to another fare media. <br><br>Support for cEMVs should only be indicated if all services under this agency are accessible with the use of cEMV cards or mobile devices as fare media. <br><br>Valid options are: <br><br>`0` or empty - No cEMV information for trips associated with this agency. <br>`1` - Riders may use cEMVs as fare media for trips associated with this agency. <br>`2` - cEMVs are not supported as fare media for trips associated with this agency. <br><br>If both `agency.cemv_support` and `routes.cemv_support` are provided for the same service, the value in `routes.cemv_support` shall take precedence. <br><br> This field is independent of all other fare-related files and may be used separately.  If there is conflicting information between this field and any fare-related file (such as [fare_media.txt](#fare_mediatxt), [fare_products.txt](#fare_productstxt), or [fare_leg_rules.txt](#fare_leg_rulestxt)), the information in those files shall take precedence over `agency.cemv_support`.',
      enumValues: [
        {
          value: 0,
          label: 'No information',
          description:
            'No cEMV information for trips associated with this agency. An empty value is equivalent to 0.',
        },
        {
          value: 1,
          label: 'cEMV supported',
          description:
            'Riders may use cEMVs as fare media for trips associated with this agency.',
        },
        {
          value: 2,
          label: 'cEMV not supported',
          description:
            'cEMVs are not supported as fare media for trips associated with this agency.',
        },
      ],
    },
  ],
};
