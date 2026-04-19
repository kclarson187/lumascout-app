import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Clock, CheckCircle2, AlertTriangle } from 'lucide-react-native';
import { colors, font, radii } from '../theme';

/**
 * Color-coded freshness pill sourced from backend fields:
 *   spot.freshness        -> 'fresh' | 'recent' | 'stale' | 'unknown'
 *   spot.freshness_label  -> e.g. 'Verified 3d ago'
 *
 * variants:
 *   - 'chip'    (default) — pill with icon + label
 *   - 'compact' — dot + short label for use inside small cards
 *   - 'inline'  — plain text with color, no pill (for meta rows)
 */
export default function FreshnessBadge({
  freshness,
  label,
  variant = 'chip',
}: {
  freshness?: string;
  label?: string | null;
  variant?: 'chip' | 'compact' | 'inline';
}) {
  if (!label || !freshness || freshness === 'unknown') return null;

  const color =
    freshness === 'fresh' ? colors.success :
    freshness === 'recent' ? colors.primary :
    colors.secondary;

  const Icon =
    freshness === 'fresh' ? CheckCircle2 :
    freshness === 'recent' ? Clock :
    AlertTriangle;

  if (variant === 'inline') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Icon size={12} color={color} />
        <Text style={[styles.inlineTxt, { color }]}>{label}</Text>
      </View>
    );
  }

  if (variant === 'compact') {
    return (
      <View style={[styles.compactPill, { borderColor: color }]}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={[styles.compactTxt, { color }]} numberOfLines={1}>{label}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.pill, { backgroundColor: colorWithAlpha(color, 0.12), borderColor: color }]}>
      <Icon size={12} color={color} />
      <Text style={[styles.txt, { color }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function colorWithAlpha(hex: string, alpha: number) {
  // Accepts a hex color (e.g. '#22c55e') and appends alpha. Falls back safely.
  if (!hex?.startsWith('#') || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  compactPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    maxWidth: 160,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  txt: { fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.3 },
  compactTxt: { fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.3 },
  inlineTxt: { fontFamily: font.bodyMedium, fontSize: 12 },
});
