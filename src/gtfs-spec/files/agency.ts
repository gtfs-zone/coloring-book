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
        'Identifies a transit brand which is often synonymous with a transit agency. Note that in some cases, such as when a single agency operates multiple separate services, agencies and brands are distinct. This document uses the term "agency" in place of "brand". A dataset may contain data from multiple agencies.',
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
        'Timezone where the transit agency is located. If multiple agencies are specified in the dataset, each must have the same agency_timezone.',
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
        'URL of a web page that allows a rider to purchase tickets or other fare instruments for that agency online.',
    },
    {
      name: 'agency_email',
      type: 'Email',
      presence: 'Optional',
      description:
        "Email address actively monitored by the agency's customer service department. This email address should be a direct contact point where transit riders can reach a customer service representative at the agency.",
    },
  ],
};
