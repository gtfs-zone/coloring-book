import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { en } from './catalog.en';
import { common } from './fr/common';
import { fields } from './fr/fields';
import { help } from './fr/help';
import { load } from './fr/load';
import { pages } from './fr/pages';
import { shell } from './fr/shell';
import { views } from './fr/views';

/** edit.gtfs.zone's UI strings, in French. */
export const fr: Translation<typeof en> = {
  ...common,
  ...fields,
  ...help,
  ...load,
  ...pages,
  ...shell,
  ...views,
};
