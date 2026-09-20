/**
 * Inline Entity Creator Utility
 * Creates a GTFS entity with default values under a generated ID
 */

import type { GTFSDatabase } from '../modules/gtfs-database';
import { notify } from 'interlocking/ui/notification-system';
import { getNaturalKeyField } from './gtfs-primary-keys';
import {
  createDefaultAgency,
  createDefaultRoute,
  createDefaultService,
} from './default-values';

interface PatchManagerLike {
  recordInsert: (
    table: string,
    id: string,
    record: Record<string, unknown>
  ) => Promise<void>;
}

interface RowSource {
  getAllRows: (tableName: string) => Promise<unknown[]>;
}

/**
 * First free `<prefix>_<n>` ID in a naturally-keyed table, counting from 1.
 */
export async function nextEntityId(
  database: RowSource,
  tableName: string,
  prefix: string
): Promise<string> {
  const keyField = getNaturalKeyField(tableName);
  if (!keyField) {
    throw new Error(`[nextEntityId] ${tableName} has no natural key`);
  }

  const rows = (await database.getAllRows(tableName)) as Record<
    string,
    unknown
  >[];
  const taken = new Set(rows.map((row) => String(row[keyField])));

  let n = 1;
  while (taken.has(`${prefix}_${n}`)) {
    n += 1;
  }
  return `${prefix}_${n}`;
}

export class InlineEntityCreator {
  constructor(
    private database: GTFSDatabase,
    private onEntityCreated: () => void,
    private patchManager?: PatchManagerLike
  ) {}

  /**
   * Create a new agency under a generated ID, returning that ID
   */
  async createAgency(): Promise<string | null> {
    try {
      const agency_id = await nextEntityId(this.database, 'agency', 'agency');
      const newAgency = createDefaultAgency(agency_id);
      await this.database.insertRows('agency', [newAgency]);
      await this.patchManager?.recordInsert(
        'agency',
        agency_id,
        newAgency as unknown as Record<string, unknown>
      );

      this.onEntityCreated();
      return agency_id;
    } catch (error) {
      console.error('Error creating agency:', error);
      notify.error(
        `Failed to create agency: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return null;
    }
  }

  /**
   * Create a new service (calendar entry) under a generated ID
   */
  async createService(): Promise<string | null> {
    try {
      const service_id = await nextEntityId(
        this.database,
        'calendar',
        'service'
      );
      const newService = createDefaultService(service_id);
      await this.database.insertRows('calendar', [newService]);
      await this.patchManager?.recordInsert(
        'calendar',
        service_id,
        newService as unknown as Record<string, unknown>
      );

      this.onEntityCreated();
      return service_id;
    } catch (error) {
      console.error('Error creating service:', error);
      notify.error(
        `Failed to create service: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return null;
    }
  }

  /**
   * Create a new route under a generated ID, on the given agency or the first
   */
  async createRoute(agencyId?: string): Promise<string | null> {
    try {
      const route_id = await nextEntityId(this.database, 'routes', 'route');

      let finalAgencyId = agencyId;
      if (!finalAgencyId) {
        const agencies = await this.database.getAllRows('agency');
        if (agencies.length > 0) {
          finalAgencyId = agencies[0].agency_id as string;
        }
      }

      const newRoute = createDefaultRoute(route_id, finalAgencyId);
      await this.database.insertRows('routes', [newRoute]);
      await this.patchManager?.recordInsert(
        'routes',
        route_id,
        newRoute as unknown as Record<string, unknown>
      );

      this.onEntityCreated();
      return route_id;
    } catch (error) {
      console.error('Error creating route:', error);
      notify.error(
        `Failed to create route: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return null;
    }
  }
}
