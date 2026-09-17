/**
 * Browse page for one location group.
 *
 * A location group is a named bag of stops that flex stop_times reference in
 * place of a single stop, so the page is the group's own fields plus its member
 * list (location_group_stops.txt) and the routes whose trips reference it.
 */

import { GTFS_TABLES } from '../types/gtfs';
import { escapeHtml } from 'interlocking/util/escape-html';
import {
  getEntityDisplay,
  getRouteDisplay,
  getStopDisplay,
  renderCardLabel,
  renderOptionLabel,
} from '../utils/entity-display';
import { generateCompositeKeyFromRecord } from '../utils/gtfs-primary-keys';
import { renderInlineEntityFields } from '../utils/inline-editable-field';
import { showOptionPickerModal } from './option-picker-modal';

const MEMBER_ROW = 'location-group-member-row';
const MEMBER_REMOVE = 'location-group-member-remove';
const MEMBER_ADD = 'location-group-member-add';
const GROUP_ROUTE_ROW = 'location-group-route-row';

const GROUPS_STORE = 'location_groups';
const MEMBERS_STORE = 'location_group_stops';

export interface LocationGroupViewDependencies {
  gtfsDatabase: {
    queryRows: (
      tableName: string,
      filter?: Record<string, unknown>
    ) => Promise<unknown[]>;
    getAllRows: (tableName: string) => Promise<unknown[]>;
    insertRows: (tableName: string, rows: unknown[]) => Promise<void>;
    deleteRow?: (tableName: string, key: string) => Promise<void>;
  };
  patchManager?: {
    recordInsert: (
      table: string,
      id: string,
      record: Record<string, unknown>
    ) => Promise<void>;
    recordDelete: (
      table: string,
      id: string,
      record: Record<string, unknown>
    ) => Promise<void>;
  } | null;
  getTripsForLocationGroup?: (
    location_group_id: string
  ) => Array<Record<string, unknown>>;
  getRouteAsync?: (route_id: string) => Promise<unknown>;
  onStopClick?: (stop_id: string) => void;
  onRouteClick?: (route_id: string) => void;
  /** Re-render the page after a member is added or removed. */
  onMembersChanged?: (location_group_id: string) => void;
}

export class LocationGroupViewController {
  private dependencies: LocationGroupViewDependencies;

  constructor(dependencies: LocationGroupViewDependencies) {
    this.dependencies = dependencies;
  }

  async renderLocationGroupView(location_group_id: string): Promise<string> {
    console.log(
      '[LocationGroupViewController] Rendering location group view for:',
      location_group_id
    );

    try {
      const group = await this.getGroup(location_group_id);
      if (!group) {
        return this.renderError('Location group not found.');
      }

      const name =
        renderOptionLabel(
          getEntityDisplay(GROUPS_STORE, group as Record<string, string>)
        ) || location_group_id;

      const [fieldsHtml, membersHtml, routesHtml] = await Promise.all([
        renderInlineEntityFields(
          GTFS_TABLES.LOCATION_GROUPS,
          group as Record<string, string | number | undefined>,
          location_group_id
        ),
        this.renderMembers(location_group_id),
        this.renderRoutes(location_group_id),
      ]);

      return `
        <div class="p-4 space-y-4">
          <div>
            <h2 class="text-lg font-semibold">${escapeHtml(name)}</h2>
            <div class="badge badge-sm badge-outline mt-1">Location group</div>
          </div>
          <div class="card bg-base-100 shadow-lg">
            <div class="card-body p-4">
              <div class="max-w-md">${fieldsHtml}</div>
            </div>
          </div>
          <div class="card bg-base-100 shadow-lg">
            <div class="card-body p-4 space-y-2">
              <div class="flex items-center justify-between">
                <h3 class="font-semibold">Member stops</h3>
                <button class="btn btn-xs btn-ghost ${MEMBER_ADD}" data-location-group-id="${escapeHtml(location_group_id)}">+ Add stop...</button>
              </div>
              ${membersHtml}
            </div>
          </div>
          <div class="card bg-base-100 shadow-lg">
            <div class="card-body p-4 space-y-2">
              <h3 class="font-semibold">Routes serving this group</h3>
              ${routesHtml}
            </div>
          </div>
        </div>
      `;
    } catch (error) {
      console.error(
        '[LocationGroupViewController] Error rendering view:',
        error
      );
      return this.renderError('Failed to load location group information.');
    }
  }

