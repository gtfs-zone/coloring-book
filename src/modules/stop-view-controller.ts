/**
 * Stop View Controller
 *
 * Comprehensive stop view implementation with inline editing and transit network relationships.
 * Provides a single-column layout showing stop properties and timetable relationships.
 */

import type { Routes, Stops, Trips, StopTimes, Pathways } from '../types/gtfs';
import type { QueryOnlyDatabase } from '../utils/field-component';
import { renderInlineEntityFields } from '../utils/inline-editable-field';
import { GTFS_TABLES } from '../types/gtfs';
import {
  getRouteDisplay,
  getStopDisplay,
  renderCardLabel,
  renderOptionLabel,
} from '../utils/entity-display';
import { escapeHtml } from 'interlocking/utils/escape-html';
import { routeColor } from 'interlocking/utils/route-colors';
import {
  filterServiceDataMap,
  loadServiceData,
  renderServiceTimeline,
  type ServiceDataMap,
} from './service-timeline';
import { pathwayModeLabel } from '../utils/pathway-modes';
import { renderTrashIcon } from 'interlocking/modules/modal-utils';
import {
  renderPathwayReference,
  renderStopReference,
} from '../utils/entity-references';
import { collectDescendantStops } from '../utils/stop-hierarchy';
import { renderStopAreasField } from '../utils/stop-areas-field';
import {
  renderEditableTable,
  installEditableTableHandlers,
  type EditableTableConfig,
  type EditableTableDeps,
} from './editable-table';
import { openModal } from './navigation-actions';
import { specStoreName } from '../utils/spec-field-edit';
import { validateTransferRow } from '../utils/fares-rules';

/** How many `via` stop names are spelled out before collapsing to "+N more". */
const MAX_VIA_LABELS = 3;

/** Editable-table instance id for the stop page's transfers section. */
const TRANSFERS_INSTANCE = 'stop-transfers';

/** Trip-to-trip transfer types: they name trips, not stops. */
const LINKED_TRIP_TYPES = new Set([4, 5]);

interface TimetableKey {
  route_id: string;
  service_id: string;
  /**
   * Descendant stops whose stop_times produced this timetable, when the page's
   * stop is a station. Empty when the stop itself carries the stop_times.
   */
  viaStops: Stops[];
  /** Trips of this route/service that actually call at this stop. */
  tripCount: number;
}

interface StopRelations {
  routes: Routes[];
  timetableKeys: TimetableKey[];
}

export interface StopViewDependencies {
  gtfsDatabase?: QueryOnlyDatabase;
  gtfsRelationships?: {
    getAgenciesServingStop?: (stop_id: string) => Promise<unknown[]>;
    getRoutesServingStop?: (stop_id: string) => Promise<unknown[]>;
  };
  /**
   * Writing handle for the transfers section, which edits rows rather than
   * only listing them. Absent, the section is skipped.
   */
  editableDeps?: EditableTableDeps;
  onStopClick?: (stop_id: string) => void;
  /** Light a stop on the map from a hovered row. Null clears. */
  onStopHover?: (stop_id: string | null) => void;
  /** Light one transfer edge on the map from a hovered row. Null clears. */
  onTransferHover?: (
    edge: { from_stop_id: string; to_stop_id: string } | null
  ) => void;
  onPathwayClick?: (pathway_id: string) => void;
  onDeleteStop: (stop_id: string) => Promise<void>;
  /** A transfer was added or removed: re-render the page. */
  onTransfersChanged?: () => void;
}

export class StopViewController {
  private dependencies: StopViewDependencies;
  private currentStopId: string | null = null;
  private deleteListenerAbortController: AbortController | null = null;

  constructor(dependencies: StopViewDependencies) {
    this.dependencies = dependencies;
  }

