/**
 * The conditional-presence rules that span two fields of one row.
 *
 * Shared by the fares modal's per-row validation and by the feed validator, so
 * an edit made in the app and a row that arrived in an imported feed are judged
 * by the same rule.
 */

function cell(row: Record<string, unknown>, field: string): string {
  return String(row[field] ?? '').trim();
}

/** Seconds since midnight, or null when the value is not a wall-clock time. */
function localTimeSeconds(value: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(value);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

const DAY_SECONDS = 24 * 60 * 60;

export function validateTimeframeRow(
  row: Record<string, unknown>
): string | null {
  const start = cell(row, 'start_time');
  const end = cell(row, 'end_time');
  if ((start === '') !== (end === '')) {
    return 'start_time and end_time must both be set, or both left empty';
  }
  for (const [field, value] of [
    ['start_time', start],
    ['end_time', end],
  ]) {
    if (value === '') {
      continue;
    }
    const seconds = localTimeSeconds(value);
    if (seconds === null) {
      return `${field} must be a wall-clock time in HH:MM:SS format`;
    }
    if (seconds > DAY_SECONDS) {
      return `${field} must not be later than 24:00:00`;
    }
  }
  return null;
}

export function validateFareLegJoinRuleRow(
  row: Record<string, unknown>
): string | null {
  const from = cell(row, 'from_stop_id');
  const to = cell(row, 'to_stop_id');
  if ((from === '') !== (to === '')) {
    return 'from_stop_id and to_stop_id must both be set, or both left empty';
  }
  return null;
}

export function validateFareTransferRuleRow(
  row: Record<string, unknown>
): string | null {
  const limit = cell(row, 'duration_limit');
  const type = cell(row, 'duration_limit_type');
  if ((limit === '') !== (type === '')) {
    return 'duration_limit and duration_limit_type must both be set, or both left empty';
  }
  return null;
}

/**
 * `from_stop_id` / `to_stop_id` are only optional for the linked-trip transfer
 * types, which identify the connection by trip instead.
 */
export function validateTransferRow(
  row: Record<string, unknown>
): string | null {
  const transferType = cell(row, 'transfer_type');
  const linkedTrips = transferType === '4' || transferType === '5';
  if (linkedTrips) {
    for (const field of ['from_trip_id', 'to_trip_id']) {
      if (cell(row, field) === '') {
        return `${field} is required when transfer_type is ${transferType}`;
      }
    }
    return null;
  }
  for (const field of ['from_stop_id', 'to_stop_id']) {
    if (cell(row, field) === '') {
      return `${field} is required when transfer_type is empty, 0, 1, 2, or 3`;
    }
  }
  return null;
}
