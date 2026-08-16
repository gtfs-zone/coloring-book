/**
 * The compact timetable cell's flag-row glyphs.
 *
 * Nine fixed slots under the two times, one per non-time stop_times field, so a
 * compact cell still answers "is there more here?" without expanding. The glyph
 * encodes the *value*, not merely that the field is set: pickup_type 1 (no
 * pickup) and pickup_type 2 (phone the agency) have to look different at a
 * glance, which is the whole point of the row.
 *
 * Same signature style as the icons in modal-utils.ts - inline SVG, currentColor
 * so the slot's tone class colours it, sized by class. These default to 12px
 * because nine of them plus three separators have to fit inside an 11rem column.
 */

/** Every glyph a flag slot can show. `stopTimeFlagSlots` picks one per slot. */
export type FlagGlyph =
  | 'dot'
  | 'clock'
  | 'clock-approx'
  | 'arrow-up'
  | 'arrow-down'
  | 'circle-slash'
  | 'phone'
  | 'steering-wheel'
  | 'continuous-up'
  | 'continuous-down'
  | 'document'
  | 'sign'
  | 'ruler';

const SVG_OPEN =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

/** Unset: a faint dot, so the slot keeps its position without claiming a value. */
export function renderFlagDotIcon(sizeClass = 'h-3 w-3'): string {
  return `${SVG_OPEN} class="${sizeClass}"><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" /></svg>`;
}

/** timepoint=1: an exact time. */
export function renderClockIcon(sizeClass = 'h-3 w-3'): string {
  return `${SVG_OPEN} class="${sizeClass}"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>`;
}

/** timepoint=0: an approximate time, the clock with a tilde under it. */
export function renderApproxClockIcon(sizeClass = 'h-3 w-3'): string {
  return `${SVG_OPEN} class="${sizeClass}"><circle cx="12" cy="10" r="7" /><path d="M12 6v4l2.5 1.5" /><path d="M5 21c1-1.5 2-1.5 3 0s2 1.5 3 0 2-1.5 3 0 2 1.5 3 0" /></svg>`;
}

/** pickup_type default: boarding here. */
export function renderArrowUpIcon(sizeClass = 'h-3 w-3'): string {
  return `${SVG_OPEN} class="${sizeClass}"><path d="M12 20V5M6 11l6-6 6 6" /></svg>`;
}

/** drop_off_type default: alighting here. */
export function renderArrowDownIcon(sizeClass = 'h-3 w-3'): string {
  return `${SVG_OPEN} class="${sizeClass}"><path d="M12 4v15M6 13l6 6 6-6" /></svg>`;
}

/** pickup_type / drop_off_type 1: not available. */
export function renderCircleSlashIcon(sizeClass = 'h-3 w-3'): string {
  return `${SVG_OPEN} class="${sizeClass}"><circle cx="12" cy="12" r="9" /><path d="M6 18L18 6" /></svg>`;
}

/** Value 2: phone the agency to arrange it. */
export function renderPhoneIcon(sizeClass = 'h-3 w-3'): string {
  return `${SVG_OPEN} class="${sizeClass}"><path d="M6 3h4l2 5-2.5 1.5a12 12 0 005 5L16 12l5 2v4a2 2 0 01-2.2 2A17 17 0 014 5.2 2 2 0 016 3z" /></svg>`;
}

/** Value 3: coordinate with the driver. */
export function renderSteeringWheelIcon(sizeClass = 'h-3 w-3'): string {
  return `${SVG_OPEN} class="${sizeClass}"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><path d="M12 3v6M4.5 16.5l5-2.5M19.5 16.5l-5-2.5" /></svg>`;
}

/**
 * continuous_pickup=0: pickup anywhere along the line to the next stop. Rotate
 * it for the drop-off direction rather than shipping a mirrored copy.
 */
export function renderContinuousArrowIcon(sizeClass = 'h-3 w-3'): string {
  return `${SVG_OPEN} class="${sizeClass}"><path d="M3 20h18" /><path d="M12 16V5M8 9l4-4 4 4" /></svg>`;
}

/** A booking rule is attached; the tooltip carries the id. */
export function renderDocumentIcon(sizeClass = 'h-3 w-3'): string {
  return `${SVG_OPEN} class="${sizeClass}"><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h6M10 16h6" /></svg>`;
}

/** stop_headsign is set; the tooltip carries the text. */
export function renderSignIcon(sizeClass = 'h-3 w-3'): string {
  return `${SVG_OPEN} class="${sizeClass}"><rect x="3" y="5" width="18" height="8" rx="1" /><path d="M12 13v7M9 20h6" /></svg>`;
}

/** shape_dist_traveled is set; the tooltip carries the value. */
export function renderRulerIcon(sizeClass = 'h-3 w-3'): string {
  return `${SVG_OPEN} class="${sizeClass}"><rect x="2" y="8" width="20" height="8" rx="1" /><path d="M7 8v3M12 8v4M17 8v3" /></svg>`;
}

/** The one place a glyph name becomes markup. */
export function renderFlagGlyph(
  glyph: FlagGlyph,
  sizeClass = 'h-3 w-3'
): string {
  switch (glyph) {
    case 'dot':
      return renderFlagDotIcon(sizeClass);
    case 'clock':
      return renderClockIcon(sizeClass);
    case 'clock-approx':
      return renderApproxClockIcon(sizeClass);
    case 'arrow-up':
      return renderArrowUpIcon(sizeClass);
    case 'arrow-down':
      return renderArrowDownIcon(sizeClass);
    case 'circle-slash':
      return renderCircleSlashIcon(sizeClass);
    case 'phone':
      return renderPhoneIcon(sizeClass);
    case 'steering-wheel':
      return renderSteeringWheelIcon(sizeClass);
    case 'continuous-up':
      return renderContinuousArrowIcon(sizeClass);
    case 'continuous-down':
      return renderContinuousArrowIcon(`${sizeClass} rotate-180`);
    case 'document':
      return renderDocumentIcon(sizeClass);
    case 'sign':
      return renderSignIcon(sizeClass);
    case 'ruler':
      return renderRulerIcon(sizeClass);
  }
}
