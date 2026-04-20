/**
 * ScoutAIAvatar — premium gold-on-dark badge used anywhere the Scout AI
 * assistant appears. Rendered in SVG so it stays sharp at any size and loads
 * instantly with no asset fetch. Clearly distinct from human photographer
 * avatars per the product rules ("never pretend to be a human").
 */
import React from 'react';
import Svg, { Circle, Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { View } from 'react-native';

type Props = {
  size?: number;
  testID?: string;
};

export default function ScoutAIAvatar({ size = 40, testID }: Props) {
  // The glyph combines three ideas from the spec:
  //   · radar-sweep sphere  → "scout"
  //   · center map pin dot  → "location"
  //   · subtle spark arc    → "AI"
  // Gold #F5A623 on near-black #0F0F12 — PhotoScout's premium palette.
  const s = size;
  return (
    <View testID={testID} style={{ width: s, height: s }}>
      <Svg width={s} height={s} viewBox="0 0 48 48">
        <Defs>
          <LinearGradient id="scoutRing" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#F5A623" />
            <Stop offset="1" stopColor="#C77D11" />
          </LinearGradient>
          <LinearGradient id="scoutBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#1B1B20" />
            <Stop offset="1" stopColor="#0A0A0C" />
          </LinearGradient>
        </Defs>
        {/* Dark base */}
        <Circle cx="24" cy="24" r="23" fill="url(#scoutBg)" stroke="url(#scoutRing)" strokeWidth="1.5" />
        {/* Radar rings */}
        <Circle cx="24" cy="24" r="14" stroke="#F5A623" strokeWidth="1" fill="none" opacity="0.45" />
        <Circle cx="24" cy="24" r="9" stroke="#F5A623" strokeWidth="1" fill="none" opacity="0.65" />
        {/* Sweep arc (spark) */}
        <Path
          d="M24 24 L38 24 A14 14 0 0 0 30.5 12.3 Z"
          fill="#F5A623"
          opacity="0.22"
        />
        {/* Center pin */}
        <Circle cx="24" cy="24" r="3.2" fill="#F5A623" />
        <Circle cx="24" cy="24" r="1.3" fill="#0A0A0C" />
      </Svg>
    </View>
  );
}