  private async getGroup(
    location_group_id: string
  ): Promise<Record<string, unknown> | null> {
    const rows = (await this.dependencies.gtfsDatabase.queryRows(GROUPS_STORE, {
      location_group_id,
    })) as Record<string, unknown>[];
    return rows[0] ?? null;
  }

  /** The location_group_stops rows for this group. */
  private async getMemberRows(
    location_group_id: string
  ): Promise<Record<string, unknown>[]> {
    return (await this.dependencies.gtfsDatabase.queryRows(MEMBERS_STORE, {
      location_group_id,
    })) as Record<string, unknown>[];
  }

  private async renderMembers(location_group_id: string): Promise<string> {
    const members = await this.getMemberRows(location_group_id);
    if (members.length === 0) {
      return `<p class="text-sm opacity-60">No stops in this group yet.</p>`;
    }

    const rows: string[] = [];
    for (const member of members) {
      const stop_id = String(member.stop_id ?? '');
      const stopRows = (await this.dependencies.gtfsDatabase.queryRows(
        'stops',
        {
          stop_id,
        }
      )) as Record<string, string>[];
      const stop = stopRows[0];
      // A member pointing at a missing stop is a feed error: show it as one
      // rather than dropping the row and hiding the problem.
      const label = stop
        ? renderCardLabel(getStopDisplay(stop))
        : `<span class="font-mono text-error">${escapeHtml(stop_id)} (missing from stops.txt)</span>`;
      rows.push(`
        <div class="flex items-center gap-3 p-3 rounded-lg hover:bg-base-200 transition-colors ${MEMBER_ROW}" data-stop-id="${escapeHtml(stop_id)}">
          <div class="flex-1 min-w-0 cursor-pointer">${label}</div>
          <button class="btn btn-xs btn-ghost ${MEMBER_REMOVE}" data-location-group-id="${escapeHtml(location_group_id)}" data-stop-id="${escapeHtml(stop_id)}" title="Remove from group">x</button>
        </div>
      `);
    }
    return rows.join('');
  }

  private async renderRoutes(location_group_id: string): Promise<string> {
    const trips =
      this.dependencies.getTripsForLocationGroup?.(location_group_id) ?? [];
    if (trips.length === 0) {
      return `<p class="text-sm opacity-60">No stop_times reference this group.</p>`;
    }

    const counts = new Map<string, number>();
    for (const trip of trips) {
      const route_id = String(trip.route_id ?? '');
      if (route_id === '') {
        continue;
      }
      counts.set(route_id, (counts.get(route_id) ?? 0) + 1);
    }

    const rows: string[] = [];
    for (const [route_id, count] of counts) {
      const route = (await this.dependencies.getRouteAsync?.(route_id)) as
        | Record<string, string>
        | null
        | undefined;
      const label = route
        ? renderCardLabel(getRouteDisplay(route))
        : `<span class="font-mono">${escapeHtml(route_id)}</span>`;
      rows.push(`
        <div class="flex items-center gap-3 p-3 rounded-lg hover:bg-base-200 cursor-pointer transition-colors ${GROUP_ROUTE_ROW}" data-route-id="${escapeHtml(route_id)}">
          <div class="flex-1 min-w-0">${label}</div>
          <div class="badge badge-outline badge-sm">${count} trip${count !== 1 ? 's' : ''}</div>
        </div>
      `);
    }
    return rows.join('');
  }

