import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';

/**
 * Read-only mini-map card with a pin at a single coordinate. Used after a
 * user picks a location (searched place, dropped pin, manual entry, or GPS)
 * to give them instant spatial confirmation BEFORE committing to save.
 *
 * react-native-maps is loaded LAZILY on mount so an absent native binary
 * (Expo Go on some platforms) falls back gracefully to a text card.
 * A sibling `.web.tsx` file handles the web target — this file never
 * requires react-native-maps on web.
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
  const [mapsMod, setMapsMod] = useState<{ MapView: any; Marker: any } | null>(null);
  const [mapsFailed, setMapsFailed] = useState(false);

  useEffect(() => {
    if (mapsMod || mapsFailed || Platform.OS === 'web') return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('react-native-maps');
      if (mod && mod.default) {
        setMapsMod({ MapView: mod.default, Marker: mod.Marker });
      } else {
        setMapsFailed(true);
      }
    } catch {
      setMapsFailed(true);
    }
  }, [mapsMod, mapsFailed]);

  const lat = Number(latitude);
  const lng = Number(longitude);
  const hasValid = Number.isFinite(lat) && Number.isFinite(lng) && !(Math.abs(lat) < 1e-4 && Math.abs(lng) < 1e-4);

  if (!hasValid) return null;

  // Native + map module loaded
  if (mapsMod && Platform.OS !== 'web') {
    const { MapView, Marker } = mapsMod;
    return (
      <View style={[styles.wrap, { height }]} testID={testID || 'map-preview'}>
        <MapView
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
          initialRegion={{
            latitude: lat,
            longitude: lng,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
          toolbarEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          scrollEnabled={false}
          zoomEnabled={false}
          liteMode
        >
          <Marker
            coordinate={{ latitude: lat, longitude: lng }}
            pinColor={colors.primary}
          />
        </MapView>
        <View pointerEvents="none" style={styles.coordBadge}>
          <MapPin size={10} color={colors.primary} />
          <Text style={styles.coordBadgeTxt} numberOfLines={1}>
            {lat.toFixed(5)}, {lng.toFixed(5)}
          </Text>
        </View>
      </View>
    );
  }

  // Fallback (web or maps-failed): tidy hero card with coords + label.
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
  wrap: {
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    position: 'relative',
  },
  coordBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  coordBadgeTxt: {
    color: '#fff',
    fontFamily: font.body,
    fontSize: 10,
  },
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
