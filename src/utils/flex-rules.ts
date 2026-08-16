/**
 * The conditional-presence rules GTFS Flex puts on a row.
 *
 * Shared by the On-Demand editor's per-row validation and by the feed
 * validator, so a row typed in the app and a row that arrived in an imported
 * feed are judged by the same rule.
 *
 * Every check tolerates a partially filled row: `editable-table.ts` calls these
 * mid-edit with `{ ...before, [field]: value }`, so a rule that assumed a
 * complete row would fire while the user is still typing.
 */

function cell(row: Record<string, unknown>, field: string): string {
  return String(row[field] ?? '').trim();
}

/**
 * The three mutually exclusive references, the pickup/drop-off window, and the
 * fields a window restricts.
 */
export function validateFlexStopTimeRow(
  row: Record<string, unknown>
): string | null {
  const stop_id = cell(row, 'stop_id');
  const location_group_id = cell(row, 'location_group_id');
  const location_id = cell(row, 'location_id');

  const named = [
    ['stop_id', stop_id],
    ['location_group_id', location_group_id],
    ['location_id', location_id],
  ].filter(([, value]) => value !== '');

  if (named.length === 0) {
    return 'one of stop_id, location_group_id or location_id is required';
  }
  if (named.length > 1) {
    return `${named.map(([field]) => field).join(' and ')} are mutually exclusive: name exactly one`;
  }

  const start = cell(row, 'start_pickup_drop_off_window');
  const end = cell(row, 'end_pickup_drop_off_window');
  const hasWindow = start !== '' || end !== '';

  if ((start === '') !== (end === '')) {
    return 'start_pickup_drop_off_window and end_pickup_drop_off_window must both be set, or both left empty';
  }
  if (!hasWindow && (location_group_id !== '' || location_id !== '')) {
    return `a pickup/drop-off window is required when ${location_group_id !== '' ? 'location_group_id' : 'location_id'} is defined`;
  }
  if (!hasWindow) {
    return null;
  }

  const arrival = cell(row, 'arrival_time');
  const departure = cell(row, 'departure_time');
  if (arrival !== '' || departure !== '') {
    return 'a pickup/drop-off window is forbidden when arrival_time or departure_time is defined';
  }
  if (start > end) {
    return 'start_pickup_drop_off_window must not be later than end_pickup_drop_off_window';
  }

  // Empty is equivalent to 0 for both, and 0 is forbidden under a window, so an
  // empty value is a violation rather than something to skip.
  const pickup_type = cell(row, 'pickup_type');
  if (pickup_type !== '1' && pickup_type !== '2') {
    return 'pickup_type must be 1 or 2 when a pickup/drop-off window is defined';
  }
  const drop_off_type = cell(row, 'drop_off_type');
  if (drop_off_type !== '1' && drop_off_type !== '2' && drop_off_type !== '3') {
    return 'drop_off_type must be 1, 2 or 3 when a pickup/drop-off window is defined';
  }

  for (const field of ['continuous_pickup', 'continuous_drop_off']) {
    const value = cell(row, field);
    if (value !== '' && value !== '1') {
      return `${field} must be 1 or empty when a pickup/drop-off window is defined`;
    }
  }

  return null;
}

/** Per-field verdict for one stop_times row. `ok` fields are omitted. */
export type FieldPresenceState = 'ok' | 'required' | 'forbidden';

export interface FieldPresence {
  state: FieldPresenceState;
  reason?: string;
}

/**
 * The same conditional-presence rules as `validateFlexStopTimeRow`, but
 * reported per field instead of as the first violation, so the timetable can
 * decorate each sub-row on its own.
 *
 * `validateFlexStopTimeRow` stays the commit gate: this is advisory. Like it,
 * this tolerates a half-typed row, because it is called mid-edit.
 *
 * `position` says whether the row is the trip's first or last stop, which the
 * arrival/departure requirement needs and which cannot be read off the row.
 */
