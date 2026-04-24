import React from 'react';
import Svg, { Circle, Path, Ellipse, Defs, LinearGradient, Stop, RadialGradient } from 'react-native-svg';

/**
 * GlobeIcon — SF-Symbol-style premium globe used on Profile → Portfolio.
 *
 * Apple SF Symbol `globe.americas` aesthetic:
 *   • Perfect circle outline
 *   • Equator (horizontal line spanning the full disc)
 *   • Symmetric meridian ellipse (one vertical, curved, producing the
 *     signature four-quadrant read at small sizes)
 *   • Rounded linecaps / joins — matches native SF symbols
 *
 * Active variant (PRD: "premium gold/amber tint + modern iOS/Android feel"):
 *   • Gold stroke (#F5A623)
 *   • Soft radial halo behind the disc — pushes it forward on dark surfaces
 *   • Slightly heavier stroke (1.6 instead of 1.4) so it reads as "lit up"
 *     rather than muted
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
  const baseStroke = weight === 'thin' ? 1.1 : weight === 'bold' ? 1.9 : 1.4;
  // Active state gets slightly heavier stroke so the gold reads as emphasis.
  const strokeWidth = active ? baseStroke + 0.2 : baseStroke;
  const resolved = active ? '#F5A623' : color;
  const haloId = `globeHalo_${Math.round(size * 10)}_${active ? 'a' : 'i'}`;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {active && (
        <Defs>
          <RadialGradient id={haloId} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#F5A623" stopOpacity="0.32" />
            <Stop offset="0.6" stopColor="#F5A623" stopOpacity="0.08" />
            <Stop offset="1" stopColor="#F5A623" stopOpacity="0" />
          </RadialGradient>
        </Defs>
      )}

      {/* Gold halo backdrop for active state */}
      {active && (
        <Circle cx="12" cy="12" r="11.5" fill={`url(#${haloId})`} />
      )}

      {/* Outer disc */}
      <Circle
        cx="12"
        cy="12"
        r="9"
        stroke={resolved}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />

      {/* Equator */}
      <Path
        d="M3 12 H21"
        stroke={resolved}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />

      {/* Meridian — one symmetric ellipse. Creates the iconic 4-quadrant
          look at glance size while keeping the icon uncluttered. */}
      <Ellipse
        cx="12"
        cy="12"
        rx="5"
        ry="9"
        stroke={resolved}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}
