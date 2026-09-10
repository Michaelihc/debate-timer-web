/**
 * One inline SVG sprite. Every glyph is drawn by hand on a 16px grid with 1.5px strokes
 * and square caps, so the icons share the silkscreened-panel language of the rest of the
 * app instead of importing somebody else's rounded icon set.
 *
 * There are no emoji anywhere in this app: an emoji is a third party's typeface, renders
 * differently on every machine in the venue, and cannot take `currentColor`.
 *
 * Render `<IconSprite />` once (the shell does it) and `<Icon name="play" />` anywhere.
 */

import type { JSX } from 'react';

import { ICON_NAMES, PATHS, type IconName } from './iconPaths';

import './ui.css';

export type { IconName } from './iconPaths';

/** Mount once per document, above everything that uses `<Icon>`. */
export function IconSprite(): JSX.Element {
  return (
    <svg className="icon-sprite" aria-hidden="true" focusable="false" width="0" height="0">
      <defs>
        {ICON_NAMES.map((name) => (
          <symbol key={name} id={`i-${name}`} viewBox="0 0 16 16">
            <path d={PATHS[name]} />
          </symbol>
        ))}
      </defs>
    </svg>
  );
}

export interface IconProps {
  name: IconName;
  /** px. Defaults to 16 — the grid the glyphs were drawn on. */
  size?: number;
  className?: string;
  /** Supply only when the icon is the sole label; otherwise it stays decorative. */
  title?: string;
}

export function Icon({ name, size = 16, className, title }: IconProps): JSX.Element {
  const labelled = title !== undefined;
  return (
    <svg
      className={className === undefined ? 'icon' : `icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      focusable="false"
      aria-hidden={labelled ? undefined : true}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? title : undefined}
    >
      <use href={`#i-${name}`} />
    </svg>
  );
}
