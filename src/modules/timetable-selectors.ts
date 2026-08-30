/**
 * Marker classes for the timetable modal's selector bar.
 *
 * The bar is rendered by TimetableRenderer and handled by ScheduleController's
 * document-level delegation, so the class names live in neither of them.
 */

/** Picker trigger that repoints the timetable at another route. */
export const TIMETABLE_ROUTE_PICKER = 'timetable-route-picker';

/** Picker trigger that repoints the timetable at another service. */
export const TIMETABLE_SERVICE_PICKER = 'timetable-service-picker';

/** One direction tab; `data-direction-id` carries the direction it selects. */
export const TIMETABLE_DIRECTION_TAB = 'timetable-direction-tab';

/**
 * Trailing "+" tab that adds a direction the route does not run yet;
 * `data-direction-id` carries the direction_id it will select.
 */
export const TIMETABLE_ADD_DIRECTION = 'timetable-add-direction';
