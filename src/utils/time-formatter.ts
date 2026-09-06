/**
 * Time Formatter Utility
 *
 * Provides time formatting, parsing, and manipulation utilities for GTFS time values.
 * Handles 24+ hour times (e.g., "25:30:00" for next-day service) according to GTFS specification.
 * All methods are static for convenient usage throughout the application.
 *
 * Key features:
 * - Supports various input formats (H:M, H:MM, HH:MM, HH:MM:SS)
 * - Handles 24+ hour times for next-day transit service
 * - Provides consistent output formatting
 * - Pure functions with no side effects
 */
export class TimeFormatter {
  /**
   * Cast time from various input formats to HH:MM:SS format
   *
   * Normalizes user input to the GTFS standard HH:MM:SS format.
   * Supports flexible input formats and handles GTFS-compliant 24+ hour times.
   *
   * Supported input formats:
   * - HH:MM:SS (already correct, returned as-is)
   * - HH:MM (appends :00 for seconds)
   * - H:MM (pads hour with leading zero, appends :00)
   * - H:M (pads both hour and minute, appends :00)
   *
   * @param timeInput - Time string in various formats
   * @returns Normalized time string in HH:MM:SS format
   * @example
   * castTimeToHHMMSS('9:30') -> '09:30:00'
   * castTimeToHHMMSS('14:45') -> '14:45:00'
   * castTimeToHHMMSS('25:30:00') -> '25:30:00' (next-day service)
   */
  static castTimeToHHMMSS(timeInput: string): string {
    const trimmed = timeInput.trim();

    // If already in HH:MM:SS format, return as-is
    if (
      /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$|^(2[4-9]|[3-9]\d):[0-5]\d:[0-5]\d$/.test(
        trimmed
      )
    ) {
      return trimmed;
    }

    // If in HH:MM format, append :00
    if (/^([01]\d|2[0-3]):[0-5]\d$|^(2[4-9]|[3-9]\d):[0-5]\d$/.test(trimmed)) {
      return trimmed + ':00';
    }

    // If in H:MM format, pad with leading zero and append :00
    if (/^\d:[0-5]\d$/.test(trimmed)) {
      return '0' + trimmed + ':00';
    }

    // If in H:M format, pad both and append :00
    if (/^\d:\d$/.test(trimmed)) {
      const parts = trimmed.split(':');
      return (
        parts[0].padStart(2, '0') + ':' + parts[1].padStart(2, '0') + ':00'
      );
    }

    // Return original if no casting possible
    return trimmed;
  }

  /**
   * Format time for display (HH:MM format)
   *
   * Converts time strings to display format without seconds.
   * Preserves 24+ hour times for next-day service visualization.
   * Handles edge cases and malformed input gracefully.
   *
   * @param time - Time string in HH:MM:SS or HH:MM format
   * @returns Formatted time string in HH:MM format, or empty string if invalid
   * @example
   * formatTime('09:30:45') -> '09:30'
   * formatTime('25:30:00') -> '25:30' (next-day service)
   * formatTime('') -> ''
   */
  static formatTime(time: string): string {
    if (!time) {
      return '';
    }

    // Handle times like "24:30:00" or "25:15:00" (next day)
    const parts = time.split(':');
    if (parts.length >= 2) {
      const hours = parseInt(parts[0]);
      const minutes = parts[1];

      if (hours >= 24) {
        // Next day time - show as is for now, could add +1 indicator
        return `${hours}:${minutes}`;
      }

      return `${hours.toString().padStart(2, '0')}:${minutes}`;
    }

    return time;
  }

  /**
   * Format time for display with seconds (HH:MM:SS format)
   *
   * Ensures time strings include seconds for complete display.
   * Preserves 24+ hour times and handles missing seconds by adding :00.
   * Used for precise time editing and database storage.
   *
   * @param time - Time string in various formats
   * @returns Formatted time string in HH:MM:SS format, or empty string if invalid
   * @example
   * formatTimeWithSeconds('09:30') -> '09:30:00'
   * formatTimeWithSeconds('25:30:45') -> '25:30:45'
   * formatTimeWithSeconds('') -> ''
   */
  static formatTimeWithSeconds(time: string): string {
    if (!time) {
      return '';
    }

    // Handle times like "24:30:00" or "25:15:00" (next day)
    const parts = time.split(':');
    if (parts.length >= 3) {
      const hours = parseInt(parts[0]);
      const minutes = parts[1];
      const seconds = parts[2];

      return `${hours.toString().padStart(2, '0')}:${minutes}:${seconds}`;
    } else if (parts.length === 2) {
      // Add seconds if missing
      const hours = parseInt(parts[0]);
      const minutes = parts[1];
      return `${hours.toString().padStart(2, '0')}:${minutes}:00`;
    }

    return time;
  }

