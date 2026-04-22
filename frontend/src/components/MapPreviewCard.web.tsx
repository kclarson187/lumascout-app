import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';

/**
 * Web stub for MapPreviewCard — react-native-maps cannot be bundled for
 * web. The web target gets a styled coordinate card instead. The real
 * map preview is the sibling MapPreviewCard.tsx file, picked up
 * automatically by Metro for iOS/Android platforms.
 */
export default function MapPreviewCard({
  latitude,
  longitude,
  label,
  height = 160,
  testID,
}: {
  latitude: number;
  longitude: number;
  label?: string;
  height?: number;
  testID?: string;
}) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const hasValid = Number.isFinite(lat) && Number.isFinite(lng) && !(Math.abs(lat) < 1e-4 && Math.abs(lng) < 1e-4);
  if (!hasValid) return null;
  return (
    <View style={[styles.fallback, { height }]} testID={testID || 'map-preview-fallback'}>
      <View style={styles.fallbackPinWrap}>
        <MapPin size={24} color={colors.primary} />
      </View>
      {label ? (
        <Text style={styles.fallbackLabel} numberOfLines={2}>{label}</Text>
      ) : null}
      <Text style={styles.fallbackCoords}>
        {lat.toFixed(5)}, {lng.toFixed(5)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: space.md,
  },
  fallbackPinWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(245,166,35,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackLabel: {
    color: colors.text,
    fontFamily: font.bodySemibold,
    fontSize: 13,
    textAlign: 'center',
  },
  fallbackCoords: {
    color: colors.textTertiary,
    fontFamily: font.body,
    fontSize: 11,
  },
});
