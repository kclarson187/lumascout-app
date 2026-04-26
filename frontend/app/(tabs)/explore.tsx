import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform,
  ActivityIndicator, ScrollView, Modal, Switch, Image, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Search, List, Map as MapIcon, SlidersHorizontal, Locate, X, Shield, Gem, Sun, Users as UsersIcon, MapPin, Navigation, RefreshCw, ArrowUpRight, Layers, Bookmark, Flame, Camera, Plane, Cloud, Heart, Share2 as ShareIcon, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { formatDistance } from '../../src/utils/distance';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import SpotCard from '../../src/components/SpotCard';
import { Chip, EmptyState } from '../../src/components/ui';
import { Button } from '../../src/components/Button';
import ScoutAICard from '../../src/components/ScoutAICard';
import {
  SmartAlertChip,
  NearbyRightNowList,
  TrendingNearbyList,
  GoldenHourRail,
} from '../../src/components/PremiumExploreRails';
import { PremiumMapPin, PremiumMapCluster, pinTierOf } from '../../src/components/PremiumMapPin';
import MAP_STYLE_DARK from '../../src/components/mapStyleDark';

// Native-only map wrapper with web stub (Metro / codegenNativeCommands safety).
import { MapView, ClusteredMapView, Marker } from '../../src/components/maps-module';
import { Linking } from 'react-native';

type Filters = {
  shoot_type?: string;
  best_time_of_day?: string;
  best_season?: string;
  dog_friendly?: boolean;
  kid_friendly?: boolean;
  accessible?: boolean;
  indoor?: boolean;
  permit_required?: boolean;
  fee_required?: boolean;
  verified_recently?: boolean;
  hidden_gem?: boolean;
  proven_spot?: boolean;
  min_rating?: number;
  min_parking_ease?: number;
  max_walking_distance?: number;
  max_crowd_level?: number;
  min_sunrise_strength?: number;
  min_sunset_strength?: number;
  min_morning_golden?: number;
  min_evening_golden?: number;
  min_variety?: number;
};

const SHOOT_TYPES = ['Family', 'Pet', 'Wedding', 'Portrait', 'Seniors', 'Branding', 'Nature', 'Urban', 'Travel', 'Lifestyle'];
const SEASONS: string[] = []; // Apr 2026 cleanup: month/season filter removed; constant retained as no-op for backwards compat with any downstream import.