  /**
   * Add minutes to a time string (HH:MM:SS format)
   *
   * Performs time arithmetic while maintaining GTFS compliance.
   * Handles day overflow correctly by allowing 24+ hour times.
   * Preserves seconds from original time string.
   *
   * @param timeString - Base time string in HH:MM:SS format
   * @param minutes - Number of minutes to add (can be negative)
   * @returns New time string with minutes added, preserving seconds
   * @example
   * addMinutesToTime('23:45:30', 30) -> '24:15:30' (next-day service)
   * addMinutesToTime('10:30:00', -15) -> '10:15:00'
   * addMinutesToTime('', 60) -> '00:00:00'
   */
  static addMinutesToTime(timeString: string, minutes: number): string {
    if (!timeString) {
      return '00:00:00';
    }

    const parts = timeString.split(':');
    if (parts.length < 2) {
      return timeString;
    }

    const hours = parseInt(parts[0]);
    const mins = parseInt(parts[1]);
    const seconds = parts[2] ? parseInt(parts[2]) : 0;

    // Convert to total minutes
    const totalMinutes = hours * 60 + mins + minutes;

    // Handle day overflow (24+ hours)
    const newHours = Math.floor(totalMinutes / 60);
    const newMins = totalMinutes % 60;

    return `${newHours.toString().padStart(2, '0')}:${newMins.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Seconds since noon minus twelve hours, i.e. the GTFS time scale.
   *
   * Hours above 23 are legal and must not wrap: '25:10:00' is a real end_time
   * for a band running past midnight, and it has to compare greater than
   * '23:50:00'. Returns null rather than 0 on an unparseable or empty value, so
   * a blank time never compares equal to midnight.
   *
   * @param time - Time string in HH:MM:SS or HH:MM format
   * @returns Total seconds, or null when the value cannot be parsed
   * @example
   * timeToSeconds('25:10:00') -> 90600
   * timeToSeconds('') -> null
   */
  static timeToSeconds(time: string | null | undefined): number | null {
    if (!time) {
      return null;
    }

    const match = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/.exec(time.trim());
    if (!match) {
      return null;
    }

    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = match[3] ? parseInt(match[3], 10) : 0;

    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * Inverse of timeToSeconds. Hours are not wrapped at 24, so a value past
   * midnight round-trips as the 24+ form GTFS expects.
   *
   * @param seconds - Total seconds since the service day start
   * @returns Time string in HH:MM:SS format
   * @example
   * secondsToTime(90600) -> '25:10:00'
   */
  static secondsToTime(seconds: number): string {
    const whole = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const secs = whole % 60;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Shift a time by a number of seconds, clamping at 00:00:00.
   *
   * Unlike addMinutesToTime, an empty input stays empty: shifting a whole trip
   * must not invent a time on a row that has none.
   *
   * @param time - Time string in HH:MM:SS or HH:MM format
   * @param seconds - Seconds to add, may be negative
   * @returns The shifted time, or the input unchanged when it cannot be parsed
   * @example
   * addSecondsToTime('23:45:30', 1800) -> '24:15:30'
   * addSecondsToTime('', 3600) -> ''
   */
  static addSecondsToTime(time: string, seconds: number): string {
    const base = TimeFormatter.timeToSeconds(time);
    if (base === null) {
      return time;
    }
    return TimeFormatter.secondsToTime(base + seconds);
  }

  /**
   * Parse a signed duration the user typed. A bare number is minutes, two
   * parts are MM:SS and three are HH:MM:SS.
   *
   * @param input - Signed MM, MM:SS or HH:MM:SS duration
   * @returns The duration in seconds, or null when it cannot be parsed
   * @example
   * parseSignedDuration('-5') -> -300
   * parseSignedDuration('1:30') -> 90
   * parseSignedDuration('+01:00:00') -> 3600
   */
  static parseSignedDuration(input: string): number | null {
    const match = /^([+-]?)(\d{1,3})(?::([0-5]\d))?(?::([0-5]\d))?$/.exec(
      input.trim()
    );
    if (!match) {
      return null;
    }

    const [, sign, first, second, third] = match;
    // How many parts matched decides what the leading number means.
    const magnitude =
      third !== undefined
        ? parseInt(first, 10) * 3600 +
          parseInt(second, 10) * 60 +
          parseInt(third, 10)
        : second !== undefined
          ? parseInt(first, 10) * 60 + parseInt(second, 10)
          : parseInt(first, 10) * 60;
    return sign === '-' ? -magnitude : magnitude;
  }

  /**
   * Inverse of parseSignedDuration: the canonical form of a duration, always
   * signed. MM:SS below an hour, H:MM:SS at or above one.
   *
   * @param seconds - Duration in seconds, may be negative
   * @returns The duration as a string parseSignedDuration reads back
   * @example
   * formatSignedDuration(-300) -> '-05:00'
   * formatSignedDuration(5400) -> '+1:30:00'
   */
  static formatSignedDuration(seconds: number): string {
    const sign = seconds < 0 ? '-' : '+';
    const abs = Math.abs(Math.round(seconds));
    const ss = String(abs % 60).padStart(2, '0');
    if (abs < 3600) {
      return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${ss}`;
    }
    const mm = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
    return `${sign}${Math.floor(abs / 3600)}:${mm}:${ss}`;
  }
}
