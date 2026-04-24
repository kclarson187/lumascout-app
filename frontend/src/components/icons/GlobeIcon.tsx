import React from 'react';
import Svg, { Circle, Path, Ellipse, Defs, LinearGradient, Stop } from 'react-native-svg';

/**
 * GlobeIcon — SF-Symbol-style premium globe used on Profile → Portfolio.
 *
 * Design rationale (PRD: "make it feel expensive"):
 *   • Geometry: perfect circle outline + equator ellipse + 2 symmetric
 *     meridian curves, producing the iconic four-quadrant look of Apple's
 *     globe.americas SF Symbol without copying it outright.
 *   • Weight: 1.4 stroke (Apple's "thin / regular" hybrid). Looks crisp at
 *     14–24px sizing without feeling brittle on low-DPI Androids.
 *   • Color: takes one `color` prop — everything inside uses it, so a parent
 *     can hand it down from the theme. For the "active" state we also apply
 *     a subtle radial glow behind the disc (gold on gold tokens).
 *   • Linecap: round; linejoin: round — matches the feel of SF Symbols.
 *
 * Props:
 *   size    — target square size in px (default 16)
 *   color   — stroke color (default handed down from caller)
 *   active  — true to render gold tint + soft halo
 *   weight  — 'thin' | 'regular' | 'bold' → stroke widths 1.1 / 1.4 / 1.9
 */
export default function GlobeIcon({
  size = 16,
  color = '#8A8F99',
  active = false,
  weight = 'regular',
}: {
  size?: number;
  color?: string;
  active?: boolean;
  weight?: 'thin' | 'regular' | 'bold';
}) {
  const strokeWidth = weight === 'thin' ? 1.1 : weight === 'bold' ? 1.9 : 1.4;
  const resolved = active ? '#F5A623' : color;
  const haloId = `globeHalo_${Math.round(size)}_${active ? 'a' : 'i'}`;

  // Canvas is 24x24 so the geometry reads identically at every size.
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {active && (
        <Defs>
          <LinearGradient id={haloId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#F5A623" stopOpacity="0.22" />
            <Stop offset="1" stopColor="#F5A623" stopOpacity="0.02" />
          </LinearGradient>
        </Defs>
      )}

      {/* Subtle gold halo for the active state — pushes the icon forward on
          dark surfaces without turning it into a filled disc. */}
      {active && (
        <Circle cx="12" cy="12" r="10.5" fill={`url(#${haloId})`} />
      )}

      {/* Outer disc */}
      <Circle
        cx="12"
        cy="12"
        r="9"
        stroke={resolved}
        strokeWidth={strokeWidth}
      />

      {/* Equator */}
      <Path
        d="M3 12 H21"
        stroke={resolved}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />

      {/* Left meridian — curved ellipse half */}
      <Ellipse
        cx="12"
        cy="12"
        rx="5"
        ry="9"
        stroke={resolved}
        strokeWidth={strokeWidth}
      />
    </Svg>
  );
}
