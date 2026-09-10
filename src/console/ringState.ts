/**
 * Band → ring state. `TimerController` has ONE warning tier (`warningFGColor`), not two,
 * so `warning` and `final10` land on the same ring colour and only the digits blip.
 */

import type { Band } from '../engine/selectors';

export type RingState = 'normal' | 'warn' | 'over';

export function ringState(band: Band): RingState {
  if (band === 'over') return 'over';
  return band === 'normal' ? 'normal' : 'warn';
}
