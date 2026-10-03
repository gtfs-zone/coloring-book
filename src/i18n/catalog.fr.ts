import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { en } from './catalog.en';
import { common } from './fr/common';
import { load } from './fr/load';
import { shell } from './fr/shell';

/** edit.gtfs.zone's UI strings, in French. */
export const fr: Translation<typeof en> = {
  ...common,
  ...load,
  ...shell,
};
