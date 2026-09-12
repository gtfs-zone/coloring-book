/**
 * Option lists for the GTFS field types whose values come from a closed set.
 *
 * Language, timezone and currency codes are all standards the browser already
 * ships a copy of, so the lists are derived from `Intl` rather than checked in.
 * The picker and the validator both read from here, so a value the picker can
 * offer is never one the validator rejects.
 *
 * Each list is memoized: building them costs a few hundred `Intl` objects and
 * nothing in them changes for the life of the page.
 */

import type { OptionPickerItem } from '../modules/option-picker-modal';

/**
 * BCP-47 primary language subtags offered by the picker.
 *
 * The full tag space is open (a region, script or variant may be appended to
 * any of these), so this is a starting point, not a whitelist. Anything the
 * list does not carry is still reachable through the picker's custom-value
 * escape hatch, and `isValidLanguageCode` accepts any well-formed tag.
 */
const LANGUAGE_SUBTAGS = [
  'aa',
  'ab',
  'ae',
  'af',
  'ak',
  'am',
  'an',
  'ar',
  'as',
  'av',
  'ay',
  'az',
  'ba',
  'be',
  'bg',
  'bh',
  'bi',
  'bm',
  'bn',
  'bo',
  'br',
  'bs',
  'ca',
  'ce',
  'ch',
  'co',
  'cr',
  'cs',
  'cu',
  'cv',
  'cy',
  'da',
  'de',
  'dv',
  'dz',
  'ee',
  'el',
  'en',
  'eo',
  'es',
  'et',
  'eu',
  'fa',
  'ff',
  'fi',
  'fj',
  'fo',
  'fr',
  'fy',
  'ga',
  'gd',
  'gl',
  'gn',
  'gu',
  'gv',
  'ha',
  'he',
  'hi',
  'ho',
  'hr',
  'ht',
  'hu',
  'hy',
  'hz',
  'ia',
  'id',
  'ie',
  'ig',
  'ii',
  'ik',
  'io',
  'is',
  'it',
  'iu',
  'ja',
  'jv',
  'ka',
  'kg',
  'ki',
  'kj',
  'kk',
  'kl',
  'km',
  'kn',
  'ko',
  'kr',
  'ks',
  'ku',
  'kv',
  'kw',
  'ky',
  'la',
  'lb',
  'lg',
  'li',
  'ln',
  'lo',
  'lt',
  'lu',
  'lv',
  'mg',
  'mh',
  'mi',
  'mk',
  'ml',
  'mn',
  'mr',
  'ms',
  'mt',
  'my',
  'na',
  'nb',
  'nd',
  'ne',
  'ng',
  'nl',
  'nn',
  'no',
  'nr',
  'nv',
  'ny',
  'oc',
  'oj',
  'om',
  'or',
  'os',
  'pa',
  'pi',
  'pl',
  'ps',
  'pt',
  'qu',
  'rm',
  'rn',
  'ro',
  'ru',
  'rw',
  'sa',
  'sc',
  'sd',
  'se',
  'sg',
  'si',
  'sk',
  'sl',
  'sm',
  'sn',
  'so',
  'sq',
  'sr',
  'ss',
  'st',
  'su',
  'sv',
  'sw',
  'ta',
  'te',
  'tg',
  'th',
  'ti',
  'tk',
  'tl',
  'tn',
  'to',
  'tr',
  'ts',
  'tt',
  'tw',
  'ty',
  'ug',
  'uk',
  'ur',
  'uz',
  've',
  'vi',
  'vo',
  'wa',
  'wo',
  'xh',
  'yi',
  'yo',
  'za',
  'zh',
  'zu',
];

/**
 * Region- and script-qualified tags common enough in transit feeds to be worth
 * offering directly, so the Swiss and Brazilian cases do not need the escape
 * hatch.
 */
