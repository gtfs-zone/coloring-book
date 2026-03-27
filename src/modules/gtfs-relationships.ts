/**
 * GTFS Relationships Module
 * Handles hierarchical navigation through GTFS data
 * Agency → Routes → Trips → Stop Times → Stops
 */

import { GTFSDatabase, GTFSDatabaseRecord } from './gtfs-database.js';

interface GTFSParserInterface {
  getFileDataSync: (filename: string) => GTFSDatabaseRecord[];
  gtfsDatabase: GTFSDatabase;
  searchStops: (query: string) => GTFSDatabaseRecord[];
  searchRoutes: (query: string) => GTFSDatabaseRecord[];
  searchAll: (query: string) => {
    stops: GTFSDatabaseRecord[];
    routes: GTFSDatabaseRecord[];
  };
}

export class GTFSRelationships {
  public gtfsParser: GTFSParserInterface;
  private gtfsDatabase: GTFSDatabase;

  constructor(gtfsParser: GTFSParserInterface) {
    this.gtfsParser = gtfsParser;
    this.gtfsDatabase = gtfsParser.gtfsDatabase;
  }

  /**
   * Get all agencies in the GTFS feed
   */
  getAgencies() {
    const agencyData = this.gtfsParser.getFileDataSync('agency.txt');
    return agencyData.map((agency) => ({
      id: agency.agency_id,
      agency_id: agency.agency_id,
      name: agency.agency_name || `Agency ${agency.agency_id}`,
      agency_name: agency.agency_name || `Agency ${agency.agency_id}`,
      url: agency.agency_url,
      timezone: agency.agency_timezone,
      lang: agency.agency_lang,
      phone: agency.agency_phone,
      fare_url: agency.agency_fare_url,
      email: agency.agency_email,
    }));
  }

  /**
   * Get all routes for a specific agency
   */
  getRoutesForAgency(agency_id: string) {
    const routesData = this.gtfsParser.getFileDataSync('routes.txt');
    return routesData
      .filter((route) => route.agency_id === agency_id)
      .map((route) => ({
        id: route.route_id,
        route_id: route.route_id,
        agency_id: route.agency_id,
        shortName: route.route_short_name,
        route_short_name: route.route_short_name,
        longName: route.route_long_name,
        route_long_name: route.route_long_name,
        desc: route.route_desc,
        route_desc: route.route_desc,
        type: route.route_type,
        route_type: route.route_type,
        url: route.route_url,
        route_url: route.route_url,
        color: route.route_color,
        route_color: route.route_color,
        textColor: route.route_text_color,
        route_text_color: route.route_text_color,
        sortOrder: route.route_sort_order,
        route_sort_order: route.route_sort_order,
      }));
  }

  /**
   * Get all trips for a specific route
   */
  getTripsForRoute(route_id: string) {
    const tripsData = this.gtfsParser.getFileDataSync('trips.txt');
    return tripsData
      .filter((trip) => trip.route_id === route_id)
      .map((trip) => ({
        id: trip.trip_id,
        trip_id: trip.trip_id,
        route_id: trip.route_id,
        service_id: trip.service_id,
        headsign: trip.trip_headsign,
        trip_headsign: trip.trip_headsign,
        shortName: trip.trip_short_name,
        trip_short_name: trip.trip_short_name,
        direction_id: trip.direction_id,
        block_id: trip.block_id,
        shape_id: trip.shape_id,
        wheelchairAccessible: trip.wheelchair_accessible,
        bikesAllowed: trip.bikes_allowed,
      }));
  }