  async renderStopView(stop_id: string): Promise<string> {
    this.currentStopId = stop_id;
    console.log('StopViewController: Rendering stop view for:', stop_id);

    try {
      const stop = await this.getStopData(stop_id);
      if (!stop) {
        return this.renderError('Stop not found.');
      }

      const locationType =
        typeof stop.location_type === 'number'
          ? stop.location_type
          : parseInt(stop.location_type ?? '0', 10) || 0;
      const isStation = locationType === 1;

      const { routes, timetableKeys } = await this.fetchStopRelations(stop_id);

      // Loaded over the whole feed so a service keeps the same timeline color
      // here as on the home and route pages; scoped per route below.
      let serviceData: ServiceDataMap = new Map();
      if (this.dependencies.gtfsDatabase && timetableKeys.length > 0) {
        const db = this.dependencies.gtfsDatabase;
        serviceData = await loadServiceData({
          getAllRows: (tableName: string) =>
            db.queryRows(tableName) as Promise<Record<string, unknown>[]>,
        });
      }

      const [childStops, connectedPathways] = await Promise.all([
        isStation
          ? this.getChildStops(stop_id)
          : Promise.resolve([] as Stops[]),
        !isStation
          ? this.getConnectedPathways(stop_id)
          : Promise.resolve({ out: [] as Pathways[], in: [] as Pathways[] }),
      ]);

      // Build other-stop lookup and optional boarding-areas section for non-stations
      let boardingAreasHtml = '';
      const otherStopLookup = new Map<string, Stops>();
      if (!isStation) {
        const { out, in: inPathways } = connectedPathways as {
          out: Pathways[];
          in: Pathways[];
        };
        const otherStopIds = new Set<string>();
        for (const p of [...out, ...inPathways]) {
          otherStopIds.add(String(p.from_stop_id));
          otherStopIds.add(String(p.to_stop_id));
        }
        otherStopIds.delete(stop_id);
        if (this.dependencies.gtfsDatabase) {
          for (const sid of otherStopIds) {
            const rows = await this.dependencies.gtfsDatabase.queryRows(
              'stops',
              { stop_id: sid }
            );
            if (rows.length > 0) {
              otherStopLookup.set(sid, rows[0] as Stops);
            }
          }
        }
        if (locationType === 0) {
          boardingAreasHtml = await this.renderBoardingAreasSection(stop_id);
        }
      }

      const { out: outPathways, in: inPathways } = connectedPathways as {
        out: Pathways[];
        in: Pathways[];
      };

      const html = `
        <div class="p-4 space-y-4">
          ${await this.renderStopProperties(stop)}
          ${isStation ? this.renderChildStopsSections(childStops as Stops[]) : ''}
          ${!isStation ? boardingAreasHtml : ''}
          ${!isStation ? this.renderPathwaySection('Pathways Out', outPathways, 'to', otherStopLookup) : ''}
          ${!isStation ? this.renderPathwaySection('Pathways In', inPathways, 'from', otherStopLookup) : ''}
          ${await this.renderTransfersSection(stop_id)}
          ${this.renderTimetablesSection(timetableKeys, routes, serviceData)}
        </div>
      `;
      console.log('Stop view HTML length:', html.length);
      return html;
    } catch (error) {
      console.error('Error rendering stop view:', error);
      return this.renderError('Failed to load stop information.');
    }
  }

