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
}
