/**
 * A speaker, drawn the way the Unity app draws one.
 *
 * `Speaker.prefab` is a `Debator Icon` sprite tinted with the side colour, carrying four
 * overlays that are alpha-0 at rest and faded in by the animator:
 *
 *   Speech Bubble   speaking            Speak.anim,      alpha 0 -> 1 over 0.167s
 *   Next indicator  up next             NextAppear.anim, alpha 0 -> 1 over 0.167s
 *                                       NextFlash.anim,  x -30 -> -38 -> -28 -> -30, 1s loop
 *   Clipboard       prep phase          shown for every speaker
 *   Group           free debate         shown for every speaker
 *
 * The original mirrors the con side with `localScale = (-1, 1, 1)` and then flips the
 * number child back. That is a layout decision, so it is `row-reverse` here — no
 * transforms, no double flip, and the number never ends up backwards.
 *
 * The PNGs are used as CSS masks rather than <img>, which is what reproduces Unity's
 * `Image.color` tint: the sprite supplies the silhouette, the token supplies the colour.
 */
import './unity.css';

export type DebaterState = 'idle' | 'speaking' | 'next' | 'done';
export type DebaterOverlay = 'none' | 'prep' | 'free';

export interface DebaterProps {
  /** 'A' paints --side-a; 'B' paints --side-b. */
  side: 'A' | 'B';
  /** The speaker's own label — the original shows a bare index, we can show the name. */
  index: number;
  name?: string;
  state: DebaterState;
  /** Phase overlays the original shows on every figure at once. */
  overlay?: DebaterOverlay;
  /** True once the current speaker's clock has run out — drives the arrow's 1s bob. */
  urgent?: boolean;
  onSelect?: () => void;
}

export function Debater({
  side,
  index,
  name,
  state,
  overlay = 'none',
  urgent = false,
  onSelect,
}: DebaterProps) {
  const Tag = onSelect ? 'button' : 'div';
  return (
    <Tag
      className={`udeb udeb--${side === 'A' ? 'a' : 'b'}`}
      data-state={state}
      data-overlay={overlay}
      data-urgent={urgent ? '' : undefined}
      {...(onSelect ? { type: 'button' as const, onClick: onSelect } : {})}
    >
      <span className="udeb__stack">
        <span className="udeb__figure" aria-hidden="true" />
        <span className="udeb__num" aria-hidden="true">
          {index}
        </span>
        {/* Speaking. */}
        <span className="udeb__badge udeb__badge--speech" aria-hidden="true" />
        {/* Up next — this is the one that bobs. */}
        <span className="udeb__badge udeb__badge--next" aria-hidden="true" />
        {/* Phase overlays, shown across the whole roster. */}
        <span className="udeb__badge udeb__badge--clipboard" aria-hidden="true" />
        <span className="udeb__badge udeb__badge--group" aria-hidden="true" />
      </span>
      {name === undefined ? null : <span className="udeb__name">{name}</span>}
    </Tag>
  );
}
