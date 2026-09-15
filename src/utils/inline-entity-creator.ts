/**
 * Inline Entity Creator Utility
 * Provides reusable logic for creating GTFS entities inline
 */

import type { GTFSDatabase } from '../modules/gtfs-database';
import { notify } from 'interlocking/modules/notification-system';
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

export class InlineEntityCreator {
  constructor(
    private database: GTFSDatabase,
    private onEntityCreated: () => void,
    private patchManager?: PatchManagerLike
  ) {}

  /**
   * Validate that an ID is not empty and doesn't contain problematic characters
   */
  private validateId(id: string, entityType: string): boolean {
    if (!id || id.trim() === '') {
      notify.error(`${entityType} ID cannot be empty`);
      return false;
    }

    // Basic validation - could be extended
    const trimmedId = id.trim();
    if (trimmedId !== id) {
      notify.warning(
        `${entityType} ID has leading/trailing spaces - they will be removed`
      );
    }

    return true;
  }

  /**
   * Create a new agency
   */
  async createAgency(agencyId: string): Promise<boolean> {
    const trimmedId = agencyId.trim();

    if (!this.validateId(trimmedId, 'Agency')) {
      return false;
    }

    try {
      // Check if agency already exists
      const existing = await this.database.getRow('agency', trimmedId);
      if (existing) {
        notify.error(`Agency "${trimmedId}" already exists`);
        return false;
      }

      // Create new agency with defaults
      const newAgency = createDefaultAgency(trimmedId);
      await this.database.insertRows('agency', [newAgency]);
      await this.patchManager?.recordInsert(
        'agency',
        trimmedId,
        newAgency as unknown as Record<string, unknown>
      );

      this.onEntityCreated();
      return true;
    } catch (error) {
      console.error('Error creating agency:', error);
      notify.error(
        `Failed to create agency: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return false;
    }
  }

  /**
   * Create a new service (calendar entry)
   */
  async createService(serviceId: string): Promise<boolean> {
    const trimmedId = serviceId.trim();

    if (!this.validateId(trimmedId, 'Service')) {
      return false;
    }

    try {
      // Check if service already exists
      const existing = await this.database.getRow('calendar', trimmedId);
      if (existing) {
        notify.error(`Service "${trimmedId}" already exists`);
        return false;
      }

      // Create new service with defaults
      const newService = createDefaultService(trimmedId);
      await this.database.insertRows('calendar', [newService]);
      await this.patchManager?.recordInsert(
        'calendar',
        trimmedId,
        newService as unknown as Record<string, unknown>
      );

      this.onEntityCreated();
      return true;
    } catch (error) {
      console.error('Error creating service:', error);
      notify.error(
        `Failed to create service: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return false;
    }
  }

  /**
   * Create a new route
   */
  async createRoute(routeId: string, agencyId?: string): Promise<boolean> {
    const trimmedId = routeId.trim();

    if (!this.validateId(trimmedId, 'Route')) {
      return false;
    }

    try {
      // Check if route already exists
      const existing = await this.database.getRow('routes', trimmedId);
      if (existing) {
        notify.error(`Route "${trimmedId}" already exists`);
        return false;
      }

      // If no agency_id provided, try to get the first agency
      let finalAgencyId = agencyId;
      if (!finalAgencyId) {
        const agencies = await this.database.getAllRows('agency');
        if (agencies.length > 0) {
          finalAgencyId = agencies[0].agency_id as string;
        }
      }

      // Create new route with defaults
      const newRoute = createDefaultRoute(trimmedId, finalAgencyId);
      await this.database.insertRows('routes', [newRoute]);
      await this.patchManager?.recordInsert(
        'routes',
        trimmedId,
        newRoute as unknown as Record<string, unknown>
      );

      this.onEntityCreated();
      return true;
    } catch (error) {
      console.error('Error creating route:', error);
      notify.error(
        `Failed to create route: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return false;
    }
  }
}
