/**
 * The bits `SpeakerRow` and `SegmentCard` share. Kept apart from either so both of those
 * files export components and nothing else.
 */

import { autoInk } from '../lib/contrast';

/** The drag payload is the row's index as text — no drag library, no custom MIME. */
export const DRAG_MIME = 'text/plain';

/** A read of the speaker's colour that never lands on a clock core — chips only. */
export function speakerChipStyle(color: string): { background: string; color: string } {
  return { background: color, color: autoInk(color) };
}