  addEventListeners(container: HTMLElement): void {
    container.querySelectorAll(`.${MEMBER_ADD}`).forEach((btn) => {
      btn.addEventListener('click', () => {
        void this.addMember(btn.getAttribute('data-location-group-id') ?? '');
      });
    });

    container.querySelectorAll(`.${MEMBER_REMOVE}`).forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.removeMember(
          btn.getAttribute('data-location-group-id') ?? '',
          btn.getAttribute('data-stop-id') ?? ''
        );
      });
    });

    if (this.dependencies.onStopClick) {
      container.querySelectorAll(`.${MEMBER_ROW}`).forEach((row) => {
        row.addEventListener('click', () => {
          const stop_id = row.getAttribute('data-stop-id');
          if (stop_id) {
            this.dependencies.onStopClick!(stop_id);
          }
        });
      });
    }

    if (this.dependencies.onRouteClick) {
      container.querySelectorAll(`.${GROUP_ROUTE_ROW}`).forEach((row) => {
        row.addEventListener('click', () => {
          const route_id = row.getAttribute('data-route-id');
          if (route_id) {
            this.dependencies.onRouteClick!(route_id);
          }
        });
      });
    }
  }

  /** Add one stop to the group, recording the insert as a patch. */
  private async addMember(location_group_id: string): Promise<void> {
    if (location_group_id === '') {
      return;
    }
    const members = await this.getMemberRows(location_group_id);
    const assigned = new Set(members.map((m) => String(m.stop_id ?? '')));

    const stops = (await this.dependencies.gtfsDatabase.getAllRows(
      'stops'
    )) as Record<string, string>[];
    const options = stops
      .filter((stop) => !assigned.has(String(stop.stop_id ?? '')))
      .map((stop) => ({
        value: String(stop.stop_id ?? ''),
        primary: renderOptionLabel(getStopDisplay(stop)),
        secondary: String(stop.stop_id ?? ''),
      }));

    const stop_id = await showOptionPickerModal({
      title: 'Add stop to location group',
      options,
      searchable: true,
    });
    if (stop_id === null || stop_id === '') {
      return;
    }

    const record = { location_group_id, stop_id };
    const key = generateCompositeKeyFromRecord(MEMBERS_STORE, record);
    console.log(`[LocationGroups] add ${stop_id} to ${location_group_id}`);
    await this.dependencies.gtfsDatabase.insertRows(MEMBERS_STORE, [record]);
    await this.dependencies.patchManager?.recordInsert(
      MEMBERS_STORE,
      key,
      record
    );

    this.dependencies.onMembersChanged?.(location_group_id);
  }

  /** Remove one stop from the group, recording the delete as a patch. */
  private async removeMember(
    location_group_id: string,
    stop_id: string
  ): Promise<void> {
    if (location_group_id === '' || stop_id === '') {
      return;
    }
    if (!this.dependencies.gtfsDatabase.deleteRow) {
      console.warn('[LocationGroups] database cannot delete rows');
      return;
    }

    const rows = (await this.dependencies.gtfsDatabase.queryRows(
      MEMBERS_STORE,
      { location_group_id, stop_id }
    )) as Record<string, unknown>[];
    const record = rows[0];
    if (!record) {
      console.warn(
        `[LocationGroups] no location_group_stops row for ${stop_id} in ${location_group_id}`
      );
      return;
    }

    const key = generateCompositeKeyFromRecord(MEMBERS_STORE, record);
    console.log(`[LocationGroups] remove ${stop_id} from ${location_group_id}`);
    await this.dependencies.gtfsDatabase.deleteRow(MEMBERS_STORE, key);
    await this.dependencies.patchManager?.recordDelete(
      MEMBERS_STORE,
      key,
      record
    );

    this.dependencies.onMembersChanged?.(location_group_id);
  }

  private renderError(message: string): string {
    return `
      <div class="alert alert-error m-4">
        <span>${message}</span>
      </div>
    `;
  }
}
