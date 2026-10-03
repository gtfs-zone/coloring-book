import { z } from 'zod';
import zodFr from 'zod/v4/locales/fr.js';
import { getLocale } from 'gtfs-zone-web-common/i18n/index';

/** Point Zod's built-in error messages at the active locale. */
export function applyZodLocale(): void {
  if (getLocale() === 'fr') {
    z.config(zodFr());
  }
}
