/**
 * GTFS Primary Key Configuration
 *
 * Mirrors the "Primary key (...)" line of each file section in
 * reference/gtfs-reference.md.
 */

export interface GTFSTablePrimaryKey {
  /** The table name (filename without .txt) */
  tableName: string;
  /** The field(s) that make up the primary key */
  fields: string[];
  /** Whether this is a natural key (single field) or composite key (multiple fields) */
  type: 'natural' | 'composite' | 'all_fields' | 'none';
  /** Whether the table allows only one row (like feed_info.txt) */
  singleRow?: boolean;
}

/**
 * Official GTFS Primary Key Definitions
 * Source: reference/gtfs-reference.md, revised April 27, 2026
 */
export const GTFS_PRIMARY_KEYS: GTFSTablePrimaryKey[] = [
  // Core Required Files
  {
    tableName: 'agency',
    fields: ['agency_id'],
    type: 'natural',
  },
  {
    tableName: 'stops',
    fields: ['stop_id'],
    type: 'natural',
  },
  {
    tableName: 'routes',
    fields: ['route_id'],
    type: 'natural',
  },
  {
    tableName: 'trips',
    fields: ['trip_id'],
    type: 'natural',
  },
  {
    tableName: 'stop_times',
    fields: ['trip_id', 'stop_sequence'],
    type: 'composite',
  },

  // Calendar Files
  {
    tableName: 'calendar',
    fields: ['service_id'],
    type: 'natural',
  },
  {
    tableName: 'calendar_dates',
    fields: ['service_id', 'date'],
    type: 'composite',
  },

  // Optional Core Files
  {
    tableName: 'shapes',
    fields: ['shape_id', 'shape_pt_sequence'],
    type: 'composite',
  },
  {
    tableName: 'frequencies',
    fields: ['trip_id', 'start_time'],
    type: 'composite',
  },
  {
    tableName: 'transfers',
    fields: [
      'from_stop_id',
      'to_stop_id',
      'from_trip_id',
      'to_trip_id',
      'from_route_id',
      'to_route_id',
    ],
    type: 'composite',
  },
  {
    tableName: 'feed_info',
    fields: [],
    type: 'none',
    singleRow: true,
  },

  // Fare Files
  {
    tableName: 'fare_attributes',
    fields: ['fare_id'],
    type: 'natural',
  },
  {
    tableName: 'fare_rules',
    fields: [], // All provided fields
    type: 'all_fields',
  },

  // Extended GTFS Files
  {
    tableName: 'timeframes',
    fields: [], // All provided fields
    type: 'all_fields',
  },
  {
    tableName: 'rider_categories',
    fields: ['rider_category_id'],
    type: 'natural',
  },
  {
    tableName: 'fare_media',
    fields: ['fare_media_id'],
    type: 'natural',
  },
  {
    tableName: 'fare_products',
    fields: ['fare_product_id', 'rider_category_id', 'fare_media_id'],
    type: 'composite',
  },
  {
    tableName: 'fare_leg_rules',
    fields: [
      'network_id',
      'from_area_id',
      'to_area_id',
      'from_timeframe_group_id',
      'to_timeframe_group_id',
      'fare_product_id',
    ],
    type: 'composite',
  },
  {
    tableName: 'fare_leg_join_rules',
    fields: ['from_network_id', 'to_network_id', 'from_stop_id', 'to_stop_id'],
    type: 'composite',
  },
  {
    tableName: 'fare_transfer_rules',
    fields: [
      'from_leg_group_id',
      'to_leg_group_id',
      'fare_product_id',
      'transfer_count',
      'duration_limit',
    ],
    type: 'composite',
  },
  {
    tableName: 'areas',
    fields: ['area_id'],
    type: 'natural',
  },
  {
    tableName: 'stop_areas',
    fields: [], // All provided fields
    type: 'all_fields',
  },
  {
    tableName: 'networks',
    fields: ['network_id'],
    type: 'natural',
  },
  {
    tableName: 'route_networks',
    fields: ['route_id'],
    type: 'natural',
  },
  {
    // The reference names attribution_id as the primary key, but the field is
    // Optional, so real feeds omit it. Keying on all fields is the only form
    // that stays unique for those.
    tableName: 'attributions',
    fields: [],
    type: 'all_fields',
  },
  {
    tableName: 'translations',
    fields: [
      'table_name',
      'field_name',
      'language',
      'record_id',
      'record_sub_id',
      'field_value',
    ],
    type: 'composite',
  },

  // Pathways and Accessibility
  {
    tableName: 'pathways',
    fields: ['pathway_id'],
    type: 'natural',
  },
  {
    tableName: 'levels',
    fields: ['level_id'],
    type: 'natural',
  },

  // Location Groups and Booking
  {
    tableName: 'location_groups',
    fields: ['location_group_id'],
    type: 'natural',
  },
  {
    tableName: 'location_group_stops',
    fields: [], // All provided fields
    type: 'all_fields',
  },
  {
    tableName: 'booking_rules',
    fields: ['booking_rule_id'],
    type: 'natural',
  },
  {
    // locations.geojson is stored as a single row holding the whole
    // FeatureCollection, so the store holds exactly one row under a fixed key.
    tableName: 'locations',
    fields: [],
    type: 'none',
    singleRow: true,
  },
];

/**
 * Get primary key configuration for a GTFS table
 */
export function getGTFSPrimaryKey(
  tableName: string
): GTFSTablePrimaryKey | null {
  return (
    GTFS_PRIMARY_KEYS.find((config) => config.tableName === tableName) || null
  );
}

/**
 * Check if a table uses a natural (single field) primary key
 */
export function isNaturalKey(tableName: string): boolean {
  const config = getGTFSPrimaryKey(tableName);
  return config?.type === 'natural';
}

/**
 * Get the natural key field name for tables with single-field primary keys
 */
export function getNaturalKeyField(tableName: string): string | null {
  const config = getGTFSPrimaryKey(tableName);
  if (config?.type === 'natural' && config.fields.length === 1) {
    return config.fields[0];
  }
  return null;
}

/**
 * Generate a composite key string from a record
 */
export function generateCompositeKeyFromRecord(
  tableName: string,
  record: Record<string, unknown>
): string {
  const config = getGTFSPrimaryKey(tableName);

  if (!config) {
    throw new Error(`Unknown GTFS table: ${tableName}`);
  }

  if (config.type === 'natural') {
    const field = config.fields[0];
    const value = record[field];
    if (value === undefined || value === null || value === '') {
      throw new Error(
        `Missing required primary key field '${field}' for table '${tableName}'`
      );
    }
    return String(value);
  }

  if (config.type === 'composite') {
    const keyParts = config.fields.map((field) => {
      const value = record[field];
      return value !== undefined && value !== null ? String(value) : '';
    });
    return keyParts.join(':');
  }

  if (config.type === 'all_fields') {
    // For tables that use all fields as primary key, sort field names for consistency
    const fields = Object.keys(record).sort();
    const keyParts = fields.map((field) => {
      const value = record[field];
      return `${field}=${String(value)}`;
    });
    return keyParts.join('&');
  }

  if (config.type === 'none') {
    // Single row tables like feed_info use a fixed key
    return tableName;
  }

  throw new Error(
    `Unsupported primary key type '${config.type}' for table '${tableName}'`
  );
}
