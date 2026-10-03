import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { en } from './catalog.en';
import { calendar } from './fr/calendar';
import { common } from './fr/common';
import { fields } from './fr/fields';
import { help } from './fr/help';
import { load } from './fr/load';
import { map } from './fr/map';
import { modals } from './fr/modals';
import { pages } from './fr/pages';
import { shapes } from './fr/shapes';
import { shell } from './fr/shell';
import { timetable } from './fr/timetable';
import { views } from './fr/views';

/** edit.gtfs.zone's UI strings, in French. */
export const fr: Translation<typeof en> = {
  ...calendar,
  ...common,
  ...fields,
  ...help,
  ...load,
  ...map,
  ...modals,
  ...pages,
  ...shapes,
  ...shell,
  ...timetable,
  ...views,
};
