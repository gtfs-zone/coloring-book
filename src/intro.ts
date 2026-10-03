/**
 * The intro copy for the active locale. `intro.html` is also inlined into the
 * static page by `vite.config.js`, so it is what renders without JS.
 */

import { getLocale } from 'gtfs-zone-web-common/i18n/index';
import introEn from './intro.html?raw';
import introFr from './intro.fr.html?raw';

export function introHtml(): string {
  return getLocale() === 'fr' ? introFr : introEn;
}
