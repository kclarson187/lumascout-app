/**
 * ScoutedMiniMap — Profile "Spots I've scouted" section (Jun 2025).
 *
 * Stability contract
 *  • Consumes `SafeMapView` (the existing stability wrapper) READ-ONLY.
 *  • NEVER passes cluster-* props. Plain pins only.
 *  • Wrapped in a defensive React error boundary so any native-map
 *    error falls back to a static info card with the same "View all
 *    on map" CTA — the section never breaks the profile.
 *  • Web platforms render the same static fallback (SafeMapView
 *    intentionally returns null on web).
 *
 * Privacy
 *  • Caller is expected to pre-filter spots so private/hidden spots
 *    are excluded. We additionally drop any spot with
 *    `location_display_mode === 'hidden'` or `privacy_mode === 'private'`
 *    as a defence in depth — the mini-map must NEVER leak a coordinate
 *    a viewer wouldn't see on the public spot detail page.
 *  • Pins are hard-capped (default 50) so a creator with thousands of
 *    spots can't tank scroll perf.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { MapPin, ChevronRight } from 'lucide-react-native';
import { router } from 'expo-router';
import { colors, font, space, radii } from '../theme';

import SafeMapView from './SafeMapView';
import { Marker } from './maps-module';

export interface ScoutedPin {
  spot_id: string;
  latitude: number;
  longitude: number;
  title?: string;
  privacy_mode?: string;
  location_display_mode?: string;
}

interface Props {
  spots: ScoutedPin[];
  /** Max pins rendered. Defaults to 50. */
  limit?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Defensive error boundary
// ─────────────────────────────────────────────────────────────────────