  /**
   * Get stop times for a specific trip
   */
  getStopTimesForTrip(trip_id: string) {
    const stopTimesData = this.gtfsParser.getFileDataSync('stop_times.txt');
    const stopTimes = stopTimesData
      .filter((stopTime) => stopTime.trip_id === trip_id)
      .sort((a, b) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence))
      .map((stopTime) => ({
        trip_id: stopTime.trip_id,
        stop_id: stopTime.stop_id,
        stop_sequence: parseInt(stopTime.stop_sequence),
        arrival_time: stopTime.arrival_time,
        departure_time: stopTime.departure_time,
        stopHeadsign: stopTime.stop_headsign,
        pickupType: stopTime.pickup_type,
        dropOffType: stopTime.drop_off_type,
        continuousPickup: stopTime.continuous_pickup,
        continuousDropOff: stopTime.continuous_drop_off,
        shapeDistTraveled: stopTime.shape_dist_traveled,
        timepoint: stopTime.timepoint,
      }));

    // Enrich with stop information
    return this.enrichStopTimesWithStops(stopTimes);
  }

  /**
   * Get stop details by stop ID
   */
  getStopById(stop_id: string) {
    const stopsData = this.gtfsParser.getFileDataSync('stops.txt');
    const stop = stopsData.find((stop) => stop.stop_id === stop_id);
    if (!stop) {
      return null;
    }

    return {
      stop_id: stop.stop_id,
      stop_name: stop.stop_name,
      stop_code: stop.stop_code,
      stop_desc: stop.stop_desc,
      stop_lat: parseFloat(stop.stop_lat),
      stop_lon: parseFloat(stop.stop_lon),
      zone_id: stop.zone_id,
      stop_url: stop.stop_url,
      location_type: stop.location_type,
      parent_station: stop.parent_station,
      stop_timezone: stop.stop_timezone,
      wheelchair_boarding: stop.wheelchair_boarding,
      level_id: stop.level_id,
      platform_code: stop.platform_code,
    };
  }

  /**
   * Get all trips that serve a specific stop
   */
  getTripsForStop(stop_id: string) {
    const stopTimesData = this.gtfsParser.getFileDataSync('stop_times.txt');
    const trip_ids = [
      ...new Set(
        stopTimesData
          .filter((stopTime) => stopTime.stop_id === stop_id)
          .map((stopTime) => stopTime.trip_id)
      ),
    ];

    const tripsData = this.gtfsParser.getFileDataSync('trips.txt');
    return tripsData
      .filter((trip) => trip_ids.includes(trip.trip_id))
      .map((trip) => ({
        id: trip.trip_id,
        route_id: trip.route_id,
        service_id: trip.service_id,
        headsign: trip.trip_headsign,
        shortName: trip.trip_short_name,
        direction_id: trip.direction_id,
        block_id: trip.block_id,
        shape_id: trip.shape_id,
      }));
  }

  /**
   * Get calendar information for a service ID
   */
  getCalendarForService(service_id: string) {
    const calendarData = this.gtfsParser.getFileDataSync('calendar.txt');
    const calendar = calendarData.find((cal) => cal.service_id === service_id);
    if (!calendar) {
      return null;
    }

    return {
      service_id: calendar.service_id,
      monday: calendar.monday === '1',
      tuesday: calendar.tuesday === '1',
      wednesday: calendar.wednesday === '1',
      thursday: calendar.thursday === '1',
      friday: calendar.friday === '1',
      saturday: calendar.saturday === '1',
      sunday: calendar.sunday === '1',
      start_date: calendar.start_date,
      end_date: calendar.end_date,
    };
  }

  /**
   * Get calendar exceptions for a service ID
   */
  getCalendarDatesForService(service_id: string) {
    const calendarDatesData =
      this.gtfsParser.getFileDataSync('calendar_dates.txt');
    return calendarDatesData
      .filter((calDate) => calDate.service_id === service_id)
      .map((calDate) => ({
        service_id: calDate.service_id,
        date: calDate.date,
        exceptionType: parseInt(calDate.exception_type),
      }));
  }

  /**
   * Enrich stop times with stop information
   */
  enrichStopTimesWithStops(stopTimes: Record<string, unknown>[]) {
    return stopTimes.map((stopTime: Record<string, unknown>) => {
      const stop = this.getStopById(stopTime.stop_id);
      return {
        ...stopTime,
        stop: stop,
      };
    });
  }

  /**
   * Get statistics for the GTFS feed
   */
  getStatistics() {
    const agencies = this.getAgencies();
    const routesData = this.gtfsParser.getFileDataSync('routes.txt');
    const tripsData = this.gtfsParser.getFileDataSync('trips.txt');
    const stopsData = this.gtfsParser.getFileDataSync('stops.txt');
    const stopTimesData = this.gtfsParser.getFileDataSync('stop_times.txt');

    return {
      agencies: agencies.length,
      routes: routesData.length,
      trips: tripsData.length,
      stops: stopsData.length,
      stopTimes: stopTimesData.length,
    };
  }

  /**
   * Get unique service IDs for a specific route
   */
  getServicesForRoute(route_id: string) {
    const trips = this.getTripsForRoute(route_id);
    const service_ids = [...new Set(trips.map((trip) => trip.service_id))];

    return service_ids.map((service_id) => {
      const calendar = this.getCalendarForService(service_id);
      return {
        service_id,
        calendar,
        tripCount: trips.filter((trip) => trip.service_id === service_id)
          .length,
      };
    });
  }

  /**
   * Get services for a route grouped by direction
   */
  getServicesForRouteByDirection(route_id: string) {
    const trips = this.getTripsForRoute(route_id);

    // Group services by direction_id
    const directionGroups = new Map();

    trips.forEach((trip) => {
      const direction_id = trip.direction_id || '0'; // Default to 0 if not specified
      const key = `${trip.service_id}_${direction_id}`;

      if (!directionGroups.has(key)) {
        directionGroups.set(key, {
          service_id: trip.service_id,
          direction_id: direction_id,
          trips: [],
        });
      }

      directionGroups.get(key).trips.push(trip);
    });

    // Convert to array and add additional service information
    return Array.from(directionGroups.values()).map((group) => {
      const calendar = this.getCalendarForService(group.service_id);
      return {
        service_id: group.service_id,
        direction_id: group.direction_id,
        calendar,
        tripCount: group.trips.length,
        directionName: this.getDirectionName(group.direction_id, group.trips),
      };
    });
  }

  /**
   * Get a human-readable direction name
   */
  private getDirectionName(
    direction_id: string,
    trips: Record<string, unknown>[]
  ): string {
    // Try to get direction name from trip headsigns
    const headsigns = [
      ...new Set(trips.map((trip) => trip.headsign).filter(Boolean)),
    ];

    if (headsigns.length === 1) {
      return headsigns[0];
    } else if (headsigns.length > 1) {
      return headsigns.join(' / ');
    }

    // Fallback to standard direction names
    switch (direction_id) {
      case '0':
        return 'Outbound';
      case '1':
        return 'Inbound';
      default:
        return `Direction ${direction_id}`;
    }
  }

  /**
   * Get route by ID
   */
  getRouteById(route_id: string) {
    const routesData = this.gtfsParser.getFileDataSync('routes.txt');
    if (!routesData || !Array.isArray(routesData)) {
      return null;
    }

    const route = routesData.find((route) => route.route_id === route_id);
    if (!route) {
      return null;
    }

    return {
      id: route.route_id,
      agency_id: route.agency_id,
      shortName: route.route_short_name,
      longName: route.route_long_name,
      desc: route.route_desc,
      type: route.route_type,
      url: route.route_url,
      color: route.route_color,
      textColor: route.route_text_color,
      sortOrder: route.route_sort_order,
    };
  }

  /**
   * Get trip by ID
   */
  getTripById(trip_id: string) {
    const tripsData = this.gtfsParser.getFileDataSync('trips.txt');
    if (!tripsData || !Array.isArray(tripsData)) {
      return null;
    }

    const trip = tripsData.find((trip) => trip.trip_id === trip_id);
    if (!trip) {
      return null;
    }

    return {
      id: trip.trip_id,
      route_id: trip.route_id,
      service_id: trip.service_id,
      headsign: trip.trip_headsign,
      shortName: trip.trip_short_name,
      direction_id: trip.direction_id,
      block_id: trip.block_id,
      shape_id: trip.shape_id,
      wheelchairAccessible: trip.wheelchair_accessible,
      bikesAllowed: trip.bikes_allowed,
    };
  }

  // ========== ASYNC INDEXEDDB METHODS ==========

  /**
   * Get all agencies in the GTFS feed (async)
   */
  async getAgenciesAsync() {
    try {
      const agencyData = await this.gtfsDatabase.getAllRows('agency');
      if (!agencyData || !Array.isArray(agencyData)) {
        return [];
      }
      return agencyData.map((agency) => ({
        id: agency.agency_id,
        agency_id: agency.agency_id,
        name: agency.agency_name || `Agency ${agency.agency_id}`,
        agency_name: agency.agency_name || `Agency ${agency.agency_id}`,
        url: agency.agency_url,
        timezone: agency.agency_timezone,
        lang: agency.agency_lang,
        phone: agency.agency_phone,
        fare_url: agency.agency_fare_url,
        email: agency.agency_email,
      }));
    } catch (error) {
      console.error('Error getting agencies from IndexedDB:', error);
      // Fallback to sync method
      return this.getAgencies();
    }
  }

  /**
   * Get all routes for a specific agency (async)
   */
  async getRoutesForAgencyAsync(agency_id: string) {
    try {
      const routesData = await this.gtfsDatabase.queryRows('routes', {
        agency_id: agency_id,
      });
      if (!routesData || !Array.isArray(routesData)) {
        return [];
      }

      return routesData.map((route) => ({
        id: route.route_id,
        route_id: route.route_id,
        agency_id: route.agency_id,
        shortName: route.route_short_name,
        route_short_name: route.route_short_name,
        longName: route.route_long_name,
        route_long_name: route.route_long_name,
        desc: route.route_desc,
        route_desc: route.route_desc,
        type: route.route_type,
        route_type: route.route_type,
        url: route.route_url,
        route_url: route.route_url,
        color: route.route_color,
        route_color: route.route_color,
        textColor: route.route_text_color,
        route_text_color: route.route_text_color,
        sortOrder: route.route_sort_order,
        route_sort_order: route.route_sort_order,
      }));
    } catch (error) {
      console.error('Error getting routes for agency from IndexedDB:', error);
      // Fallback to sync method
      return this.getRoutesForAgency(agency_id);
    }
  }

  /**
   * Get all trips for a specific route (async)
   */
  async getTripsForRouteAsync(route_id: string) {
    try {
      const tripsData = await this.gtfsDatabase.queryRows('trips', {
        route_id: route_id,
      });
      if (!tripsData || !Array.isArray(tripsData)) {
        return [];
      }

      return tripsData.map((trip) => ({
        id: trip.trip_id,
        trip_id: trip.trip_id,
        route_id: trip.route_id,
        service_id: trip.service_id,
        headsign: trip.trip_headsign,
        trip_headsign: trip.trip_headsign,
        shortName: trip.trip_short_name,
        trip_short_name: trip.trip_short_name,
        direction_id: trip.direction_id,
        block_id: trip.block_id,
        shape_id: trip.shape_id,
        wheelchairAccessible: trip.wheelchair_accessible,
        bikesAllowed: trip.bikes_allowed,
      }));
    } catch (error) {
      console.error('Error getting trips for route from IndexedDB:', error);
      // Fallback to sync method
      return this.getTripsForRoute(route_id);
    }
  }

  /**
   * Get stop times for a specific trip (async)
   */
  async getStopTimesForTripAsync(trip_id: string) {
    try {
      const stopTimesData = await this.gtfsDatabase.queryRows('stop_times', {
        trip_id: trip_id,
      });
      if (!stopTimesData || !Array.isArray(stopTimesData)) {
        return [];
      }

      const stopTimes = stopTimesData
        .sort((a, b) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence))
        .map((stopTime) => ({
          trip_id: stopTime.trip_id,
          stop_id: stopTime.stop_id,
          stop_sequence: parseInt(stopTime.stop_sequence),
          arrival_time: stopTime.arrival_time,
          departure_time: stopTime.departure_time,
          stopHeadsign: stopTime.stop_headsign,
          pickupType: stopTime.pickup_type,
          dropOffType: stopTime.drop_off_type,
          continuousPickup: stopTime.continuous_pickup,
          continuousDropOff: stopTime.continuous_drop_off,
          shapeDistTraveled: stopTime.shape_dist_traveled,
          timepoint: stopTime.timepoint,
        }));

      // Enrich with stop information
      return await this.enrichStopTimesWithStopsAsync(stopTimes);
    } catch (error) {
      console.error('Error getting stop times for trip from IndexedDB:', error);
      // Fallback to sync method
      return this.getStopTimesForTrip(trip_id);
    }
  }

  /**
   * Get stop details by stop ID (async)
   */
  async getStopByIdAsync(stop_id: string) {
    try {
      const stopsData = await this.gtfsDatabase.queryRows('stops', {
        stop_id: stop_id,
      });
      if (!stopsData || !Array.isArray(stopsData) || stopsData.length === 0) {
        return null;
      }

      const stop = stopsData[0];
      return {
        stop_id: stop.stop_id,
        stop_name: stop.stop_name,
        stop_code: stop.stop_code,
        stop_desc: stop.stop_desc,
        stop_lat: parseFloat(stop.stop_lat),
        stop_lon: parseFloat(stop.stop_lon),
        zone_id: stop.zone_id,
        stop_url: stop.stop_url,
        location_type: stop.location_type,
        parent_station: stop.parent_station,
        stop_timezone: stop.stop_timezone,
        wheelchair_boarding: stop.wheelchair_boarding,
        level_id: stop.level_id,
        platform_code: stop.platform_code,
      };
    } catch (error) {
      console.error('Error getting stop by ID from IndexedDB:', error);
      throw new Error(`Failed to get stop ${stop_id} from database: ${error}`);
    }
  }

  /**
   * Get all trips that serve a specific stop (async)
   */
  async getTripsForStopAsync(stop_id: string) {
    try {
      const stopTimesData = await this.gtfsDatabase.queryRows('stop_times', {
        stop_id: stop_id,
      });
      if (!stopTimesData || !Array.isArray(stopTimesData)) {
        return [];
      }

      const trip_ids = [
        ...new Set(stopTimesData.map((stopTime) => stopTime.trip_id)),
      ];

      const tripsData = await this.gtfsDatabase.getAllRows('trips');
      if (!tripsData || !Array.isArray(tripsData)) {
        return [];
      }

      return tripsData
        .filter((trip) => trip_ids.includes(trip.trip_id))
        .map((trip) => ({
          id: trip.trip_id,
          route_id: trip.route_id,
          service_id: trip.service_id,
          headsign: trip.trip_headsign,
          shortName: trip.trip_short_name,
          direction_id: trip.direction_id,
          block_id: trip.block_id,
          shape_id: trip.shape_id,
        }));
    } catch (error) {
      console.error('Error getting trips for stop from IndexedDB:', error);
      // Fallback to sync method
      return this.getTripsForStop(stop_id);
    }
  }

  /**
   * Get calendar information for a service ID (async)
   */
  async getCalendarForServiceAsync(service_id: string) {
    try {
      const calendarData = await this.gtfsDatabase.queryRows('calendar', {
        service_id: service_id,
      });
      if (
        !calendarData ||
        !Array.isArray(calendarData) ||
        calendarData.length === 0
      ) {
        return null;
      }

      const calendar = calendarData[0];
      return {
        service_id: calendar.service_id,
        monday: calendar.monday === '1',
        tuesday: calendar.tuesday === '1',
        wednesday: calendar.wednesday === '1',
        thursday: calendar.thursday === '1',
        friday: calendar.friday === '1',
        saturday: calendar.saturday === '1',
        sunday: calendar.sunday === '1',
        start_date: calendar.start_date,
        end_date: calendar.end_date,
      };
    } catch (error) {
      console.error(
        'Error getting calendar for service from IndexedDB:',
        error
      );
      // Fallback to sync method
      return this.getCalendarForService(service_id);
    }
  }

  /**
   * Get calendar exceptions for a service ID (async)
   */
  async getCalendarDatesForServiceAsync(service_id: string) {
    try {
      const calendarDatesData = await this.gtfsDatabase.queryRows(
        'calendar_dates',
        { service_id: service_id }
      );
      if (!calendarDatesData || !Array.isArray(calendarDatesData)) {
        return [];
      }

      return calendarDatesData.map((calDate) => ({
        service_id: calDate.service_id,
        date: calDate.date,
        exceptionType: parseInt(calDate.exception_type),
      }));
    } catch (error) {
      console.error(
        'Error getting calendar dates for service from IndexedDB:',
        error
      );
      // Fallback to sync method
      return this.getCalendarDatesForService(service_id);
    }
  }

  /**
   * Enrich stop times with stop information (async)
   */
  async enrichStopTimesWithStopsAsync(stopTimes: Record<string, unknown>[]) {
    try {
      const enrichedStopTimes = await Promise.all(
        stopTimes.map(async (stopTime: Record<string, unknown>) => {
          const stop = await this.getStopByIdAsync(stopTime.stop_id);
          return {
            ...stopTime,
            stop: stop,
          };
        })
      );
      return enrichedStopTimes;
    } catch (error) {
      console.error(
        'Error enriching stop times with stops from IndexedDB:',
        error
      );
      // Fallback to sync method
      return this.enrichStopTimesWithStops(stopTimes);
    }
  }

  /**
   * Get unique service IDs for a specific route (async)
   */
  async getServicesForRouteAsync(route_id: string) {
    try {
      const trips = await this.getTripsForRouteAsync(route_id);
      const service_ids = [...new Set(trips.map((trip) => trip.service_id))];

      const services = await Promise.all(
        service_ids.map(async (service_id) => {
          const calendar = await this.getCalendarForServiceAsync(service_id);
          return {
            service_id,
            calendar,
            tripCount: trips.filter((trip) => trip.service_id === service_id)
              .length,
          };
        })
      );

      return services;
    } catch (error) {
      console.error('Error getting services for route from IndexedDB:', error);
      // Fallback to sync method
      return this.getServicesForRoute(route_id);
    }
  }

  /**
   * Get services for a route grouped by direction (async)
   */
  async getServicesForRouteByDirectionAsync(route_id: string) {
    try {
      const trips = await this.getTripsForRouteAsync(route_id);

      // Group services by direction_id
      const directionGroups = new Map();

      trips.forEach((trip) => {
        const direction_id = trip.direction_id || '0'; // Default to 0 if not specified
        const key = `${trip.service_id}_${direction_id}`;

        if (!directionGroups.has(key)) {
          directionGroups.set(key, {
            service_id: trip.service_id,
            direction_id: direction_id,
            trips: [],
          });
        }

        directionGroups.get(key).trips.push(trip);
      });

      // Convert to array and add additional service information
      const services = await Promise.all(
        Array.from(directionGroups.values()).map(async (group) => {
          const calendar = await this.getCalendarForServiceAsync(
            group.service_id
          );
          return {
            service_id: group.service_id,
            direction_id: group.direction_id,
            calendar,
            tripCount: group.trips.length,
            directionName: this.getDirectionName(
              group.direction_id,
              group.trips
            ),
          };
        })
      );

      return services;
    } catch (error) {
      console.error(
        'Error getting services for route by direction from IndexedDB:',
        error
      );
      // Fallback to sync method
      return this.getServicesForRouteByDirection(route_id);
    }
  }

  /**
   * Get route by ID (async)
   */
  async getRouteByIdAsync(route_id: string) {
    try {
      const routesData = await this.gtfsDatabase.queryRows('routes', {
        route_id: route_id,
      });
      if (
        !routesData ||
        !Array.isArray(routesData) ||
        routesData.length === 0
      ) {
        return null;
      }

      const route = routesData[0];
      return {
        id: route.route_id,
        agency_id: route.agency_id,
        shortName: route.route_short_name,
        longName: route.route_long_name,
        desc: route.route_desc,
        type: route.route_type,
        url: route.route_url,
        color: route.route_color,
        textColor: route.route_text_color,
        sortOrder: route.route_sort_order,
      };
    } catch (error) {
      console.error('Error getting route by ID from IndexedDB:', error);
      // Fallback to sync method
      return this.getRouteById(route_id);
    }
  }

  /**
   * Get trip by ID (async)
   */
  async getTripByIdAsync(trip_id: string) {
    try {
      const tripsData = await this.gtfsDatabase.queryRows('trips', {
        trip_id: trip_id,
      });
      if (!tripsData || !Array.isArray(tripsData) || tripsData.length === 0) {
        return null;
      }

      const trip = tripsData[0];
      return {
        id: trip.trip_id,
        route_id: trip.route_id,
        service_id: trip.service_id,
        headsign: trip.trip_headsign,
        shortName: trip.trip_short_name,
        direction_id: trip.direction_id,
        block_id: trip.block_id,
        shape_id: trip.shape_id,
        wheelchairAccessible: trip.wheelchair_accessible,
        bikesAllowed: trip.bikes_allowed,
      };
    } catch (error) {
      console.error('Error getting trip by ID from IndexedDB:', error);
      // Fallback to sync method
      return this.getTripById(trip_id);
    }
  }

  /**
   * Search stops by name/ID using IndexedDB (async)
   */
  async searchStopsAsync(query: string) {
    try {
      if (!query || query.trim().length < 2) {
        return [];
      }

      const stops = await this.gtfsDatabase.getAllRows('stops');
      const lowerQuery = query.toLowerCase();

      return stops
        .filter((stop) => {
          const stopName = (stop.stop_name || '').toLowerCase();
          const stop_id = (stop.stop_id || '').toLowerCase();
          const stopCode = (stop.stop_code || '').toLowerCase();

          return (
            stopName.includes(lowerQuery) ||
            stop_id.includes(lowerQuery) ||
            stopCode.includes(lowerQuery)
          );
        })
        .map((stop) => ({
          id: stop.stop_id,
          name: stop.stop_name || stop.stop_id,
          code: stop.stop_code,
          lat: parseFloat(stop.stop_lat),
          lon: parseFloat(stop.stop_lon),
          desc: stop.stop_desc,
        }))
        .slice(0, 10); // Limit to 10 results
    } catch (error) {
      console.error('Error searching stops from IndexedDB:', error);
      // Fallback to sync method from gtfsParser
      return this.gtfsParser.searchStops(query);
    }
  }

  /**
   * Search routes by name/ID using IndexedDB (async)
   */
  async searchRoutesAsync(query: string) {
    try {
      if (!query || query.trim().length < 2) {
        return [];
      }

      const routes = await this.gtfsDatabase.getAllRows('routes');
      const lowerQuery = query.toLowerCase();

      return routes
        .filter((route) => {
          const routeName = (route.route_long_name || '').toLowerCase();
          const routeShortName = (route.route_short_name || '').toLowerCase();
          const route_id = (route.route_id || '').toLowerCase();

          return (
            routeName.includes(lowerQuery) ||
            routeShortName.includes(lowerQuery) ||
            route_id.includes(lowerQuery)
          );
        })
        .map((route) => ({
          id: route.route_id,
          shortName: route.route_short_name,
          longName: route.route_long_name,
          type: route.route_type,
          color: route.route_color,
          textColor: route.route_text_color,
          agency_id: route.agency_id,
        }))
        .slice(0, 10); // Limit to 10 results
    } catch (error) {
      console.error('Error searching routes from IndexedDB:', error);
      // Fallback to sync method from gtfsParser
      return this.gtfsParser.searchRoutes(query);
    }
  }

  /**
   * Combined search for stops and routes (async)
   */
  async searchAllAsync(query: string) {
    try {
      if (!query || query.trim().length < 2) {
        return { stops: [], routes: [] };
      }

      const [stops, routes] = await Promise.all([
        this.searchStopsAsync(query),
        this.searchRoutesAsync(query),
      ]);

      return { stops, routes };
    } catch (error) {
      console.error('Error performing combined search from IndexedDB:', error);
      // Fallback to sync method from gtfsParser
      return this.gtfsParser.searchAll(query);
    }
  }

  /**
   * Get agency by ID (async)
   */
  async getAgencyByIdAsync(agency_id: string) {
    try {
      const agencyData = await this.gtfsDatabase.queryRows('agency', {
        agency_id: agency_id,
      });
      if (
        !agencyData ||
        !Array.isArray(agencyData) ||
        agencyData.length === 0
      ) {
        return null;
      }

      const agency = agencyData[0];
      return {
        id: agency.agency_id,
        name: agency.agency_name || `Agency ${agency.agency_id}`,
        url: agency.agency_url,
        timezone: agency.agency_timezone,
        lang: agency.agency_lang,
        phone: agency.agency_phone,
        fare_url: agency.agency_fare_url,
        email: agency.agency_email,
      };
    } catch (error) {
      console.error('Error getting agency by ID from IndexedDB:', error);
      // Fallback to sync method
      const agencies = this.getAgencies();
      return agencies.find((agency) => agency.id === agency_id) || null;
    }
  }

  /**
   * Get all routes that serve a specific stop (async)
   */
  async getRoutesForStopAsync(stop_id: string) {
    try {
      // First get all trips that serve this stop
      const trips = await this.getTripsForStopAsync(stop_id);

      // Get unique route IDs from those trips
      const route_ids = [...new Set(trips.map((trip) => trip.route_id))];

      // Get route details for each route ID
      const routes = await Promise.all(
        route_ids.map((route_id) => this.getRouteByIdAsync(route_id))
      );

      // Filter out null routes and return
      return routes.filter((route) => route !== null);
    } catch (error) {
      console.error('Error getting routes for stop from IndexedDB:', error);
      // Fallback implementation using sync methods
      const trips = this.getTripsForStop(stop_id);
      const route_ids = [...new Set(trips.map((trip) => trip.route_id))];
      return route_ids
        .map((route_id) => this.getRouteById(route_id))
        .filter((route) => route !== null);
    }
  }

  /**
   * Get all routes that use a specific service (async)
   */
  async getRoutesForServiceAsync(service_id: string) {
    try {
      // Get all trips for this service
      const trips = await this.getTripsForServiceAsync(service_id);

      // Get unique route IDs from those trips
      const route_ids = [...new Set(trips.map((trip) => trip.route_id))];

      // Get route details for each route ID
      const routes = await Promise.all(
        route_ids.map((route_id) => this.getRouteByIdAsync(route_id))
      );

      // Filter out null routes and return
      return routes.filter((route) => route !== null);
    } catch (error) {
      console.error('Error getting routes for service from IndexedDB:', error);
      return [];
    }
  }

  /**
   * Get all trips that use a specific service (async)
   */
  async getTripsForServiceAsync(service_id: string) {
    try {
      const tripsData = await this.gtfsDatabase.queryRows('trips', {
        service_id: service_id,
      });
      if (!tripsData || !Array.isArray(tripsData)) {
        return [];
      }

      return tripsData.map((trip) => ({
        id: trip.trip_id,
        trip_id: trip.trip_id,
        route_id: trip.route_id,
        service_id: trip.service_id,
        headsign: trip.trip_headsign,
        trip_headsign: trip.trip_headsign,
        shortName: trip.trip_short_name,
        trip_short_name: trip.trip_short_name,
        direction_id: trip.direction_id,
        block_id: trip.block_id,
        shape_id: trip.shape_id,
        wheelchairAccessible: trip.wheelchair_accessible,
        bikesAllowed: trip.bikes_allowed,
      }));
    } catch (error) {
      console.error('Error getting trips for service from IndexedDB:', error);
      return [];
    }
  }
}