  private async renderStopProperties(stop: Stops): Promise<string> {
    const fieldsHtml = await renderInlineEntityFields(
      GTFS_TABLES.STOPS,
      stop as Record<string, string | number | undefined>,
      this.currentStopId ?? ''
    );
    // Area membership lives in stop_areas.txt, not on the stop, and a platform
    // may inherit it from its station, so it is not an ordinary property row.
    const areasHtml = await renderStopAreasField(
      stop as unknown as Record<string, unknown>
    );

    return `
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-2 min-w-0">
          <h2 class="text-lg font-semibold truncate">${renderCardLabel(getStopDisplay(stop as unknown as Record<string, string>))}</h2>
          <button class="btn btn-sm btn-error btn-outline delete-stop-btn shrink-0" data-stop-id="${stop.stop_id}" title="Delete">${renderTrashIcon()}</button>
        </div>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            <div class="max-w-md space-y-3">
              ${fieldsHtml}
              ${areasHtml}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderTimetablesSection(
    timetableKeys: TimetableKey[],
    routes: Routes[],
    serviceData: ServiceDataMap
  ): string {
    if (timetableKeys.length === 0) {
      return `
        <div class="space-y-4">
          <h2 class="text-lg font-semibold">Timetables</h2>
          <div class="card bg-base-100 shadow-lg">
            <div class="card-body p-4">
              <div class="text-center py-6 opacity-70">
                This stop is not included in any timetables.
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const routeById = new Map(routes.map((r) => [String(r.route_id), r]));

    // One timeline per route: a timeline carries a single route context, and
    // the stop is typically served by several routes.
    const byRoute = new Map<
      string,
      {
        service_ids: string[];
        viaStops: Map<string, Stops>;
        tripCounts: Map<string, number>;
      }
    >();
    for (const { route_id, service_id, viaStops, tripCount } of timetableKeys) {
      let entry = byRoute.get(route_id);
      if (!entry) {
        entry = {
          service_ids: [],
          viaStops: new Map(),
          tripCounts: new Map(),
        };
        byRoute.set(route_id, entry);
      }
      entry.service_ids.push(service_id);
      // Counted over trips calling at this stop, not the whole route.
      entry.tripCounts.set(
        service_id,
        (entry.tripCounts.get(service_id) ?? 0) + tripCount
      );
      for (const stop of viaStops) {
        entry.viaStops.set(String(stop.stop_id), stop);
      }
    }

    const sections = [...byRoute.entries()]
      .map(([route_id, { service_ids, viaStops, tripCounts }]) => {
        const route = (routeById.get(route_id) ?? { route_id }) as Record<
          string,
          unknown
        >;
        const color = routeColor(
          route_id,
          route.route_color as string | undefined
        );
        const via = [...viaStops.values()];
        const viaLine =
          via.length > 0
            ? `<div class="text-xs opacity-60 truncate">via ${escapeHtml(
                via
                  .slice(0, MAX_VIA_LABELS)
                  .map((s) =>
                    renderOptionLabel(
                      getStopDisplay(s as Record<string, string>)
                    )
                  )
                  .join(', ')
              )}${via.length > MAX_VIA_LABELS ? ` +${via.length - MAX_VIA_LABELS} more` : ''}</div>`
            : '';

        return `
          <div class="space-y-1">
            <div class="route-card flex items-center gap-2 min-w-0 w-fit max-w-full px-1 -mx-1 rounded cursor-pointer hover:bg-base-200 hover:underline" data-route-id="${escapeHtml(route_id)}" title="Open route">
              <div class="w-3 h-3 rounded-full flex-shrink-0" style="background-color: ${color}"></div>
              <span class="font-medium truncate">${renderCardLabel(getRouteDisplay(route as Record<string, string>))}</span>
            </div>
            ${viaLine}
            ${renderServiceTimeline(filterServiceDataMap(serviceData, service_ids), { route_id, tripCounts })}
          </div>
        `;
      })
      .join('');

    return `
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">Timetables</h2>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            <div class="space-y-4">
              ${sections}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private async getChildStops(station_id: string): Promise<Stops[]> {
    if (!this.dependencies.gtfsDatabase) {
      return [];
    }
    try {
      const rows = await this.dependencies.gtfsDatabase.queryRows('stops', {
        parent_station: station_id,
      });
      return rows as Stops[];
    } catch {
      return [];
    }
  }

  private async getConnectedPathways(
    stop_id: string
  ): Promise<{ out: Pathways[]; in: Pathways[] }> {
    if (!this.dependencies.gtfsDatabase) {
      return { out: [], in: [] };
    }
    try {
      const [fromRows, toRows] = await Promise.all([
        this.dependencies.gtfsDatabase.queryRows('pathways', {
          from_stop_id: stop_id,
        }),
        this.dependencies.gtfsDatabase.queryRows('pathways', {
          to_stop_id: stop_id,
        }),
      ]);
      return {
        out: fromRows as Pathways[],
        in: toRows as Pathways[],
      };
    } catch {
      return { out: [], in: [] };
    }
  }

  private renderPathwaySection(
    title: string,
    pathways: Pathways[],
    direction: 'to' | 'from',
    otherStopLookup: Map<string, Stops>
  ): string {
    if (pathways.length === 0) {
      return '';
    }
    const rows = pathways
      .map((p) => {
        const otherStopId =
          direction === 'to' ? String(p.to_stop_id) : String(p.from_stop_id);
        const modeLabel = pathwayModeLabel(Number(p.pathway_mode) || 0);
        const otherStop = otherStopLookup.get(otherStopId) as
          | Record<string, unknown>
          | undefined;
        return renderPathwayReference(p as unknown as Record<string, unknown>, {
          modeLabel,
          otherStop,
          otherStopId,
          direction,
          viewStopButton: true,
        });
      })
      .join('');
    return `
      <div class="space-y-2">
        <h3 class="text-base font-semibold">${title}</h3>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            <div class="space-y-1">${rows}</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * The transfers naming this stop, editable in place.
   *
   * Shown for stations too: a transfer on a station applies to all of its child
   * stops, so it is as much a property of the station as of a platform. Types 4
   * and 5 are left out because they link two trips rather than two stops; they
   * are counted in the note so the section does not look empty by accident.
   */
  private async renderTransfersSection(stop_id: string): Promise<string> {
    const deps = this.dependencies.editableDeps;
    if (!deps) {
      return '';
    }

    const all = await deps.gtfsDatabase.getAllRows(
      specStoreName(GTFS_TABLES.TRANSFERS)
    );
    const naming = all.filter(
      (row) =>
        String(row.from_stop_id ?? '') === stop_id ||
        String(row.to_stop_id ?? '') === stop_id
    );
    const rows = naming.filter(
      (row) => !LINKED_TRIP_TYPES.has(Number(row.transfer_type ?? 0) || 0)
    );
    const linkedTripCount = naming.length - rows.length;

    const config: EditableTableConfig = {
      instanceId: TRANSFERS_INSTANCE,
      tableName: GTFS_TABLES.TRANSFERS,
      rows,
      deps,
      emptyMessage:
        'No transfers name this stop. Add one to make a connection timed, to give it a minimum time, or to rule it out.',
      columnOverrides: {
        from_stop_id: { widthClass: 'min-w-48' },
        to_stop_id: { widthClass: 'min-w-48' },
      },
      validateRow: validateTransferRow,
      // Hovering a row lights the stop at the other end and its edge, the same
      // read as hovering a stop in the timetable's stop column.
      onRowHover: (row) => {
        if (!row) {
          this.dependencies.onStopHover?.(null);
          this.dependencies.onTransferHover?.(null);
          return;
        }
        const from = String(row.from_stop_id ?? '');
        const to = String(row.to_stop_id ?? '');
        this.dependencies.onStopHover?.(from === stop_id ? to : from);
        this.dependencies.onTransferHover?.({
          from_stop_id: from,
          to_stop_id: to,
        });
      },
      onInsert: () => this.dependencies.onTransfersChanged?.(),
      onDelete: () => this.dependencies.onTransfersChanged?.(),
      onRowsChanged: () => this.dependencies.onTransfersChanged?.(),
    };
    // The rows the pointer could be over are about to be replaced, and a
    // removed row never fires pointerout, so drop the highlight it was holding.
    this.dependencies.onStopHover?.(null);
    this.dependencies.onTransferHover?.(null);

    // Re-registered on every render of a stop page, so the handlers always hold
    // the rows on screen. The instance outlives the page, but its cells do not.
    installEditableTableHandlers(config);

    const linkedNote =
      linkedTripCount > 0
        ? `<p class="text-xs opacity-60">${linkedTripCount} in-seat transfer${linkedTripCount === 1 ? '' : 's'} (type 4 or 5) also name${linkedTripCount === 1 ? 's' : ''} this stop. Those link two trips rather than two stops, so they are edited in Feed Data.</p>`
        : '';

    return `
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-lg font-semibold">Transfers</h2>
          <button class="btn btn-xs btn-outline manage-transfers-btn">Manage all transfers</button>
        </div>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4 space-y-2">
            ${await renderEditableTable(config)}
            ${linkedNote}
          </div>
        </div>
      </div>
    `;
  }

  private async renderBoardingAreasSection(
    platformId: string
  ): Promise<string> {
    if (!this.dependencies.gtfsDatabase) {
      return '';
    }
    try {
      const rows = await this.dependencies.gtfsDatabase.queryRows('stops', {
        parent_station: platformId,
      });
      const boardingAreas = (rows as Stops[]).filter((s) => {
        const lt =
          typeof s.location_type === 'number'
            ? s.location_type
            : parseInt(s.location_type ?? '0', 10) || 0;
        return lt === 4;
      });
      if (boardingAreas.length === 0) {
        return '';
      }
      const rowsHtml = boardingAreas
        .map((ba) =>
          renderStopReference(ba as unknown as Record<string, unknown>)
        )
        .join('');
      return `
        <div class="space-y-2">
          <h3 class="text-base font-semibold">Boarding Areas</h3>
          <div class="card bg-base-100 shadow-lg">
            <div class="card-body p-4">
              <div class="space-y-1">${rowsHtml}</div>
            </div>
          </div>
        </div>
      `;
    } catch {
      return '';
    }
  }

  private groupChildrenByLocationType(children: Stops[]): {
    entrances: Stops[];
    platforms: Stops[];
    genericNodes: Stops[];
  } {
    const entrances: Stops[] = [];
    const platforms: Stops[] = [];
    const genericNodes: Stops[] = [];
    for (const child of children) {
      const locType =
        typeof child.location_type === 'number'
          ? child.location_type
          : parseInt(child.location_type ?? '0', 10) || 0;
      if (locType === 2) {
        entrances.push(child);
      } else if (locType === 0) {
        platforms.push(child);
      } else if (locType === 3) {
        genericNodes.push(child);
      }
      // locType === 4 (boarding areas) silently skipped, they belong under platforms
    }
    return { entrances, platforms, genericNodes };
  }

  private renderTypedChildSection(title: string, children: Stops[]): string {
    if (children.length === 0) {
      return '';
    }
    const rows = children
      .map((child) =>
        renderStopReference(child as unknown as Record<string, unknown>)
      )
      .join('');
    return `
      <div class="space-y-2">
        <h3 class="text-base font-semibold">${title}</h3>
        <div class="card bg-base-100 shadow-lg">
          <div class="card-body p-4">
            <div class="space-y-1">${rows}</div>
          </div>
        </div>
      </div>
    `;
  }

  private renderChildStopsSections(children: Stops[]): string {
    const { entrances, platforms, genericNodes } =
      this.groupChildrenByLocationType(children);
    const sections = [
      this.renderTypedChildSection('Entrances / Exits', entrances),
      this.renderTypedChildSection('Platforms', platforms),
      this.renderTypedChildSection('Generic Nodes', genericNodes),
    ]
      .filter(Boolean)
      .join('');

    if (!sections) {
      return `
        <div class="space-y-4">
          <h2 class="text-lg font-semibold">Child Stops</h2>
          <div class="card bg-base-100 shadow-lg">
            <div class="card-body p-4">
              <div class="text-center py-4 opacity-70">No child stops defined.</div>
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">Child Stops</h2>
        ${sections}
      </div>
    `;
  }

  private async getStopData(stop_id: string): Promise<Stops | null> {
    if (!this.dependencies.gtfsDatabase) {
      return { stop_id, stop_name: stop_id, parent_station: '' } as Stops;
    }

    try {
      const stops = await this.dependencies.gtfsDatabase.queryRows('stops', {
        stop_id,
      });
      if (stops.length === 0) {
        return null;
      }
      return stops[0] as Stops;
    } catch (error) {
      console.error('Error getting stop data:', error);
      return null;
    }
  }

  private async fetchStopRelations(stop_id: string): Promise<StopRelations> {
    if (!this.dependencies.gtfsDatabase) {
      return { routes: [], timetableKeys: [] };
    }

    try {
      // A station carries no stop_times of its own, so the lookup has to run
      // over its whole platform subtree or it looks like nothing serves it.
      const hierarchy = await collectDescendantStops(
        this.dependencies.gtfsDatabase,
        stop_id
      );
      const stopById = new Map(hierarchy.map((s) => [String(s.stop_id), s]));
      const lookupIds = stopById.has(stop_id)
        ? Array.from(stopById.keys())
        : [stop_id, ...stopById.keys()];

      // trip_id -> the descendant stop ids that put it here, so a station's
      // rows can say which platform they came from.
      const viaIdsByTrip = new Map<string, Set<string>>();
      for (const id of lookupIds) {
        const stopTimes = (await this.dependencies.gtfsDatabase.queryRows(
          'stop_times',
          { stop_id: id }
        )) as StopTimes[];
        for (const st of stopTimes) {
          const trip_id = String(st.trip_id);
          let via = viaIdsByTrip.get(trip_id);
          if (!via) {
            via = new Set();
            viaIdsByTrip.set(trip_id, via);
          }
          if (id !== stop_id) {
            via.add(id);
          }
        }
      }

      if (viaIdsByTrip.size === 0) {
        return { routes: [], timetableKeys: [] };
      }

      const allTrips = (await this.dependencies.gtfsDatabase.queryRows(
        'trips'
      )) as Trips[];
      const relevantTrips = allTrips.filter((trip) =>
        viaIdsByTrip.has(String(trip.trip_id))
      );

      const routeIdSet = new Set(relevantTrips.map((trip) => trip.route_id));
      const byKey = new Map<
        string,
        { key: TimetableKey; viaIds: Set<string> }
      >();
      for (const trip of relevantTrips) {
        const key = `${trip.route_id}||${trip.service_id}`;
        let entry = byKey.get(key);
        if (!entry) {
          entry = {
            key: {
              route_id: trip.route_id,
              service_id: trip.service_id,
              viaStops: [],
              tripCount: 0,
            },
            viaIds: new Set(),
          };
          byKey.set(key, entry);
        }
        entry.key.tripCount++;
        for (const id of viaIdsByTrip.get(String(trip.trip_id)) ?? []) {
          entry.viaIds.add(id);
        }
      }

      const timetableKeys: TimetableKey[] = [];
      for (const { key, viaIds } of byKey.values()) {
        key.viaStops = Array.from(viaIds)
          .map((id) => stopById.get(id))
          .filter((s): s is Stops => s !== undefined);
        timetableKeys.push(key);
      }

      const allRoutes = (await this.dependencies.gtfsDatabase.queryRows(
        'routes'
      )) as Routes[];
      const routes = allRoutes.filter((route) =>
        routeIdSet.has(route.route_id)
      );

      return { routes, timetableKeys };
    } catch (error) {
      console.error('Error fetching stop relations:', error);
      return { routes: [], timetableKeys: [] };
    }
  }

  addEventListeners(container: HTMLElement): void {
    // Delete stop button, use event delegation so clicks on the SVG child
    // element are caught correctly. Use an AbortController to prevent the
    // listener from accumulating across re-renders of the same container.
    if (this.deleteListenerAbortController) {
      this.deleteListenerAbortController.abort();
    }
    this.deleteListenerAbortController = new AbortController();
    container.addEventListener(
      'click',
      async (e) => {
        const btn = (e.target as Element).closest('.delete-stop-btn');
        if (btn) {
          console.log('[StopViewController] Delete button clicked');
          const stop_id = btn.getAttribute('data-stop-id');
          console.log('[StopViewController] stop_id from button:', stop_id);
          if (stop_id) {
            await this.dependencies.onDeleteStop(stop_id);
          }
          return;
        }

        const manageTransfers = (e.target as Element).closest(
          '.manage-transfers-btn'
        );
        if (manageTransfers) {
          await openModal(
            { type: 'feed_data', table: GTFS_TABLES.TRANSFERS },
            { onClosed: () => this.dependencies.onTransfersChanged?.() }
          );
          return;
        }
      },
      { signal: this.deleteListenerAbortController.signal }
    );
  }

  private renderError(message: string): string {
    return `
      <div class="alert alert-error m-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>${message}</span>
      </div>
    `;
  }
}