export default function Explore() {
  const [spots, setSpots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'map' | 'list'>(Platform.OS === 'web' ? 'list' : 'map');
  const [filters, setFilters] = useState<Filters>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedSpot, setSelectedSpot] = useState<any | null>(null);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number; ts: number } | null>(null);
  // FIX(2026-04 Item #3 round 3): GPS state machine for the trust strip.
  // 'idle' | 'requesting' | 'granted' | 'denied' | 'error'
  const [gpsState, setGpsState] = useState<'idle' | 'requesting' | 'granted' | 'denied' | 'error'>('idle');
  // "Search this area" CTA — surfaces when the user pans the map far enough
  // from the current load center. Tracked here to avoid prop-drilling.
  const [showSearchArea, setShowSearchArea] = useState(false);
  // Map type cycler — Standard → Hybrid → Standard. Apple-style "Layers".
  const [mapType, setMapType] = useState<'standard' | 'hybrid'>('standard');
  // Niche selector embedded in the compact location chip row (replaces
  // the 8-chip ScrollView in map mode for a tighter Apple-quality header).
  const [nicheOpen, setNicheOpen] = useState(false);
  // Local optimistic save state — keyed by spot_id. Lets the bottom sheet
  // Save button feel instant without re-fetching the spots list.
  const [savedIds, setSavedIds] = useState<Record<string, boolean>>({});
  const lastLoadCenter = useRef<{ lat: number; lng: number } | null>(null);
  const currentRegion = useRef<any>(null);
  const mapRef = useRef<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { limit: 200, sort: 'quality' };
      Object.entries(filters).forEach(([k, v]) => {
        if (v != null && v !== '' && v !== false) params[k] = v;
      });
      // FIX(2026-04 Item #3 round 3): always pass user GPS to /spots
      // when we have it. Without coords, backend returns null distance
      // (distance_source='unavailable') and the UI shows the trust
      // strip "Enable location for accurate nearby spots".
      const fresh = userCoords && (Date.now() - userCoords.ts < 30 * 60 * 1000);
      if (fresh) {
        params.lat = userCoords!.lat;
        params.lng = userCoords!.lng;
      }
      const data = await api.get('/spots', params);
      setSpots(data);
    } finally { setLoading(false); }
  }, [filters, userCoords]);

  useEffect(() => { load(); }, [load]);

  // Refresh when the Explore tab regains focus (e.g., after returning from
  // the Admin Cover Editor or Admin Spot Menu actions).
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Request location on mount so the map opens tight and local, not a continent-wide view.
  // FIX(2026-04 Item #3 round 3): explicit GPS state machine so the
  // trust strip can show "Using current location" / "Location off /
  // Enable" + retry. Cached fresh coord (<5 min) skip re-prompt.
  const requestGPS = useCallback(async () => {
    setGpsState('requesting');
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        perm = await Location.requestForegroundPermissionsAsync();
      }
      if (perm.status !== 'granted') {
        setGpsState('denied');
        return;
      }
      // Try high-accuracy with 8s timeout; fall back to balanced.
      const loc = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('gps_timeout')), 8000)),
      ]).catch(async () =>
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      );
      const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude, ts: Date.now() };
      setUserCoords(coords);
      setGpsState('granted');
      if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: coords.lat, longitude: coords.lng,
          latitudeDelta: 0.45, longitudeDelta: 0.45,
        }, 300);
      }
    } catch {
      setGpsState('error');
    }
  }, []);

  useEffect(() => { requestGPS(); }, [requestGPS]);

  const goToCurrent = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: loc.coords.latitude, longitude: loc.coords.longitude,
          latitudeDelta: 0.3, longitudeDelta: 0.3,
        }, 400);
      }
    } catch {}
  };

  // Pin color tiering — communicate scouting value at a glance.
  const pinColor = (s: any): string => {
    const verified = s.owner?.verification_status === 'verified';
    const premium = s.privacy_mode === 'premium';
    const proven = (s.shoot_score || 0) >= 80 && (s.images?.length || 0) >= 3;
    if (premium) return '#9D59FF';          // Elite purple
    if (verified && proven) return '#10B981'; // Top-tier green
    if (verified) return colors.primary;     // Verified gold
    if (proven) return '#38BDF8';            // Proven blue
    if ((s.shoot_score || 0) < 60) return '#6B7280'; // Low score gray
    return '#F5A623';                         // Default gold
  };

  const activeCount = Object.values(filters).filter((v) => v != null && v !== false && v !== '').length;

  // Apr 2026 cleanup — simplified filter set per latest product
  // direction. Removed Golden Hour, Hidden Gems, season/time-of-day,
  // light-quality, and other micro-filters. Kept the 9 useful chips.
  const QUICK_CHIPS: Array<{ key: string; label: string; apply: () => void }> = [
    { key: 'all', label: 'All', apply: () => setFilters({}) },
    { key: 'nearby', label: 'Nearby', apply: () => setFilters((f) => ({ ...f, sort: 'distance' })) },
    { key: 'verified', label: 'Verified', apply: () => setFilters((f) => ({ ...f, verified: true })) },
    { key: 'new', label: 'New', apply: () => setFilters((f) => ({ ...f, new_only: true })) },
    { key: 'urban', label: 'Urban', apply: () => setFilters((f) => ({ ...f, niche: 'Urban' })) },
    { key: 'nature', label: 'Nature', apply: () => setFilters((f) => ({ ...f, niche: 'Nature' })) },
    { key: 'portrait', label: 'Portrait', apply: () => setFilters((f) => ({ ...f, niche: 'Portrait' })) },
    { key: 'wedding', label: 'Wedding', apply: () => setFilters((f) => ({ ...f, niche: 'Wedding' })) },
    { key: 'pet', label: 'Pet', apply: () => setFilters((f) => ({ ...f, niche: 'Pet' })) },
  ];
  const activeChip =
    filters.verified ? 'verified' :
    filters.new_only ? 'new' :
    filters.sort === 'distance' && !filters.niche ? 'nearby' :
    !filters.niche ? 'all' :
    String(filters.niche).toLowerCase();

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Premium header — matches Apr 2026 Explore PRD */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>EXPLORE</Text>
          <Text style={styles.headerTitle}>Find great places near you</Text>
        </View>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.push('/search')} testID="explore-search-icon">
          <Search size={18} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerBtn} onPress={() => setFilterOpen(true)} testID="explore-filters">
          <SlidersHorizontal size={18} color={colors.text} />
          {activeCount > 0 ? <View style={styles.badgeDot}><Text style={styles.badgeDotTxt}>{activeCount}</Text></View> : null}
        </TouchableOpacity>
      </View>

      {/* Premium segmented Map / List toggle */}
      <View style={styles.segWrap}>
        <View style={styles.seg}>
          <TouchableOpacity
            onPress={() => setView('map')}
            style={[styles.segBtn, view === 'map' && styles.segBtnActive]}
            testID="explore-seg-map"
          >
            <MapIcon size={14} color={view === 'map' ? colors.primary : colors.textSecondary} />
            <Text style={[styles.segTxt, view === 'map' && styles.segTxtActive]}>Map</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setView('list')}
            style={[styles.segBtn, view === 'list' && styles.segBtnActive]}
            testID="explore-seg-list"
          >
            <List size={14} color={view === 'list' ? colors.primary : colors.textSecondary} />
            <Text style={[styles.segTxt, view === 'list' && styles.segTxtActive]}>List</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Location + radius + niche chips (Apr 2026: ultra-compact 3-chip
          row replaces the larger 8-chip ScrollView in map mode for a
          tighter Apple-quality header). */}
      <View style={styles.locRow}>
        <View style={styles.locChip}>
          <MapPin size={12} color={colors.primary} />
          <Text style={styles.locChipTxt}>San Antonio, TX</Text>
        </View>
        <TouchableOpacity style={styles.locChip} onPress={() => setFilterOpen(true)} testID="explore-radius">
          <Text style={styles.locChipTxt}>25 mi</Text>
          <Text style={styles.locChipChev}>▾</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.locChip, filters.niche ? styles.locChipActive : null]}
          onPress={() => setNicheOpen((v) => !v)}
          testID="explore-niche"
        >
          <Text style={[styles.locChipTxt, filters.niche ? { color: colors.primary } : null]}>
            {filters.niche
              ? (filters.niche === 'golden' ? 'Golden' : String(filters.niche))
              : 'All'}
          </Text>
          <Text style={styles.locChipChev}>▾</Text>
        </TouchableOpacity>
      </View>

      {/* Niche dropdown — only mounts when toggled. In LIST mode we
          continue showing the full chip rail below; in MAP mode this
          dropdown is the sole filter surface, saving ~44px of vertical
          space (≈35% of the previous header height). */}
      {(view === 'list' || nicheOpen) ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, maxHeight: 44 }}
          contentContainerStyle={styles.chipRow}
        >
          {QUICK_CHIPS.map((c) => {
            const active = activeChip === c.key.toLowerCase();
            return (
              <TouchableOpacity
                key={c.key}
                onPress={() => { c.apply(); if (view === 'map') setNicheOpen(false); }}
                style={[styles.chip, active && styles.chipActive]}
                testID={`explore-chip-${c.key}`}
              >
                <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}

      {view === 'map' && Platform.OS !== 'web' && (ClusteredMapView || MapView) ? (
        <View style={{ flex: 1 }}>
          {React.createElement(
            ClusteredMapView || MapView,
            {
              ref: mapRef,
              style: { flex: 1 },
              initialRegion: { latitude: 30.5, longitude: -98.5, latitudeDelta: 0.8, longitudeDelta: 0.8 },
              userInterfaceStyle: 'dark',
              showsUserLocation: true,
              showsMyLocationButton: false,
              // Premium dark theme — only applies on Standard map type;
              // Apple/Google ignore custom styles in hybrid/satellite modes.
              customMapStyle: mapType === 'standard' ? MAP_STYLE_DARK : undefined,
              mapType: mapType,
              // Clustering options (no-ops on plain MapView fallback)
              clusterColor: colors.primary,
              clusterTextColor: '#1a1300',
              clusterFontFamily: font.bodyBold,
              radius: 50,
              spiderLineColor: colors.primary,
              animationEnabled: true,
              // Custom cluster — gold glowing disc with pulse ring
              renderCluster: (cluster: any) => {
                const { id, geometry, properties, onPress } = cluster;
                return (
                  <Marker
                    key={`cluster-${id}`}
                    coordinate={{
                      latitude: geometry.coordinates[1],
                      longitude: geometry.coordinates[0],
                    }}
                    onPress={onPress}
                    tracksViewChanges={false}
                    anchor={{ x: 0.5, y: 0.5 }}
                  >
                    <PremiumMapCluster count={properties.point_count} />
                  </Marker>
                );
              },
              onRegionChangeComplete: (region: any) => {
                currentRegion.current = region;
                if (!lastLoadCenter.current) {
                  lastLoadCenter.current = { lat: region.latitude, lng: region.longitude };
                  return;
                }
                const dLat = Math.abs(region.latitude - lastLoadCenter.current.lat);
                const dLng = Math.abs(region.longitude - lastLoadCenter.current.lng);
                // Surface CTA only when user has panned ~30%+ of the visible span
                const threshold = Math.max(region.latitudeDelta, region.longitudeDelta) * 0.3;
                if (dLat > threshold || dLng > threshold) setShowSearchArea(true);
              },
            },
            spots.map((s) => (
              s.latitude != null && s.longitude != null && (
                <Marker
                  key={s.spot_id}
                  coordinate={{ latitude: s.latitude, longitude: s.longitude }}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setSelectedSpot(s);
                  }}
                  tracksViewChanges={false}
                  anchor={{ x: 0.5, y: 1 }}
                  testID={`marker-${s.spot_id}`}
                >
                  <PremiumMapPin tier={savedIds[s.spot_id] ? 'saved' : pinTierOf(s)} />
                </Marker>
              )
            ))
          )}

          {/* Apr 2026 cleanup — trending floating chip removed per
              latest product direction (cleaner Apple-Maps feel,
              fewer noisy banners on the map surface). */}

          {/* Floating "Search this area" CTA — surfaces after the user pans */}
          {showSearchArea ? (
            <TouchableOpacity
              style={styles.searchAreaCta}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                if (currentRegion.current) {
                  lastLoadCenter.current = {
                    lat: currentRegion.current.latitude,
                    lng: currentRegion.current.longitude,
                  };
                }
                setShowSearchArea(false);
                load();
              }}
              testID="explore-search-area"
              activeOpacity={0.85}
            >
              <RefreshCw size={14} color="#1a1300" />
              <Text style={styles.searchAreaTxt}>Search this area</Text>
            </TouchableOpacity>
          ) : null}

          {/* Glassmorphism FAB stack — Recenter / Layers / Toggle list */}
          <View style={styles.floatControls}>
            <TouchableOpacity
              style={styles.fabGlass}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                goToCurrent();
              }}
              testID="explore-locate"
            >
              <Locate size={18} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fabGlass}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setMapType((t) => (t === 'standard' ? 'hybrid' : 'standard'));
              }}
              testID="explore-layers"
            >
              <Layers size={18} color={mapType === 'hybrid' ? colors.primary : colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fabGlass}
              onPress={() => setView('list')}
              testID="explore-toggle-list"
            >
              <List size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          {selectedSpot && (
            <PinPreview
              spot={selectedSpot}
              onClose={() => setSelectedSpot(null)}
              isSaved={!!savedIds[selectedSpot.spot_id]}
              onToggleSave={() => {
                const id = selectedSpot.spot_id;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                setSavedIds((prev) => ({ ...prev, [id]: !prev[id] }));
                api.post(`/spots/${id}/save`).catch(() => {
                  // Roll back optimistic state on error
                  setSavedIds((prev) => ({ ...prev, [id]: !prev[id] }));
                });
              }}
            />
          )}
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : spots.length === 0 ? (
            <EmptyState title="No spots match" subtitle="Loosen your filters to see more." />
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 120 }}
              showsVerticalScrollIndicator={false}
            >
              {/* Smart alert chip — surfaces newly-added spots */}
              <SmartAlertChip
                count={Math.min(2, spots.filter((s) => s.is_new).length || 2)}
                onPress={() => router.push('/search' as any)}
              />

              {/* GPS trust strip — Apr 2026 Item #3 round 3.
                  Tells the user whether 'Nearby Right Now' values are
                  computed from real device GPS or unavailable. Includes
                  a retry CTA when denied/error. */}
              <View style={styles.gpsTrust}>
                <MapPin
                  size={11}
                  color={gpsState === 'granted' ? '#22c55e' : gpsState === 'requesting' ? colors.primary : colors.textTertiary}
                />
                <Text style={[
                  styles.gpsTrustTxt,
                  gpsState === 'granted' && { color: '#22c55e' },
                  gpsState === 'requesting' && { color: colors.primary },
                ]}>
                  {gpsState === 'granted'
                    ? 'Using your current location'
                    : gpsState === 'requesting'
                      ? 'Locating you…'
                      : gpsState === 'denied'
                        ? 'Location access off · enable for accurate nearby spots'
                        : 'Distance unavailable'}
                </Text>
                {gpsState !== 'granted' && gpsState !== 'requesting' ? (
                  <Pressable onPress={requestGPS} hitSlop={8}>
                    <Text style={styles.gpsRetry}>Retry</Text>
                  </Pressable>
                ) : null}
              </View>

              {/* Section 1 — Nearby Right Now (3 stacked premium cards) */}
              <NearbyRightNowList items={spots} />

              {/* Section 2 — Trending Nearby (#1 / #2 / #3 medals) */}
              <TrendingNearbyList
                items={[...spots]
                  .sort((a, b) => (b.shoot_score || 0) - (a.shoot_score || 0))
                  .slice(0, 3)}
              />

              {/* Section 3 — Golden Hour Tonight (horizontal sunset rail) */}
              <GoldenHourRail
                items={[...spots]
                  .filter((sp) => (sp.evening_golden_hour_rating || 0) >= 3 || (sp.sunset_rating || 0) >= 3)
                  .sort(
                    (a, b) =>
                      (b.evening_golden_hour_rating || 0) -
                      (a.evening_golden_hour_rating || 0),
                  )
                  .slice(0, 8)}
              />

              {/* Tail — full editorial cards for the long-tail browse */}
              <View
                style={{
                  paddingHorizontal: space.xl,
                  marginTop: 22,
                  marginBottom: 12,
                }}
              >
                <Text
                  style={{
                    color: colors.textSecondary,
                    fontFamily: font.bodyMedium,
                    fontSize: 11,
                    letterSpacing: 0.6,
                    textTransform: 'uppercase',
                  }}
                >
                  All Nearby Spots
                </Text>
              </View>
              <View style={{ paddingHorizontal: 12, gap: space.md }}>
                {spots.slice(0, 24).map((item) => (
                  <SpotCard
                    key={item.spot_id}
                    spot={item}
                    testID={`list-spot-${item.spot_id}`}
                  />
                ))}
              </View>
            </ScrollView>
          )}
          {Platform.OS !== 'web' && (
            <TouchableOpacity
              style={[styles.fab, { position: 'absolute', right: space.xl, bottom: space.xl }]}
              onPress={() => setView('map')}
              testID="explore-toggle-map"
            >
              <MapIcon size={18} color={colors.text} />
            </TouchableOpacity>
          )}
        </View>
      )}

      <FilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        onApply={(f) => { setFilters(f); setFilterOpen(false); }}
      />
    </SafeAreaView>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ color: colors.textInverse, fontFamily: font.bodyMedium, fontSize: 9 }}>{label}</Text>
    </View>
  );
}

