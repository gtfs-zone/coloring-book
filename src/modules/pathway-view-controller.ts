import type { Pathways, Stops } from '../types/gtfs-entities';
import type { QueryOnlyDatabase } from '../utils/field-component';
import { renderInlineEntityFields } from '../utils/inline-editable-field';
import { GTFS_TABLES } from '../types/gtfs';
import { ENTITY_REF_BTN } from '../utils/entity-references';
import { getStopDisplay, renderOptionLabel } from '../utils/entity-display';
import { pathwayModeLabel } from '../utils/pathway-modes';
import { pageHeaderEyebrow } from './breadcrumb-trail';

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export interface PathwayViewDependencies {
  gtfsDatabase?: QueryOnlyDatabase;
  onDeletePathway: (pathway_id: string) => Promise<void>;
}

export class PathwayViewController {
  private dependencies: PathwayViewDependencies;

  constructor(dependencies: PathwayViewDependencies) {
    this.dependencies = dependencies;
  }

  async renderPathwayView(pathway_id: string): Promise<string> {
    console.log(
      '[PathwayViewController] Rendering pathway view for:',
      pathway_id
    );

    try {
      const pathway = await this.getPathwayData(pathway_id);
      if (!pathway) {
        return this.renderError('Pathway not found.');
      }

      const [fromStop, toStop] = await Promise.all([
        this.getStopData(pathway.from_stop_id),
        this.getStopData(pathway.to_stop_id),
      ]);

      const fieldsHtml = await renderInlineEntityFields(
        GTFS_TABLES.PATHWAYS,
        pathway as Record<string, string | number | undefined>,
        pathway_id
      );

      const modeLabel = pathwayModeLabel(Number(pathway.pathway_mode) || 1);

      return `
        <div class="p-4 space-y-4">
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold">Pathway: ${escapeAttr(modeLabel)}</h2>
              <button class="btn btn-sm btn-error btn-outline delete-pathway-btn" data-pathway-id="${escapeAttr(pathway_id)}">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
            <div class="card bg-base-100 shadow-lg">
              <div class="card-body p-4">
                ${this.renderEndpoints(pathway, fromStop, toStop)}
                <div class="divider my-2"></div>
                <div class="max-w-md">
                  ${fieldsHtml}
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    } catch (error) {
      console.error(
        '[PathwayViewController] Error rendering pathway view:',
        error
      );
      return this.renderError('Failed to load pathway information.');
    }
  }

  private renderEndpoints(
    pathway: Pathways,
    fromStop: Stops | null,
    toStop: Stops | null
  ): string {
    const renderCrumb = (
      typeLabel: string,
      stop_id: string,
      stop: Stops | null
    ): string => {
      const stopLabel = stop
        ? escapeAttr(
            renderOptionLabel(
              getStopDisplay(stop as unknown as Record<string, string>)
            )
          )
        : escapeAttr(stop_id);
      return `<button type="button" class="flex flex-col hover:underline text-left ${ENTITY_REF_BTN}" data-stop-id="${escapeAttr(stop_id)}">${pageHeaderEyebrow(typeLabel)}<span class="block leading-tight break-words">${stopLabel}</span></button>`;
    };

    return `
      <div class="flex flex-wrap items-start gap-x-2 gap-y-2 text-sm">
        ${renderCrumb('From', pathway.from_stop_id, fromStop)}
        <span aria-hidden="true" class="pt-4 opacity-40 select-none">/</span>
        ${renderCrumb('To', pathway.to_stop_id, toStop)}
      </div>
    `;
  }

  private async getPathwayData(pathway_id: string): Promise<Pathways | null> {
    if (!this.dependencies.gtfsDatabase) {
      return null;
    }
    try {
      const rows = await this.dependencies.gtfsDatabase.queryRows('pathways', {
        pathway_id,
      });
      return rows.length > 0 ? (rows[0] as Pathways) : null;
    } catch (error) {
      console.error('[PathwayViewController] Error fetching pathway:', error);
      return null;
    }
  }

  private async getStopData(stop_id: string): Promise<Stops | null> {
    if (!this.dependencies.gtfsDatabase) {
      return null;
    }
    try {
      const rows = await this.dependencies.gtfsDatabase.queryRows('stops', {
        stop_id,
      });
      return rows.length > 0 ? (rows[0] as Stops) : null;
    } catch {
      return null;
    }
  }

  addEventListeners(container: HTMLElement): void {
    // Delete pathway button
    container.querySelectorAll('.delete-pathway-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const pathway_id = btn.getAttribute('data-pathway-id');
        if (pathway_id) {
          await this.dependencies.onDeletePathway(pathway_id);
        }
      });
    });
  }

  private renderError(message: string): string {
    return `
      <div class="alert alert-error m-4">
        <span>${message}</span>
      </div>
    `;
  }
}
