/**
 * Info Display Module
 * Handles displaying object details in the Info tab
 */

import {
  getAgencyFieldDescription,
  getRouteFieldDescription,
  getCalendarFieldDescription,
  createTooltip,
} from '../utils/zod-tooltip-helper.js';

export class InfoDisplay {
  private relationships: {
    getAgencies: () => Record<string, unknown>[];
    getRoutesForAgency: (agency_id: string) => Record<string, unknown>[];
    getTripsForRoute: (route_id: string) => Record<string, unknown>[];
    getStopTimesForTrip: (trip_id: string) => Record<string, unknown>[];
    getStopById: (stop_id: string) => Record<string, unknown> | null;
    getTripsForStop: (stop_id: string) => Record<string, unknown>[];
    getStatistics: () => Record<string, unknown>;
    gtfsParser: {
      getFileDataSync: (filename: string) => Record<string, unknown>[];
    };
  };
  private container: HTMLElement | null;

  constructor(gtfsRelationships: {
    getAgencies: () => Record<string, unknown>[];
    getRoutesForAgency: (agency_id: string) => Record<string, unknown>[];
    getTripsForRoute: (route_id: string) => Record<string, unknown>[];
    getStopTimesForTrip: (trip_id: string) => Record<string, unknown>[];
    getStopById: (stop_id: string) => Record<string, unknown> | null;
    getTripsForStop: (stop_id: string) => Record<string, unknown>[];
    getStatistics: () => Record<string, unknown>;
    gtfsParser: {
      getFileDataSync: (filename: string) => Record<string, unknown>[];
    };
  }) {
    this.relationships = gtfsRelationships;
    this.container = null;
  }

