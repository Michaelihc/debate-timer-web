/**
 * The countdown ring's geometry, kept in its own module so `RingTimer.tsx` exports
 * nothing but a component (React Fast Refresh only works on component-only files).
 *
 * Measured off the Unity `Ellipse 2` sprite: a 304px outer diameter with a 36px stroke,
 * i.e. the stroke is 11.84% of the diameter.
 */
const STROKE_RATIO = 0.1184;
const VIEW = 100;
const R = (VIEW - VIEW * STROKE_RATIO) / 2;
const CIRC = 2 * Math.PI * R;

/** The ring's geometry, for anything that needs to line up with it. */
export const RING = { viewBox: VIEW, radius: R, strokeRatio: STROKE_RATIO, circumference: CIRC };
