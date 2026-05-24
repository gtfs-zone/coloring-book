/**
 * GTFS Breadcrumb Lookup Implementation
 *
 * Provides concrete implementations of breadcrumb lookup functions
 * using the GTFS database for object name resolution.
 */

import { BreadcrumbLookup } from './page-state-manager.js';
import { GTFSDatabase } from './gtfs-database.js';
import { getStopDisplay, renderOptionLabel } from '../utils/entity-display.js';

/**
 * GTFS-specific breadcrumb lookup implementation
 */
export class GTFSBreadcrumbLookup implements BreadcrumbLookup {
  private database: GTFSDatabase;

  constructor(database: GTFSDatabase) {
    this.database = database;
  }

  /**
   * Get agency name by ID
   */
  async getAgencyName(agency_id: string): Promise<string> {
    try {
      const agencies = await this.database.queryRows('agency', {
        agency_id: agency_id,
      });

      if (agencies.length > 0) {
        const agency = agencies[0];
        const name = (agency.agency_name as string) || `Agency ${agency_id}`;
        return name;
      }
    } catch (error) {
      console.warn(`Failed to lookup agency name for ID ${agency_id}:`, error);
    }

    // Fallback
    return `Agency ${agency_id}`;
  }

  /**
   * Get route name by ID
   */
  async getRouteName(route_id: string): Promise<string> {
    try {
      const routes = await this.database.queryRows('routes', {
        route_id: route_id,
      });

      if (routes.length > 0) {
        const route = routes[0];
        // Prefer route_short_name, then route_long_name, then route_id
        const name =
          (route.route_short_name as string) ||
          (route.route_long_name as string) ||
          `Route ${route_id}`;
        return name;
      }
    } catch (error) {
      console.warn(`Failed to lookup route name for ID ${route_id}:`, error);
    }

    // Fallback
    return `Route ${route_id}`;
  }

  /**
   * Get stop name by ID
   */
  async getStopName(stop_id: string): Promise<string> {
    try {
      const stops = await this.database.queryRows('stops', {
        stop_id: stop_id,
      });

      if (stops.length > 0) {
        return renderOptionLabel(
          getStopDisplay(stops[0] as Record<string, string>)
        );
      }
    } catch (error) {
      console.warn(`Failed to lookup stop name for ID ${stop_id}:`, error);
    }

    // Fallback
    return `Stop ${stop_id}`;
  }

  /**
   * Get the ancestor chain for a stop (outermost station first, excluding the stop itself).
   */
  async getStopAncestors(
    stop_id: string
  ): Promise<Array<{ stop_id: string; label: string }>> {
    const chain: Array<{ stop_id: string; label: string }> = [];
    try {
      let currentId = stop_id;
      for (let i = 0; i < 5; i++) {
        const rows = await this.database.queryRows('stops', {
          stop_id: currentId,
        });
        if (rows.length === 0) {
          break;
        }
        const row = rows[0];
        const parentId = row.parent_station as string | undefined;
        if (!parentId) {
          break;
        }
        const parentRows = await this.database.queryRows('stops', {
          stop_id: parentId,
        });
        if (parentRows.length === 0) {
          break;
        }
        const parent = parentRows[0];
        chain.push({
          stop_id: parentId,
          label: renderOptionLabel(
            getStopDisplay(parent as Record<string, string>)
          ),
        });
        currentId = parentId;
      }
      chain.reverse();
    } catch (error) {
      console.warn(
        `[GTFSBreadcrumbLookup] Failed to get ancestors for stop ${stop_id}:`,
        error
      );
    }
    return chain;
  }

  /**
   * Get the ancestor chain for a pathway (outermost station first, ending at from_stop).
   */
  async getPathwayAncestors(
    pathway_id: string
  ): Promise<Array<{ stop_id: string; label: string }>> {
    try {
      const pathwayRows = await this.database.queryRows('pathways', {
        pathway_id,
      });
      if (pathwayRows.length === 0) {
        return [];
      }
      const pathway = pathwayRows[0];
      const from_stop_id = pathway.from_stop_id as string | undefined;
      if (!from_stop_id) {
        return [];
      }

      const stopAncestors = await this.getStopAncestors(from_stop_id);
      const fromStopRows = await this.database.queryRows('stops', {
        stop_id: from_stop_id,
      });
      const fromStopLabel =
        fromStopRows.length > 0
          ? renderOptionLabel(
              getStopDisplay(fromStopRows[0] as Record<string, string>)
            )
          : `Stop ${from_stop_id}`;
      return [
        ...stopAncestors,
        { stop_id: from_stop_id, label: fromStopLabel },
      ];
    } catch (error) {
      console.warn(
        `[GTFSBreadcrumbLookup] Failed to get ancestors for pathway ${pathway_id}:`,
        error
      );
      return [];
    }
  }

  /**
   * No-op cache clearing method for compatibility
   */
  clearCache(): void {
    // No cache to clear - data is always loaded fresh from database
  }

  /**
   * No-op preload method for compatibility
   */
  async preloadCache(): Promise<void> {
    // No cache to preload - data is always loaded fresh from database
  }

  /**
   * Get agency ID for a route (needed for simplified navigation)
   */
  async getAgencyIdForRoute(route_id: string): Promise<string> {
    try {
      const routes = await this.database.queryRows('routes', {
        route_id: route_id,
      });

      if (routes.length > 0) {
        const route = routes[0];
        const agency_id = (route.agency_id as string) || 'default';
        return agency_id;
      }
    } catch (error) {
      console.warn(`Failed to lookup agency for route ID ${route_id}:`, error);
    }

    // Fallback
    return 'default';
  }

  /**
   * Get cache statistics for debugging (no-op since no cache)
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: 0,
      keys: [], // No cache, so no keys
    };
  }
}

/**
 * Create and configure a GTFS breadcrumb lookup instance
 */
export function createGTFSBreadcrumbLookup(
  database: GTFSDatabase
): GTFSBreadcrumbLookup {
  return new GTFSBreadcrumbLookup(database);
}
