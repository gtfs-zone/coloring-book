import type { GTFSFileSpec } from '../types';

export const feedInfoSpec: GTFSFileSpec = {
  filename: 'feed_info.txt',
  presence: 'Conditionally Required',
  presenceCondition:
    'Required if translations.txt is provided. Recommended in all other cases.',
  description:
    'Dataset metadata, including information about the publisher, version, and validity of the data.',
  fields: [
    {
      name: 'feed_publisher_name',
      type: 'Text',
      presence: 'Required',
      description:
        'Full name of the organization that publishes the dataset. This may be the same as one of the agency_name values in agency.txt.',
    },
    {
      name: 'feed_publisher_url',
      type: 'URL',
      presence: 'Required',
      description:
        "URL of the dataset publishing organization's website. This may be the same as one of the agency_url values in agency.txt.",
    },
    {
      name: 'feed_lang',
      type: 'Language code',
      presence: 'Required',
      description:
        'Default language used for the text in this dataset. This setting helps GTFS consumers choose capitalization rules and other language-specific settings for the dataset. The file translations.txt can be used if the text needs to be translated into languages other than the default one. The language code nondef ("non-defined") may be used when the language of the text is not known.',
    },
    {
      name: 'default_lang',
      type: 'Language code',
      presence: 'Optional',
      description:
        "Defines the language that should be used when the data consumer doesn't know the language of the rider. It will often be en (English).",
    },
    {
      name: 'feed_start_date',
      type: 'Date',
      presence: 'Recommended',
      description:
        'The dataset provides complete and reliable schedule information for service in the period from the beginning of the feed_start_date day to the end of the feed_end_date day. Both days can be left empty if unavailable. The feed_end_date date must not precede the feed_start_date date if both are given. Dataset providers are encouraged to give schedule data outside this period to advise of likely future service, but dataset consumers should treat it mindful of its non-authoritative status. If feed_start_date or feed_end_date extend beyond the active calendar dates defined in calendar.txt and calendar_dates.txt, the dataset is making an explicit assertion that there is no service for dates within the feed_start_date or feed_end_date range but not included in the active calendar dates.',
    },
    {
      name: 'feed_end_date',
      type: 'Date',
      presence: 'Recommended',
      description:
        'The dataset provides complete and reliable schedule information for service in the period from the beginning of the feed_start_date day to the end of the feed_end_date day. Both days can be left empty if unavailable. The feed_end_date date must not precede the feed_start_date date if both are given. Dataset providers are encouraged to give schedule data outside this period to advise of likely future service, but dataset consumers should treat it mindful of its non-authoritative status. If feed_start_date or feed_end_date extend beyond the active calendar dates defined in calendar.txt and calendar_dates.txt, the dataset is making an explicit assertion that there is no service for dates within the feed_start_date or feed_end_date range but not included in the active calendar dates.',
    },
    {
      name: 'feed_version',
      type: 'Text',
      presence: 'Recommended',
      description:
        'String that indicates the current version of their GTFS dataset. GTFS-consuming applications can display this value to help dataset publishers determine whether the latest dataset has been incorporated.',
    },
    {
      name: 'feed_contact_email',
      type: 'Email',
      presence: 'Optional',
      description:
        'Email address for communication regarding the GTFS dataset and data publishing practices. feed_contact_email is a technical contact for GTFS-consuming applications. Provide customer service contact information through agency.txt.',
    },
    {
      name: 'feed_contact_url',
      type: 'URL',
      presence: 'Optional',
      description:
        'URL for contact information, a web-form, support desk, or other tools for communication regarding the GTFS dataset and data publishing practices. feed_contact_url is a technical contact for GTFS-consuming applications. Provide customer service contact information through agency.txt.',
    },
  ],
};
