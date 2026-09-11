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
 * Every overlay sits in the prefab's own RectTransform, measured out of a render of the
 * scene with the speakers spawned — the numbers are in unity.css. The con side is spawned
 * with `localScale.x = -1`, so its boxes reflect about the figure and its sprites mirror;
 * the number is flipped back there, and simply never flipped here.
 *
 * Nothing is printed beside the figure. The tint says which side, the number says which
 * speaker, and the bubble and the arrow say who has the floor and who is next. The name
 * and state are still read out to assistive tech.
 */
import './unity.css';

export type DebaterState = 'idle' | 'speaking' | 'next' | 'done';
export type DebaterOverlay = 'none' | 'prep' | 'free';

export interface DebaterProps {
  /** 'A' paints --side-a; 'B' paints --side-b. */
  side: 'A' | 'B';
  /** The roster number printed on the figure, 1-based within the side. */
  index: number;
  /** Read to assistive tech only — never drawn. */
  srLabel?: string;
  state: DebaterState;
  /** Phase overlays the original shows on every figure at once. */
  overlay?: DebaterOverlay;
  /** True once the live clock has run out: the arrow bobs and the figure steps up to full. */
  urgent?: boolean;
  onSelect?: () => void;
}

export function Debater({
  side,
  index,
  srLabel,
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
      {srLabel === undefined ? null : <span className="u-sr">{srLabel}</span>}
    </Tag>
  );
}