  initialize(containerId = 'info-tab') {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`Info display container ${containerId} not found`);
      return;
    }
  }

  showAgencyDetails(agency_id: string) {
    const agencies = this.relationships.getAgencies();
    const agency = agencies.find(
      (a: Record<string, unknown>) => a.id === agency_id
    );

    if (!agency) {
      this.showError('Agency not found');
      return;
    }

    const routes = this.relationships.getRoutesForAgency(agency_id);

    if (!this.container) {
      return;
    }
    this.container.innerHTML = `
      <div class="p-4 overflow-y-auto h-full">
        <div class="mb-4">
          <h3 class="text-lg font-semibold text-slate-800 mb-2">Agency Details</h3>
          <div class="bg-slate-50 rounded-lg p-4">
            <h4 class="font-medium text-slate-800 mb-3">${this.escapeHtml(agency.name as string)}</h4>
            
            <div class="space-y-2 text-sm">
              <div>${createTooltip('<strong>ID:</strong>', getAgencyFieldDescription('agency_id'))} ${agency.id}</div>
              ${agency.url ? `<div>${createTooltip('<strong>Website:</strong>', getAgencyFieldDescription('agencyUrl'))} <a href="${agency.url}" target="_blank" class="text-info hover:underline">${agency.url}</a></div>` : ''}
              ${agency.timezone ? `<div>${createTooltip('<strong>Timezone:</strong>', getAgencyFieldDescription('agencyTimezone'))} ${agency.timezone}</div>` : ''}
              ${agency.lang ? `<div>${createTooltip('<strong>Language:</strong>', getAgencyFieldDescription('agencyLang'))} ${agency.lang}</div>` : ''}
              ${agency.phone ? `<div>${createTooltip('<strong>Phone:</strong>', getAgencyFieldDescription('agencyPhone'))} ${agency.phone}</div>` : ''}
              ${agency.email ? `<div>${createTooltip('<strong>Email:</strong>', getAgencyFieldDescription('agencyEmail'))} <a href="mailto:${agency.email}" class="text-info hover:underline">${agency.email}</a></div>` : ''}
            </div>
          </div>
        </div>
        
        <div>
          <h4 class="font-medium text-slate-800 mb-3">Routes (${routes.length})</h4>
          <div class="space-y-2">
            ${routes
              .map(
                (route: Record<string, unknown>) => `
              <div class="bg-white border border-slate-200 rounded p-3">
                <div class="font-medium text-slate-800">
                  ${route.shortName ? this.escapeHtml(route.shortName as string) + ' - ' : ''}${this.escapeHtml((route.longName || route.id) as string)}
                </div>
                <div class="text-sm text-slate-500">Route ID: ${route.id}</div>
                ${route.desc ? `<div class="text-xs text-slate-400 mt-1">${this.escapeHtml(route.desc as string)}</div>` : ''}
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      </div>
    `;
  }

  showRouteDetails(route_id: string) {
    const allRoutes =
      this.relationships.gtfsParser.getFileDataSync('routes.txt') || [];
    const route = allRoutes.find(
      (r: Record<string, unknown>) => r.route_id === route_id
    );

    if (!route) {
      this.showError('Route not found');
      return;
    }

    const trips = this.relationships.getTripsForRoute(route_id);
    const agencies = this.relationships.getAgencies();
    const agency = agencies.find(
      (a: Record<string, unknown>) => a.id === route.agency_id
    );

    if (!this.container) {
      return;
    }
    this.container.innerHTML = `
      <div class="p-4 overflow-y-auto h-full">
        <div class="mb-4">
          <h3 class="text-lg font-semibold text-slate-800 mb-2">Route Details</h3>
          <div class="bg-slate-50 rounded-lg p-4">
            <h4 class="font-medium text-slate-800 mb-3">
              ${route.route_short_name ? this.escapeHtml(route.route_short_name as string) + ' - ' : ''}${this.escapeHtml((route.route_long_name || route.route_id) as string)}
            </h4>

            <div class="space-y-2 text-sm">
              <div>${createTooltip('<strong>Route ID:</strong>', getRouteFieldDescription('route_id'))} ${route.route_id}</div>
              ${route.route_short_name ? `<div>${createTooltip('<strong>Short Name:</strong>', getRouteFieldDescription('routeShortName'))} ${this.escapeHtml(route.route_short_name as string)}</div>` : ''}
              ${route.route_long_name ? `<div>${createTooltip('<strong>Long Name:</strong>', getRouteFieldDescription('routeLongName'))} ${this.escapeHtml(route.route_long_name as string)}</div>` : ''}
              ${route.route_desc ? `<div>${createTooltip('<strong>Description:</strong>', getRouteFieldDescription('routeDesc'))} ${this.escapeHtml(route.route_desc as string)}</div>` : ''}
              <div>${createTooltip('<strong>Type:</strong>', getRouteFieldDescription('routeType'))} ${this.getRouteTypeText(route.route_type as number)}</div>
              ${agency ? `<div>${createTooltip('<strong>Agency:</strong>', getAgencyFieldDescription('agency_id'))} ${this.escapeHtml(agency.name as string)}</div>` : ''}
              ${route.route_color ? `<div>${createTooltip('<strong>Color:</strong>', getRouteFieldDescription('routeColor'))} <span style="background: #${route.route_color}; color: #${route.route_text_color || 'ffffff'};" class="px-2 py-1 rounded">#${route.route_color}</span></div>` : ''}
              ${route.route_url ? `<div>${createTooltip('<strong>URL:</strong>', getRouteFieldDescription('routeUrl'))} <a href="${route.route_url}" target="_blank" class="text-info hover:underline">${route.route_url}</a></div>` : ''}
            </div>
          </div>
        </div>
        
        <div>
          <h4 class="font-medium text-slate-800 mb-3">Trips (${trips.length})</h4>
          <div class="space-y-2 max-h-64 overflow-y-auto">
            ${trips
              .slice(0, 20)
              .map(
                (trip: Record<string, unknown>) => `
              <div class="bg-white border border-slate-200 rounded p-3">
                <div class="font-medium text-slate-800">${trip.id}</div>
                <div class="text-sm text-slate-500">Trip ID: ${trip.id}</div>
                <div class="text-xs text-slate-400">Service: ${trip.service_id}</div>
              </div>
            `
              )
              .join('')}
            ${trips.length > 20 ? `<div class="text-sm text-slate-500 text-center py-2">... and ${trips.length - 20} more trips</div>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  showTripDetails(trip_id: string) {
    const allTrips =
      this.relationships.gtfsParser.getFileDataSync('trips.txt') || [];
    const trip = allTrips.find(
      (t: Record<string, unknown>) => t.trip_id === trip_id
    );

    if (!trip) {
      this.showError('Trip not found');
      return;
    }

    const stopTimes = this.relationships.getStopTimesForTrip(trip_id);
    const allRoutes =
      this.relationships.gtfsParser.getFileDataSync('routes.txt') || [];
    const route = allRoutes.find(
      (r: Record<string, unknown>) => r.route_id === trip.route_id
    );

    if (!this.container) {
      return;
    }
    this.container.innerHTML = `
      <div class="p-4 overflow-y-auto h-full">
        <div class="mb-4">
          <h3 class="text-lg font-semibold text-slate-800 mb-2">Trip Details</h3>
          <div class="bg-slate-50 rounded-lg p-4">
            <h4 class="font-medium text-slate-800 mb-3">${trip.trip_id}</h4>
            
            <div class="space-y-2 text-sm">
              <div>${createTooltip('<strong>Trip ID:</strong>', 'Identifies a trip.')} ${trip.trip_id}</div>
              ${trip.trip_short_name ? `<div>${createTooltip('<strong>Short Name:</strong>', 'Short name of a trip.')} ${this.escapeHtml(trip.trip_short_name as string)}</div>` : ''}
              <div>${createTooltip('<strong>Route:</strong>', getRouteFieldDescription('route_id'))} ${route ? route.route_short_name || route.route_long_name || route.route_id : trip.route_id}</div>
              <div>${createTooltip('<strong>Service ID:</strong>', getCalendarFieldDescription('service_id'))} ${trip.service_id}</div>
              ${trip.direction_id ? `<div>${createTooltip('<strong>Direction:</strong>', 'Indicates the direction of travel for a trip.')} ${trip.direction_id}</div>` : ''}
              ${trip.block_id ? `<div>${createTooltip('<strong>Block ID:</strong>', 'Identifies the block to which the trip belongs.')} ${trip.block_id}</div>` : ''}
              ${trip.shape_id ? `<div>${createTooltip('<strong>Shape ID:</strong>', 'Identifies a geospatial shape that describes the vehicle travel path for a trip.')} ${trip.shape_id}</div>` : ''}
            </div>
          </div>
        </div>
        
        <div>
          <h4 class="font-medium text-slate-800 mb-3">Stop Times (${stopTimes.length})</h4>
          <div class="space-y-1 max-h-64 overflow-y-auto">
            ${stopTimes
              .map(
                (st: Record<string, unknown>, _index: number) => `
              <div class="bg-white border border-slate-200 rounded p-2 flex justify-between items-center">
                <div class="flex-1">
                  <div class="font-medium text-sm">${st.stop ? this.escapeHtml((st.stop as Record<string, unknown>).name as string) : st.stop_id}</div>
                  <div class="text-xs text-slate-500">Stop ${st.stop_sequence}: ${st.stop_id}</div>
                </div>
                <div class="text-right">
                  <div class="text-sm font-mono">${st.arrival_time}</div>
                  <div class="text-sm font-mono text-slate-500">${st.departure_time}</div>
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      </div>
    `;
  }

  showStopDetails(stop_id: string) {
    const stop = this.relationships.getStopById(stop_id);

    if (!stop) {
      this.showError('Stop not found');
      return;
    }

    const trips = this.relationships.getTripsForStop(stop_id);

    if (!this.container) {
      return;
    }
    this.container.innerHTML = `
      <div class="p-4 overflow-y-auto h-full">
        <div class="mb-4">
          <h3 class="text-lg font-semibold text-slate-800 mb-2">Stop Details</h3>
          <div class="bg-slate-50 rounded-lg p-4">
            <h4 class="font-medium text-slate-800 mb-3">${this.escapeHtml(stop.name as string)}</h4>

            <div class="space-y-2 text-sm">
              <div><strong>Stop ID:</strong> ${stop.id}</div>
              ${stop.code ? `<div><strong>Code:</strong> ${stop.code}</div>` : ''}
              ${stop.desc ? `<div><strong>Description:</strong> ${this.escapeHtml(stop.desc as string)}</div>` : ''}
              ${
                stop.lat && stop.lon
                  ? `
                <div><strong>Location:</strong> ${(stop.lat as number).toFixed(6)}, ${(stop.lon as number).toFixed(6)}</div>
                <div><strong>Coordinates:</strong>
                  <a href="https://www.openstreetmap.org/?mlat=${stop.lat}&mlon=${stop.lon}&zoom=18" target="_blank" class="text-info hover:underline">View on OpenStreetMap</a>
                </div>
              `
                  : ''
              }
              ${stop.zone_id ? `<div><strong>Zone ID:</strong> ${stop.zone_id}</div>` : ''}
              ${stop.url ? `<div><strong>URL:</strong> <a href="${stop.url}" target="_blank" class="text-info hover:underline">${stop.url}</a></div>` : ''}
              ${stop.locationType ? `<div><strong>Location Type:</strong> ${this.getLocationTypeText(stop.locationType as number)}</div>` : ''}
              ${stop.parent_station ? `<div><strong>Parent Station:</strong> ${stop.parent_station}</div>` : ''}
              ${stop.wheelchairBoarding ? `<div><strong>Wheelchair Boarding:</strong> ${this.getWheelchairText(stop.wheelchairBoarding as number)}</div>` : ''}
            </div>
          </div>
        </div>
        
        <div>
          <h4 class="font-medium text-slate-800 mb-3">Trips serving this stop (${trips.length})</h4>
          <div class="space-y-2 max-h-64 overflow-y-auto">
            ${trips
              .slice(0, 15)
              .map(
                (trip: Record<string, unknown>) => `
              <div class="bg-white border border-slate-200 rounded p-3">
                <div class="font-medium text-slate-800">${trip.id}</div>
                <div class="text-sm text-slate-500">Trip: ${trip.id} | Route: ${trip.route_id}</div>
              </div>
            `
              )
              .join('')}
            ${trips.length > 15 ? `<div class="text-sm text-slate-500 text-center py-2">... and ${trips.length - 15} more trips</div>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  showFeedStatistics(validationResults: Record<string, unknown> | null = null) {
    const stats = this.relationships.getStatistics() as {
      agencies: number;
      routes: number;
      trips: number;
      stops: number;
      stopTimes: number;
    };

    let validationSection = '';
    if (validationResults) {
      const { summary } = validationResults as {
        summary: {
          isValid: boolean;
          errorCount: number;
          warningCount: number;
          infoCount: number;
        };
      };
      const statusColor = summary.isValid
        ? 'green'
        : summary.errorCount > 0
          ? 'red'
          : 'yellow';
      const statusIcon = summary.isValid
        ? ''
        : summary.errorCount > 0
          ? ''
          : '';

      validationSection = `
        <div class="bg-${statusColor}-50 border border-${statusColor}-200 rounded-lg p-4 mb-6">
          <h4 class="font-medium text-${statusColor}-800 mb-3 flex items-center gap-2">
            ${statusIcon} Feed Validation
          </h4>
          <div class="stats shadow w-full">
            <div class="stat">
              <div class="stat-title">Errors</div>
              <div class="stat-value text-error">${summary.errorCount}</div>
            </div>
            <div class="stat">
              <div class="stat-title">Warnings</div>
              <div class="stat-value text-warning">${summary.warningCount}</div>
            </div>
            <div class="stat">
              <div class="stat-title">Info</div>
              <div class="stat-value text-info">${summary.infoCount}</div>
            </div>
          </div>
          <div class="mt-3 text-center">
            <button id="show-validation-details" class="btn btn-link btn-sm text-info">
              View Validation Details
            </button>
          </div>
        </div>
      `;
    }

    if (!this.container) {
      return;
    }
    this.container.innerHTML = `
      <div class="p-4 overflow-y-auto h-full">
        <h3 class="text-lg font-semibold text-slate-800 mb-4">Feed Overview</h3>
        
        ${validationSection}
        
        <div class="stats shadow w-full mb-6">
          <div class="stat">
            <div class="stat-title">Agencies</div>
            <div class="stat-value text-info">${stats.agencies}</div>
          </div>
          <div class="stat">
            <div class="stat-title">Routes</div>
            <div class="stat-value text-success">${stats.routes}</div>
          </div>
          <div class="stat">
            <div class="stat-title">Trips</div>
            <div class="stat-value text-secondary">${stats.trips}</div>
          </div>
          <div class="stat">
            <div class="stat-title">Stops</div>
            <div class="stat-value text-accent">${stats.stops}</div>
          </div>
        </div>
        
        <div class="bg-slate-50 rounded-lg p-4">
          <h4 class="font-medium text-slate-800 mb-3">Feed Quality</h4>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span>Total Stop Times:</span>
              <span class="font-medium">${stats.stopTimes.toLocaleString()}</span>
            </div>
            <div class="flex justify-between">
              <span>Avg. Trips per Route:</span>
              <span class="font-medium">${stats.routes > 0 ? Math.round(stats.trips / stats.routes) : 0}</span>
            </div>
            <div class="flex justify-between">
              <span>Avg. Stop Times per Trip:</span>
              <span class="font-medium">${stats.trips > 0 ? Math.round(stats.stopTimes / stats.trips) : 0}</span>
            </div>
          </div>
        </div>
      </div>
    `;

    // Add event listener for validation details
    if (validationResults) {
      const detailsBtn = document.getElementById('show-validation-details');
      if (detailsBtn) {
        detailsBtn.addEventListener('click', () => {
          this.showValidationDetails(validationResults);
        });
      }
    }
  }

  showValidationDetails(validationResults: Record<string, unknown>) {
    const { errors, warnings, info, summary } = validationResults as {
      errors: Record<string, unknown>[];
      warnings: Record<string, unknown>[];
      info: Record<string, unknown>[];
      summary: { errorCount: number; warningCount: number; infoCount: number };
    };

    const renderIssues = (
      issues: Record<string, unknown>[],
      type: string,
      icon: string,
      colorClass: string
    ) => {
      if (issues.length === 0) {
        return '';
      }

      return `
        <div class="mb-6">
          <h4 class="font-medium text-${colorClass}-800 mb-3 flex items-center gap-2">
            ${icon} ${type} (${issues.length})
          </h4>
          <div class="space-y-2 max-h-64 overflow-y-auto">
            ${issues
              .map(
                (issue: Record<string, unknown>) => `
              <div class="bg-${colorClass}-50 border border-${colorClass}-200 rounded p-3">
                <div class="font-medium text-${colorClass}-800">${this.escapeHtml(issue.message as string)}</div>
                <div class="text-sm text-${colorClass}-600 mt-1">
                  ${issue.fileName ? `File: ${issue.fileName}` : ''}
                  ${issue.rowNum ? ` | Row: ${issue.rowNum}` : ''}
                  ${issue.code ? ` | Code: ${issue.code}` : ''}
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      `;
    };

    if (!this.container) {
      return;
    }
    this.container.innerHTML = `
      <div class="p-4 overflow-y-auto h-full">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-slate-800">Validation Results</h3>
          <button id="back-to-overview" class="btn btn-link btn-sm text-info">
            &lt;- Back to Overview
          </button>
        </div>
        
        <div class="mb-6">
          <div class="grid grid-cols-3 gap-4 text-sm">
            <div class="bg-red-50 rounded-lg p-3 text-center">
              <div class="text-xl font-bold text-error">${summary.errorCount}</div>
              <div class="text-red-800">Errors</div>
            </div>
            <div class="bg-yellow-50 rounded-lg p-3 text-center">
              <div class="text-xl font-bold text-warning">${summary.warningCount}</div>
              <div class="text-yellow-800">Warnings</div>
            </div>
            <div class="bg-blue-50 rounded-lg p-3 text-center">
              <div class="text-xl font-bold text-info">${summary.infoCount}</div>
              <div class="text-blue-800">Info</div>
            </div>
          </div>
        </div>
        
        ${renderIssues(errors, 'Errors', '', 'red')}
        ${renderIssues(warnings, 'Warnings', '', 'yellow')}
        ${renderIssues(info, 'Information', 'ℹ️', 'blue')}
        
        ${
          errors.length === 0 && warnings.length === 0 && info.length === 0
            ? '<div class="text-center py-8 text-slate-500">No validation issues found.</div>'
            : ''
        }
      </div>
    `;

    // Add back button functionality
    const backBtn = document.getElementById('back-to-overview');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.showFeedStatistics(validationResults);
      });
    }
  }

  showError(message: string) {
    if (!this.container) {
      return;
    }
    this.container.innerHTML = `
      <div class="p-4 text-center">
        <div class="text-red-500 text-lg mb-2"></div>
        <div class="text-slate-700">${message}</div>
      </div>
    `;
  }

  clearDisplay() {
    if (this.container) {
      this.container.innerHTML = `
        <div class="p-4 overflow-y-auto h-full">
          <div class="text-slate-500 text-sm text-center py-8">
            Select an object to see details
          </div>
        </div>
      `;
    }
  }

  getRouteTypeText(routeType: number): string {
    const types: Record<number, string> = {
      0: 'Tram/Light Rail',
      1: 'Subway/Metro',
      2: 'Rail',
      3: 'Bus',
      4: 'Ferry',
      5: 'Cable Tram',
      6: 'Aerial Lift',
      7: 'Funicular',
      11: 'Trolleybus',
      12: 'Monorail',
    };
    return types[routeType] || `Unknown (${routeType})`;
  }

  getLocationTypeText(locationType: number): string {
    const types: Record<number, string> = {
      0: 'Stop/Platform',
      1: 'Station',
      2: 'Station Entrance/Exit',
      3: 'Generic Node',
      4: 'Boarding Area',
    };
    return types[locationType] || `Unknown (${locationType})`;
  }

  getWheelchairText(wheelchairBoarding: number): string {
    const values: Record<number, string> = {
      0: 'No information',
      1: 'Accessible',
      2: 'Not accessible',
    };
    return values[wheelchairBoarding] || `Unknown (${wheelchairBoarding})`;
  }

  escapeHtml(text: string) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