const LANGUAGE_TAGS_WITH_REGION = [
  'de-AT',
  'de-CH',
  'de-DE',
  'en-AU',
  'en-CA',
  'en-GB',
  'en-IE',
  'en-IN',
  'en-NZ',
  'en-US',
  'en-ZA',
  'es-AR',
  'es-CL',
  'es-CO',
  'es-ES',
  'es-MX',
  'fr-BE',
  'fr-CA',
  'fr-CH',
  'fr-FR',
  'it-CH',
  'it-IT',
  'nl-BE',
  'nl-NL',
  'pt-BR',
  'pt-PT',
  'sv-FI',
  'sv-SE',
  'zh-Hans',
  'zh-Hant',
];

let languageCache: OptionPickerItem[] | null = null;
let timezoneCache: OptionPickerItem[] | null = null;
let currencyCache: OptionPickerItem[] | null = null;
let timezoneSet: Set<string> | null = null;

/**
 * An `Intl` display-name lookup, or a pass-through when the browser lacks it.
 *
 * Missing display names cost labels, not options, so this warns and carries on
 * rather than emptying the list the way a missing value source does.
 */
function displayNames(type: 'language' | 'currency'): (code: string) => string {
  if (typeof Intl.DisplayNames !== 'function') {
    console.warn(
      `[ConstrainedValues] Intl.DisplayNames is unavailable, ${type} options are labelled by code`
    );
    return (code) => code;
  }
  const names = new Intl.DisplayNames(['en'], { type, fallback: 'code' });
  return (code) => {
    try {
      return names.of(code) ?? code;
    } catch {
      return code;
    }
  };
}

/** The values `Intl` knows for one of its enumerable key types. */
function supportedValues(key: 'timeZone' | 'currency'): string[] {
  const supported = (
    Intl as typeof Intl & {
      supportedValuesOf?: (key: string) => string[];
    }
  ).supportedValuesOf;
  if (typeof supported !== 'function') {
    console.warn(
      `[ConstrainedValues] Intl.supportedValuesOf is unavailable, no ${key} options`
    );
    return [];
  }
  return supported(key);
}

/** The zone's current UTC offset, as a short hint beside its name. */
function timezoneOffset(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/** BCP-47 language tags, labelled in English. */
export function languageOptions(): OptionPickerItem[] {
  if (languageCache) {
    return languageCache;
  }
  const label = displayNames('language');
  const tags = [...LANGUAGE_SUBTAGS, ...LANGUAGE_TAGS_WITH_REGION];
  languageCache = tags
    .map((tag) => ({ value: tag, primary: label(tag), secondary: tag }))
    .sort((a, b) => a.primary.localeCompare(b.primary));
  return languageCache;
}

/** IANA timezone names, with their current UTC offset as a hint. */
export function timezoneOptions(): OptionPickerItem[] {
  if (timezoneCache) {
    return timezoneCache;
  }
  timezoneCache = supportedValues('timeZone').map((zone) => ({
    value: zone,
    primary: zone,
    secondary: timezoneOffset(zone),
  }));
  return timezoneCache;
}

/** ISO 4217 currency codes, labelled in English. */
export function currencyOptions(): OptionPickerItem[] {
  if (currencyCache) {
    return currencyCache;
  }
  const label = displayNames('currency');
  currencyCache = supportedValues('currency')
    .map((code) => ({ value: code, primary: label(code), secondary: code }))
    .sort((a, b) => a.primary.localeCompare(b.primary));
  return currencyCache;
}

/**
 * Whether a value is a well-formed BCP-47 language tag.
 *
 * Structure only. `Intl` has no registry of which tags exist, so `xx-YY` is
 * accepted: it is well formed, and rejecting it would flag valid private-use
 * and extension tags too.
 */
export function isValidLanguageCode(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value).length > 0;
  } catch {
    return false;
  }
}

/** Whether a value names a timezone the browser's tz database carries. */
export function isValidTimezone(value: string): boolean {
  if (!timezoneSet) {
    timezoneSet = new Set(supportedValues('timeZone'));
  }
  if (timezoneSet.has(value)) {
    return true;
  }
  // supportedValuesOf lists canonical names only, so an alias such as
  // Asia/Calcutta has to be resolved by asking the formatter directly.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Whether a value is a three-letter ISO 4217 currency code. */
export function isValidCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}
