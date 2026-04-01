import type { GTFSSpec } from './types';
import { agencySpec } from './files/agency';
import { feedInfoSpec } from './files/feed-info';
import { stopsSpec } from './files/stops';

export const gtfsSpec: GTFSSpec = {
  specVersion: '2026-04',
  files: [agencySpec, feedInfoSpec, stopsSpec],
};
