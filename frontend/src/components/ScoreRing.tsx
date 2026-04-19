import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, font } from '../theme';

export default function ScoreRing({
  score,
  size = 56,
  strokeWidth = 5,
  label,
}: {
  score: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
}) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const offset = c * (1 - pct);
  const color = score >= 80 ? colors.success : score >= 60 ? colors.primary : colors.secondary;

  return (
    <View style={{ width: size, alignItems: 'center' }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={colors.border}
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="transparent"
            strokeDasharray={`${c}, ${c}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <View style={StyleSheet.absoluteFill as any}>
          <View style={styles.center}>
            <Text style={[styles.value, { color }]}>{Math.round(score)}</Text>
          </View>
        </View>
      </View>
      {label && <Text style={styles.label}>{label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  value: {
    fontFamily: font.bodyBold,
    fontSize: 16,
  },
  label: {
    marginTop: 6,
    color: colors.textSecondary,
    fontFamily: font.bodyMedium,
    fontSize: 11,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
});