function PinPreview({
  spot,
  onClose,
  isSaved,
  onToggleSave,
}: {
  spot: any;
  onClose: () => void;
  isSaved?: boolean;
  onToggleSave?: () => void;
}) {
  const verified = spot.owner?.verification_status === 'verified';
  const premium = spot.privacy_mode === 'premium';
  const cover =
    spot.hero_cover_image_url ||
    (Array.isArray(spot.images)
      ? (spot.images.find((i: any) => i.is_cover)?.image_url || spot.images[0]?.image_url)
      : null);
  const score = Math.round(spot.shoot_score ?? spot.score ?? 88);
  const scoreColor =
    score >= 90 ? '#22c55e' : score >= 75 ? colors.primary : '#60A5FA';

  const openDirections = () => {
    if (spot.latitude == null || spot.longitude == null) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const label = encodeURIComponent(spot.title || 'Spot');
    const url = Platform.select({
      ios: `maps://?daddr=${spot.latitude},${spot.longitude}&q=${label}`,
      android: `geo:${spot.latitude},${spot.longitude}?q=${spot.latitude},${spot.longitude}(${label})`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${spot.latitude},${spot.longitude}`,
    }) as string;
    Linking.openURL(url).catch(() => {});
  };

  const onShare = () => {
    Haptics.selectionAsync().catch(() => {});
    const url = `https://lumascout.app/spot/${spot.spot_id}`;
    Linking.openURL(`mailto:?subject=${encodeURIComponent(spot.title)}&body=${encodeURIComponent(url)}`)
      .catch(() => {});
  };

  // Two prominent chips (gold + green) per mockup spec
  const goldChip =
    (spot.evening_golden_hour_rating || 0) >= 4
      ? { key: 'sunset', label: 'Best at Sunset', icon: Sun }
      : (spot.morning_golden_hour_rating || 0) >= 4
        ? { key: 'sunrise', label: 'Best at Sunrise', icon: Sun }
        : null;
  const greenChip =
    (spot.crowd_level || 3) <= 2
      ? { key: 'crowd', label: 'Low Crowds', icon: UsersIcon }
      : null;

  // 3 subtle tag chips (Urban / Easy Access / Great for Portraits)
  const niches: string[] = Array.isArray(spot.niches)
    ? spot.niches
    : (spot.niche ? [spot.niche] : []);
  const subtleTags: string[] = [];
  if (niches.length) subtleTags.push(...niches.slice(0, 1).map(String));
  else if (spot.type) subtleTags.push(String(spot.type));
  else subtleTags.push('Urban');
  if (spot.accessible !== false) subtleTags.push('Easy Access');
  if ((spot.score_portrait || 0) >= 4 || niches.includes('Portrait')) subtleTags.push('Great for Portraits');
  else if ((spot.evening_golden_hour_rating || 0) >= 4) subtleTags.push('Golden Hour');
  else subtleTags.push('Photogenic');

  // Item #3 Apr 2026 fix — never show fake distance. If GPS is
  // unavailable, render '—' rather than fabricating a value.
  const distMi = formatDistance(spot) || '—';

  return (
    <View style={styles.previewSheet}>
      {/* Drag indicator */}
      <View style={styles.previewHandle} />

      <View style={styles.sheetBody}>
        {/* Hero image — LEFT, 140x140 square per mockup */}
        <View style={styles.sheetHeroWrap}>
          {cover ? (
            <Image source={{ uri: cover }} style={styles.sheetHero} />
          ) : (
            <View style={[styles.sheetHero, { backgroundColor: colors.surface2 }]} />
          )}
          {/* VERIFIED pill overlay bottom-left */}
          {verified ? (
            <View style={styles.sheetVerifiedPill}>
              <Shield size={9} color="#10B981" />
              <Text style={styles.sheetVerifiedTxt}>VERIFIED</Text>
            </View>
          ) : null}
        </View>

        {/* RIGHT side — title, meta, score + chips */}
        <View style={styles.sheetRight}>
          <View style={styles.sheetTitleRow}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{spot.title}</Text>
            {verified ? (
              // Twitter-style blue verified mark
              <View style={styles.blueCheck}>
                <Text style={styles.blueCheckTxt}>✓</Text>
              </View>
            ) : null}
            <Pressable
              hitSlop={8}
              onPress={onToggleSave}
              style={styles.sheetIconBtn}
              testID="pin-preview-heart"
            >
              <Heart
                size={16}
                color={isSaved ? '#ef4444' : colors.text}
                fill={isSaved ? '#ef4444' : 'transparent'}
              />
            </Pressable>
          </View>

          <View style={styles.sheetSubRow}>
            <Text style={styles.sheetCity} numberOfLines={1}>
              {spot.city}{spot.state ? `, ${spot.state}` : ''} • {distMi} mi
            </Text>
            <Pressable
              hitSlop={8}
              onPress={onShare}
              style={[styles.sheetIconBtn, { marginLeft: 'auto' }]}
              testID="pin-preview-share"
            >
              <ShareIcon size={15} color={colors.text} />
            </Pressable>
          </View>

          {/* Score + the 2 prominent chips */}
          <View style={styles.sheetScoreRow}>
            <View style={styles.sheetScoreCol}>
              <View style={[styles.sheetScoreRing, { borderColor: scoreColor }]}>
                <Text style={[styles.sheetScoreTxt, { color: scoreColor }]}>{score}</Text>
              </View>
              <Text style={styles.sheetScoreLabel}>Score</Text>
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              {goldChip ? (
                <View style={[styles.bigChip, styles.bigChipGold]}>
                  <Sun size={11} color={colors.primary} />
                  <Text style={[styles.bigChipTxt, { color: colors.primary }]}>{goldChip.label}</Text>
                </View>
              ) : null}
              {greenChip ? (
                <View style={[styles.bigChip, styles.bigChipGreen]}>
                  <UsersIcon size={11} color="#22c55e" />
                  <Text style={[styles.bigChipTxt, { color: '#22c55e' }]}>{greenChip.label}</Text>
                </View>
              ) : null}
              {premium ? (
                <View style={[styles.bigChip, styles.bigChipElite]}>
                  <Gem size={11} color="#9D59FF" />
                  <Text style={[styles.bigChipTxt, { color: '#9D59FF' }]}>Elite</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </View>

      {/* Subtle outline tag row */}
      <View style={styles.subtleTagRow}>
        {subtleTags.slice(0, 3).map((t) => (
          <View key={t} style={styles.subtleTag}>
            <Text style={styles.subtleTagTxt}>{t}</Text>
          </View>
        ))}
      </View>

      {/* Triple-button — Save (left) | Directions GOLD (middle) | Details (right) */}
      <View style={styles.previewActions}>
        <TouchableOpacity
          style={[styles.previewBtn, styles.previewBtnSecondary, isSaved && styles.previewBtnSaved, { flex: 1 }]}
          onPress={onToggleSave}
          activeOpacity={0.85}
          testID="pin-preview-save"
        >
          <Bookmark
            size={14}
            color={isSaved ? colors.primary : colors.text}
            fill={isSaved ? colors.primary : 'transparent'}
          />
          <Text style={[styles.previewBtnSecondaryTxt, isSaved && { color: colors.primary }]}>
            {isSaved ? 'Saved' : 'Save'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.previewBtn, styles.previewBtnPrimary, { flex: 1.3 }]}
          onPress={openDirections}
          activeOpacity={0.85}
          testID="pin-preview-directions"
        >
          <Navigation size={14} color="#1a1300" />
          <Text style={styles.previewBtnPrimaryTxt}>Directions</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.previewBtn, styles.previewBtnSecondary, { flex: 1 }]}
          onPress={() => router.push(`/spot/${spot.spot_id}` as any)}
          activeOpacity={0.85}
          testID="pin-preview-details"
        >
          <Text style={styles.previewBtnSecondaryTxt}>View Details</Text>
        </TouchableOpacity>
      </View>

      {/* Floating close — keeps muscle memory; not in main visual hierarchy */}
      <TouchableOpacity style={styles.previewCloseV2} onPress={onClose} hitSlop={8}>
        <X size={14} color={colors.text} />
      </TouchableOpacity>
    </View>
  );
}

function FilterSheet({
  visible, onClose, filters, onApply,
}: { visible: boolean; onClose: () => void; filters: Filters; onApply: (f: Filters) => void }) {
  const [local, setLocal] = useState<Filters>(filters);
  useEffect(() => setLocal(filters), [filters]);

  const setNumber = (k: keyof Filters, v: number) => {
    setLocal((f) => ({ ...f, [k]: f[k] === v ? undefined : v }));
  };
  const toggle = (k: keyof Filters) => setLocal((f) => ({ ...f, [k]: f[k] ? undefined : true }));

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.modalBg}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Filters</Text>
            <TouchableOpacity onPress={onClose}><X size={22} color={colors.text} /></TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl }} showsVerticalScrollIndicator={false}>
            <Section label="Shoot type">
              {SHOOT_TYPES.map((t) => (
                <Chip key={t} label={t} active={local.shoot_type === t}
                  onPress={() => setLocal({ ...local, shoot_type: local.shoot_type === t ? undefined : t })}
                  testID={`filter-shoot-${t}`} />
              ))}
            </Section>

            {/* Apr 2026 cleanup — removed Best time of day, Best season,
                Light quality, Hidden gem, AND Access & logistics filters
                per latest product direction. The actual access/logistics
                data still lives on the spot detail page; we just no longer
                expose it as an Explore filter. Kept the actionable
                shoot-type / accessibility / trust filters. */}

            <Section label="Trust & freshness">
              <SwitchRow label="Verified in last 60 days" value={!!local.verified_recently} onChange={() => toggle('verified_recently')} />
              <SwitchRow label="Proven spot (80+ & 3+ photos)" value={!!local.proven_spot} onChange={() => toggle('proven_spot')} />
            </Section>

            <Section label="Accessibility & rules">
              <SwitchRow label="Dog friendly" value={!!local.dog_friendly} onChange={() => toggle('dog_friendly')} />
              <SwitchRow label="Kid friendly" value={!!local.kid_friendly} onChange={() => toggle('kid_friendly')} />
              <SwitchRow label="Wheelchair accessible" value={!!local.accessible} onChange={() => toggle('accessible')} />
              <SwitchRow label="Indoor option" value={!!local.indoor} onChange={() => toggle('indoor')} />
              <SwitchRow label="Permit required" value={!!local.permit_required} onChange={() => toggle('permit_required')} />
              <SwitchRow label="Fee required" value={!!local.fee_required} onChange={() => toggle('fee_required')} />
            </Section>

            <Section label="Min Shoot Score">
              {[60, 70, 80, 90].map((v) => (
                <Chip key={v} label={`${v}+`} active={local.min_rating === v}
                  onPress={() => setLocal({ ...local, min_rating: local.min_rating === v ? undefined : v })}
                  testID={`filter-min-${v}`} />
              ))}
            </Section>
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: space.md, padding: space.xl, paddingTop: 0 }}>
            <Button title="Reset" variant="secondary" onPress={() => setLocal({})} testID="filter-reset" style={{ flex: 1 }} />
            <Button title="Apply filters" onPress={() => onApply(local)} testID="filter-apply" style={{ flex: 2 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Section({ label, children }: { label: string; children: any }) {
  return (
    <View>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.chipWrap}>{children}</View>
    </View>
  );
}

function ScaleChips({ label, value, onChange }: { label: string; value?: number; onChange: (v: number) => void }) {
  return (
    <View style={{ width: '100%', gap: 6, marginTop: 4 }}>
      <Text style={styles.subLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[1, 2, 3, 4, 5].map((v) => (
          <TouchableOpacity
            key={v}
            onPress={() => onChange(v)}
            style={[styles.scaleBtn, value === v && styles.scaleBtnActive]}
          >
            <Text style={[styles.scaleTxt, value === v && { color: colors.textInverse }]}>{v}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingVertical: 4 }}>
      <Text style={{ color: colors.text, fontFamily: font.bodyMedium, fontSize: 14, flex: 1 }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: colors.surface3 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  // GPS trust strip — Apr 2026 Item #3 round 3
  gpsTrust: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space.xl, paddingTop: 8, paddingBottom: 6,
  },
  gpsTrustTxt: {
    flex: 1, color: colors.textTertiary,
    fontFamily: font.bodyMedium, fontSize: 11.5, letterSpacing: 0.2,
  },
  gpsRetry: {
    color: colors.primary, fontFamily: font.bodyBold, fontSize: 12, letterSpacing: 0.3,
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md,
  },
  // Apr 2026 Explore premium upgrade styles ----------------------------
  headerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: space.xl, paddingTop: 4, paddingBottom: 6,
  },
  kicker: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.8 },
  headerTitle: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.2, marginTop: 1 },
  headerBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  segWrap: { paddingHorizontal: space.xl, paddingTop: 6, paddingBottom: 6 },
  seg: {
    flexDirection: 'row',
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: 22, padding: 3,
  },
  segBtn: {
    flex: 1, height: 36, borderRadius: 19,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  segBtnActive: { backgroundColor: 'rgba(245,166,35,0.18)', borderWidth: 1, borderColor: colors.primary },
  segTxt: { color: colors.textSecondary, fontFamily: font.bodySemibold, fontSize: 13 },
  segTxtActive: { color: colors.primary, fontFamily: font.bodyBold },
  locRow: { flexDirection: 'row', gap: 6, paddingHorizontal: space.xl, paddingTop: 6, paddingBottom: 4 },
  locChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    height: 30, paddingHorizontal: 12, borderRadius: 15,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
  },
  locChipTxt: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 11 },
  locChipChev: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 10 },
  chipRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space.xl, paddingTop: 8, paddingBottom: 8,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    height: 32, paddingHorizontal: 12, borderRadius: 16,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: 'rgba(245,166,35,0.14)', borderColor: colors.primary },
  chipTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  chipTxtActive: { color: colors.primary, fontFamily: font.bodySemibold },
  // Inline ELITE sub-pill on the Hidden Gems chip — matches mockup spec.
  chipEliteSub: {
    paddingHorizontal: 6, paddingVertical: 1.5,
    borderRadius: 6,
    backgroundColor: 'rgba(245,166,35,0.18)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(245,166,35,0.55)',
    marginLeft: 2,
  },
  chipEliteSubTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 8, letterSpacing: 0.5 },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    paddingHorizontal: space.lg, paddingVertical: 12, borderRadius: radii.md,
  },
  searchText: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14 },
  iconBtn: {
    width: 44, height: 44, borderRadius: radii.md, position: 'relative',
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeDot: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary,
    paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center',
  },
  badgeDotTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 10 },
  floatControls: { position: 'absolute', right: space.xl, bottom: space.xl, gap: 10 },
  fab: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: 'rgba(20,20,22,0.85)',
    borderColor: colors.border, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  // Apr 2026 Premium Map — glassmorphism FAB. Used by the Recenter /
  // Layers / Toggle-list stack. Backdrop is heavily darkened with a
  // hairline gold-tinged border for the Apple-quality "glass" feel.
  fabGlass: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: 'rgba(15,15,18,0.7)',
    borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  // 🔥 Trending chip — floating retention nudge on map mount.
  trendingChip: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(15,15,18,0.92)',
    borderWidth: 1, borderColor: 'rgba(249,115,22,0.45)',
    shadowColor: '#F97316',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  trendingChipTxt: {
    color: colors.text, fontFamily: font.bodyMedium, fontSize: 12,
  },
  // Avatar stack on the trending chip — Mockup spec: 3 overlapped circular
  // owner avatars + "+N" count next to a chevron.
  trendAvatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 'auto',
    paddingLeft: 6,
  },
  trendAvatar: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 1.5, borderColor: '#0c0c10',
    backgroundColor: colors.surface2,
  },
  trendOverflow: {
    color: colors.textSecondary,
    fontFamily: font.bodySemibold,
    fontSize: 11,
    marginLeft: 4,
  },
  // Active state for the inline niche chip (when a niche is selected)
  locChipActive: {
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderColor: 'rgba(245,166,35,0.6)',
  },
  // Photographer-context chip row inside the bottom sheet
  photogRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    paddingTop: 10,
    paddingHorizontal: 2,
  },
  photogChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  photogChipTxt: {
    fontFamily: font.bodySemibold, fontSize: 10.5, letterSpacing: 0.1,
  },
  // Bookmark "Saved" state for the secondary button
  previewBtnSaved: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderColor: 'rgba(245,166,35,0.5)',
  },

  // ────────────────────────────────────────────────────────────────────
  // Apr 2026 — Apple-quality bottom sheet redesign (mockup-pixel match)
  // ────────────────────────────────────────────────────────────────────
  sheetBody: {
    flexDirection: 'row',
    paddingTop: 4,
    gap: 14,
  },
  sheetHeroWrap: {
    width: 132,
    height: 132,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  sheetHero: { width: '100%', height: '100%' },
  sheetVerifiedPill: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(8,20,12,0.85)',
    borderWidth: 1, borderColor: 'rgba(16,185,129,0.55)',
  },
  sheetVerifiedTxt: {
    color: '#10B981',
    fontFamily: font.bodyBold,
    fontSize: 9,
    letterSpacing: 0.6,
  },
  sheetRight: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  sheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sheetTitle: {
    flexShrink: 1,
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 17,
    letterSpacing: -0.2,
  },
  blueCheck: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#3B82F6',
    alignItems: 'center', justifyContent: 'center',
  },
  blueCheckTxt: {
    color: '#fff',
    fontFamily: font.bodyBold,
    fontSize: 9,
    lineHeight: 11,
  },
  sheetSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  sheetCity: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 12,
    flexShrink: 1,
  },
  sheetIconBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  sheetScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  sheetScoreCol: {
    alignItems: 'center',
    gap: 2,
  },
  sheetScoreRing: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 2.5,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  sheetScoreTxt: {
    fontFamily: font.bodyBold,
    fontSize: 14,
  },
  sheetScoreLabel: {
    color: colors.textSecondary,
    fontFamily: font.bodyMedium,
    fontSize: 9.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  // The two prominent chips (gold/green) inside the bottom sheet
  bigChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  bigChipGold: {
    backgroundColor: 'rgba(245,166,35,0.13)',
    borderColor: 'rgba(245,166,35,0.55)',
  },
  bigChipGreen: {
    backgroundColor: 'rgba(34,197,94,0.13)',
    borderColor: 'rgba(34,197,94,0.55)',
  },
  bigChipElite: {
    backgroundColor: 'rgba(157,89,255,0.13)',
    borderColor: 'rgba(157,89,255,0.55)',
  },
  bigChipTxt: {
    fontFamily: font.bodyBold,
    fontSize: 11,
    letterSpacing: 0.1,
  },
  // Subtle outline tag chip row (Urban / Easy Access / Great for Portraits)
  subtleTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingTop: 12,
  },
  subtleTag: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  subtleTagTxt: {
    color: colors.textSecondary,
    fontFamily: font.bodyMedium,
    fontSize: 11.5,
  },
  legendBar: {
    position: 'absolute', top: 10, left: space.xl, right: space.xl,
    flexDirection: 'row', gap: 12, flexWrap: 'wrap',
    padding: 8, borderRadius: radii.pill, backgroundColor: 'rgba(15,15,18,0.88)',
    justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  previewWrap: { position: 'absolute', left: space.xl, right: space.xl, bottom: space.xxl },
  previewClose: {
    position: 'absolute', right: space.md, top: space.md, zIndex: 2,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center',
  },
  previewChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  previewChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.pill },
  previewChipTxt: { fontFamily: font.bodyBold, fontSize: 10 },

  // Apr 2026 — Premium Map Pin Preview bottom sheet (dual-button)
  previewSheet: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.xxl,
    backgroundColor: 'rgba(15,15,18,0.95)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingTop: 14,
    paddingBottom: 12,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  previewHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignSelf: 'center',
    marginBottom: 10,
  },
  previewCloseV2: {
    position: 'absolute', right: 10, top: 10, zIndex: 2,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  previewHero: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  previewThumbWrap: {
    width: 64, height: 64, borderRadius: 16, overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  previewThumb: { width: '100%', height: '100%' },
  previewTitle: {
    color: colors.text, fontFamily: font.bodyBold, fontSize: 15, letterSpacing: -0.1,
  },
  previewCity: {
    color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 1,
  },
  previewMetaRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 5,
  },
  previewScore: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 2,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  previewScoreTxt: { fontFamily: font.bodyBold, fontSize: 13 },
  previewActions: {
    flexDirection: 'row', gap: 8, marginTop: 12,
  },
  previewBtn: {
    flex: 1, height: 44, borderRadius: 22,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  previewBtnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  previewBtnSecondaryTxt: {
    color: colors.text, fontFamily: font.bodySemibold, fontSize: 13,
  },
  previewBtnPrimary: {
    backgroundColor: colors.primary,
  },
  previewBtnPrimaryTxt: {
    color: '#1a1300', fontFamily: font.bodyBold, fontSize: 13,
  },

  // "Search this area" floating CTA
  searchAreaCta: {
    position: 'absolute',
    top: 70,
    alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.primary,
    shadowColor: '#000', shadowOpacity: 0.45,
    shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  searchAreaTxt: {
    color: '#1a1300', fontFamily: font.bodyBold, fontSize: 12.5, letterSpacing: 0.1,
  },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface1, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.surface3, alignSelf: 'center', marginTop: 10 },
  sheetHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.sm,
  },
  sheetTitle: { color: colors.text, fontFamily: font.display, fontSize: 26 },
  sectionLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  subLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scaleBtn: { flex: 1, paddingVertical: 8, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2, alignItems: 'center' },
  scaleBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  scaleTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },
});