export function stopTimeFieldPresence(
  row: Record<string, unknown>,
  position?: { isFirst?: boolean; isLast?: boolean }
): Map<string, FieldPresence> {
  const result = new Map<string, FieldPresence>();
  const mark = (field: string, state: FieldPresenceState, reason: string) => {
    // First rule to fire wins, matching validateFlexStopTimeRow's ordering.
    if (!result.has(field)) {
      result.set(field, { state, reason });
    }
  };

  const location_group_id = cell(row, 'location_group_id');
  const location_id = cell(row, 'location_id');
  const start = cell(row, 'start_pickup_drop_off_window');
  const end = cell(row, 'end_pickup_drop_off_window');
  const arrival = cell(row, 'arrival_time');
  const departure = cell(row, 'departure_time');
  const hasWindow = start !== '' || end !== '';
  const hasTime = arrival !== '' || departure !== '';

  if (hasWindow) {
    for (const field of ['arrival_time', 'departure_time']) {
      mark(
        field,
        'forbidden',
        `${field} is forbidden when a pickup/drop-off window is defined`
      );
    }
  } else {
    if (position?.isFirst || position?.isLast) {
      if (arrival === '') {
        mark(
          'arrival_time',
          'required',
          'arrival_time is required for the first and last stop of a trip'
        );
      }
    }
    if (cell(row, 'timepoint') === '1') {
      if (arrival === '') {
        mark(
          'arrival_time',
          'required',
          'arrival_time is required when timepoint=1'
        );
      }
      if (departure === '') {
        mark(
          'departure_time',
          'required',
          'departure_time is required when timepoint=1'
        );
      }
    }
  }

  for (const [field, value, other] of [
    ['start_pickup_drop_off_window', start, end],
    ['end_pickup_drop_off_window', end, start],
  ] as const) {
    if (hasTime) {
      mark(
        field,
        'forbidden',
        `${field} is forbidden when arrival_time or departure_time is defined`
      );
      continue;
    }
    if (value !== '') {
      continue;
    }
    if (location_group_id !== '' || location_id !== '') {
      mark(
        field,
        'required',
        `${field} is required when ${location_group_id !== '' ? 'location_group_id' : 'location_id'} is defined`
      );
    } else if (other !== '') {
      mark(
        field,
        'required',
        'start_pickup_drop_off_window and end_pickup_drop_off_window must both be set, or both left empty'
      );
    }
  }

  if (hasWindow) {
    const pickup_type = cell(row, 'pickup_type');
    if (pickup_type === '0' || pickup_type === '3') {
      mark(
        'pickup_type',
        'forbidden',
        `pickup_type=${pickup_type} is forbidden when a pickup/drop-off window is defined; it must be 1 or 2`
      );
    } else if (pickup_type === '') {
      mark(
        'pickup_type',
        'required',
        'pickup_type must be 1 or 2 when a pickup/drop-off window is defined; empty is equivalent to 0'
      );
    }

    const drop_off_type = cell(row, 'drop_off_type');
    if (drop_off_type === '0') {
      mark(
        'drop_off_type',
        'forbidden',
        'drop_off_type=0 is forbidden when a pickup/drop-off window is defined; it must be 1, 2 or 3'
      );
    } else if (drop_off_type === '') {
      mark(
        'drop_off_type',
        'required',
        'drop_off_type must be 1, 2 or 3 when a pickup/drop-off window is defined; empty is equivalent to 0'
      );
    }

    for (const field of ['continuous_pickup', 'continuous_drop_off']) {
      const value = cell(row, field);
      if (value !== '' && value !== '1') {
        mark(
          field,
          'forbidden',
          `${field}=${value} is forbidden when a pickup/drop-off window is defined; it must be 1 or empty`
        );
      }
    }
  }

  return result;
}

/**
 * The `booking_type` matrix: which prior-notice fields each booking type
 * requires and which it forbids.
 *
 * An empty `booking_type` passes: the field is required, but that is the spec's
 * own required-field check, and firing here would reject every half-typed row.
 */
export function validateBookingRuleRow(
  row: Record<string, unknown>
): string | null {
  const booking_type = cell(row, 'booking_type');
  if (booking_type === '') {
    return null;
  }

  const duration_min = cell(row, 'prior_notice_duration_min');
  const duration_max = cell(row, 'prior_notice_duration_max');
  const last_day = cell(row, 'prior_notice_last_day');
  const last_time = cell(row, 'prior_notice_last_time');
  const start_day = cell(row, 'prior_notice_start_day');
  const start_time = cell(row, 'prior_notice_start_time');
  const service_id = cell(row, 'prior_notice_service_id');

  if (booking_type === '1') {
    if (duration_min === '') {
      return 'prior_notice_duration_min is required for booking_type=1';
    }
  } else if (duration_min !== '') {
    return `prior_notice_duration_min is forbidden for booking_type=${booking_type}`;
  }

  if (duration_max !== '' && booking_type !== '1') {
    return `prior_notice_duration_max is forbidden for booking_type=${booking_type}`;
  }

  if (booking_type === '2') {
    if (last_day === '') {
      return 'prior_notice_last_day is required for booking_type=2';
    }
  } else if (last_day !== '') {
    return `prior_notice_last_day is forbidden for booking_type=${booking_type}`;
  }

  if ((last_day === '') !== (last_time === '')) {
    return 'prior_notice_last_day and prior_notice_last_time must both be set, or both left empty';
  }

  if (start_day !== '') {
    if (booking_type === '0') {
      return 'prior_notice_start_day is forbidden for booking_type=0';
    }
    if (booking_type === '1' && duration_max !== '') {
      return 'prior_notice_start_day is forbidden for booking_type=1 when prior_notice_duration_max is defined';
    }
  }

  if ((start_day === '') !== (start_time === '')) {
    return 'prior_notice_start_day and prior_notice_start_time must both be set, or both left empty';
  }

  if (service_id !== '' && booking_type !== '2') {
    return `prior_notice_service_id is only allowed for booking_type=2, not booking_type=${booking_type}`;
  }

  return null;
}

/**
 * `location_group_id` shares one ID namespace with `stops.stop_id` and
 * locations.geojson `id`, so a collision across the three files is an error
 * even though each file is internally unique.
 *
 * `taken` is every id already claimed by the other two files.
 */
export function validateLocationGroupId(
  location_group_id: string,
  taken: Map<string, string>
): string | null {
  const owner = taken.get(location_group_id);
  if (!owner) {
    return null;
  }
  return `location_group_id '${location_group_id}' is already used as ${owner}; the ID must be unique across stops.txt, locations.geojson and location_groups.txt`;
}