class MapErrorBoundary extends React.Component<
  { spotsCount: number; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: any) {
    // Surface to logs but never throw — the rest of the profile must keep working.
    // eslint-disable-next-line no-console
    console.warn('[ScoutedMiniMap] map render failed, falling back', err);
  }
  render() {
    if (this.state.hasError) return <StaticFallback spotsCount={this.props.spotsCount} />;
    return this.props.children as any;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Static fallback (web platforms + native error)
// ─────────────────────────────────────────────────────────────────────

function StaticFallback({ spotsCount }: { spotsCount: number }) {
  return (
    <View style={styles.fallback}>
      <View style={styles.fallbackGlyph}>
        <MapPin size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.fallbackTitle}>
          {spotsCount > 0
            ? `${spotsCount} spot${spotsCount === 1 ? '' : 's'} scouted`
            : 'Scout your first spot'}
        </Text>
        <Text style={styles.fallbackSub} numberOfLines={2}>
          {spotsCount > 0
            ? 'Open Explore to see your contributions on the full interactive map.'
            : 'Once you add a spot, it appears here on a mini map.'}
        </Text>
      </View>
      <ChevronRight size={16} color={colors.textTertiary} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section card
// ─────────────────────────────────────────────────────────────────────

export default function ScoutedMiniMap({ spots, limit = 50 }: Props) {
  // Defence in depth — drop anything the viewer shouldn't see.
  const safePins = useMemo(() => {
    const out: ScoutedPin[] = [];
    for (const s of spots || []) {
      if (!s) continue;
      const lat = Number(s.latitude);
      const lng = Number(s.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if ((s.privacy_mode || '').toLowerCase() === 'private') continue;
      if ((s.location_display_mode || '').toLowerCase() === 'hidden') continue;
      out.push({ ...s, latitude: lat, longitude: lng });
      if (out.length >= limit) break;
    }
    return out;
  }, [spots, limit]);

  // Hook ordering rule — compute `region` BEFORE the conditional
  // returns below. Otherwise switching from "no pins" to "has pins"
  // would shift the hook count between renders and React would throw
  // "rendered more hooks than during the previous render". Always
  // call hooks unconditionally.
  const region = useMemo(() => computeRegion(safePins), [safePins]);

  // Header is rendered in both states so the section is always present
  // (the user spec wants a polished empty state, not a missing block).
  const header = (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.kicker}>Spots I've scouted</Text>
        <Text style={styles.title} numberOfLines={1}>
          {safePins.length > 0
            ? `${safePins.length} location${safePins.length === 1 ? '' : 's'} on the map`
            : 'No spots yet'}
        </Text>
      </View>
      <Pressable
        onPress={() => router.push('/(tabs)/explore' as any)}
        style={styles.viewAllBtn}
        testID="scouted-view-all"
      >
        <Text style={styles.viewAllTxt}>View all on map</Text>
        <ChevronRight size={14} color={colors.primary} />
      </Pressable>
    </View>
  );

  // No pins → polished empty state (no map needed).
  if (safePins.length === 0) {
    return (
      <View style={styles.card}>
        {header}
        <View style={styles.emptyStateBox}>
          <View style={styles.fallbackGlyph}>
            <MapPin size={20} color={colors.textTertiary} />
          </View>
          <Text style={styles.emptyTitle}>Scout your first spot</Text>
          <Text style={styles.emptySub}>Spots you add appear here on a mini map of your work.</Text>
        </View>
      </View>
    );
  }

  // Web platforms get the static fallback (SafeMapView returns null there).
  // We don't try to render a Leaflet-on-web fallback to keep risk to zero.
  const isWeb = Platform.OS === 'web';

  return (
    <View style={styles.card}>
      {header}
      <View style={styles.mapWrap}>
        {isWeb ? (
          <StaticFallback spotsCount={safePins.length} />
        ) : (
          <MapErrorBoundary spotsCount={safePins.length}>
            <SafeMapView
              style={StyleSheet.absoluteFillObject}
              initialRegion={region}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              pointerEvents="none"
              testID="scouted-mini-map"
              // Map type — keep default (street). Premium dark style is
              // applied automatically by the host app's MapView config.
            >
              {Marker
                ? safePins.map((p) => (
                    <Marker
                      key={p.spot_id}
                      coordinate={{ latitude: p.latitude, longitude: p.longitude }}
                      pinColor={colors.primary as any}
                      tracksViewChanges={false}
                    />
                  ))
                : null}
            </SafeMapView>
          </MapErrorBoundary>
        )}

        {/* Tap layer over the map → push to Explore (the map itself is
            non-interactive on purpose so a stray pan never crashes). */}
        <Pressable
          onPress={() => router.push('/(tabs)/explore' as any)}
          style={StyleSheet.absoluteFillObject}
          testID="scouted-mini-map-press"
        />
      </View>
    </View>
  );
}

/** Compute a viewport that covers all pins with a comfortable padding.
 *  Falls back to a continental-US default if no pins, or to a 5°
 *  centered region for a single pin. */
function computeRegion(pins: ScoutedPin[]) {
  if (!pins.length) {
    return { latitude: 39.8283, longitude: -98.5795, latitudeDelta: 60, longitudeDelta: 60 };
  }
  if (pins.length === 1) {
    return { latitude: pins[0].latitude, longitude: pins[0].longitude, latitudeDelta: 2.5, longitudeDelta: 2.5 };
  }
  let minLat = +Infinity, maxLat = -Infinity, minLng = +Infinity, maxLng = -Infinity;
  for (const p of pins) {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLng) minLng = p.longitude;
    if (p.longitude > maxLng) maxLng = p.longitude;
  }
  const latitudeDelta = Math.max(0.5, (maxLat - minLat) * 1.6 + 0.1);
  const longitudeDelta = Math.max(0.5, (maxLng - minLng) * 1.6 + 0.1);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.min(latitudeDelta, 60),
    longitudeDelta: Math.min(longitudeDelta, 60),
  };
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: space.xl,
    marginTop: space.lg,
    padding: space.lg,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  kicker: {
    color: colors.kicker,
    fontFamily: font.bodySemibold,
    fontSize: 10,
    letterSpacing: 0.4,
  },
  title: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 18,
    letterSpacing: -0.2,
    marginTop: 2,
  },
  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(245,166,35,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.32)',
  },
  viewAllTxt: {
    color: colors.primary,
    fontFamily: font.bodySemibold,
    fontSize: 11,
  },
  mapWrap: {
    height: 180,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
    position: 'relative',
  },
  fallback: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  fallbackGlyph: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  fallbackTitle: {
    color: colors.text,
    fontFamily: font.bodySemibold,
    fontSize: 13.5,
  },
  fallbackSub: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  emptyStateBox: {
    alignItems: 'center',
    paddingVertical: 18,
    gap: 6,
  },
  emptyTitle: {
    color: colors.text,
    fontFamily: font.bodySemibold,
    fontSize: 13.5,
    marginTop: 6,
  },
  emptySub: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});
