/**
 * The module-level overlay stack. It lives apart from `Overlay.tsx` so that file exports
 * components and nothing else.
 *
 * Esc only ever closes the TOP overlay, which is why this is one shared stack rather than
 * a per-overlay listener: the share sheet over the editor over the console has to unwind
 * in the order it was built.
 */

const stack: symbol[] = [];

/** How many overlays are open. Screens use it to park their own Esc handling. */
export function overlayDepth(): number {
  return stack.length;
}

/** Register a newly opened overlay. */
export function pushOverlay(token: symbol): void {
  stack.push(token);
}

/** Remove an overlay from the stack, wherever it sits. */
export function removeOverlay(token: symbol): void {
  const i = stack.indexOf(token);
  if (i >= 0) stack.splice(i, 1);
}

/** True when `token` is the overlay Esc should close. */
export function isTopOverlay(token: symbol): boolean {
  return stack[stack.length - 1] === token;
}
