/**
 * Park detail page — Phase 3 (polished).
 *
 * Adds on top of Phase 2 minimal version:
 *   • Hero cover image pulled from the first child spot
 *   • "Save park" heart toggle (POST/DELETE /api/parks/{id}/save)
 *   • "Directions" deep-link to the system maps app
 *   • Distance from user's current location (with permission)
 *   • Per-child distance badge
 *   • Cursor-paginated children list (Load more) using
 *     /api/parks/{id}/children for parks with 50+ spots
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, Image, RefreshControl, Platform, Linking,
  ImageBackground,
} from 'react-native';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChevronLeft, MapPin, Plus, Layers, Lock, Heart, Navigation, Share2,
} from 'lucide-react-native';
import * as Location from 'expo-location';
import { api } from '../../src/api';
import { resolveImageUrl } from '../../src/utils/image-url';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';

type ChildSpot = {
  spot_id: string;
  title: string;
  hero_cover_image_url?: string | null;
  best_time_of_day?: string | null;
  privacy_mode?: string;
  visibility_status?: string;
  owner_user_id?: string;
  latitude?: number;
  longitude?: number;
  city?: string | null;
  state?: string | null;
};

type Park = {
  park_id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country_code?: string | null;
  description?: string | null;
  general_parking_notes?: string | null;
  general_permit_notes?: string | null;
  general_safety_notes?: string | null;
  general_access_notes?: string | null;
  latitude?: number;
  longitude?: number;
  child_spot_count?: number;
  children?: ChildSpot[];
  children_returned?: number;
  is_saved?: boolean;
  saved_count?: number;
};

// Haversine distance in km between two lat/lng pairs.
function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

function fmtDist(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

export default function ParkDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [park, setPark] = useState<Park | null>(null);
  const [children, setChildren] = useState<ChildSpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  // Best-effort user location for "distance from you" badges.
  useEffect(() => {
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') return;
        const loc = await Location.getLastKnownPositionAsync({})
          || await Location.getCurrentPositionAsync({});
        if (loc?.coords) setUserLoc({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      } catch {}
    })();
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api.get(`/parks/${id}`, { children_limit: 50 });
      setPark(r as Park);
      const kids: ChildSpot[] = (r as Park).children || [];
      setChildren(kids);
      // If the API returned 50 children at the limit, assume more might exist;
      // we'll page using the children endpoint.
      setHasMore(kids.length >= 50);
      // Initial cursor = oldest child's created_at if we got a full page.
      if (kids.length >= 50) {
        // We don't have created_at on the projected child object; defer to
        // the children endpoint which we'll call without a cursor first.
        setCursor(null);
      } else {
        setCursor(null);
      }
    } catch (_) {
      setPark(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    if (!park || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const r = await api.get(`/parks/${park.park_id}/children`, {
        limit: 30,
        cursor: cursor || undefined,
      });
      const next: ChildSpot[] = r.items || [];
      // Dedupe — backend cursor is created_at, so first item on the
      // second page should not overlap, but be defensive anyway.
      setChildren((prev) => {
        const seen = new Set(prev.map((c) => c.spot_id));
        return [...prev, ...next.filter((n) => !seen.has(n.spot_id))];
      });
      setCursor(r.next_cursor || null);
      setHasMore(!!r.next_cursor);
    } catch {} finally {
      setLoadingMore(false);
    }
  };

  const toggleSave = async () => {
    if (!park || saveBusy) return;
    if (!user) {
      router.push('/onboarding/sign-in' as any);
      return;
    }
    setSaveBusy(true);
    const next = !park.is_saved;
    setPark({ ...park, is_saved: next });  // optimistic
    try {
      if (next) {
        await api.post(`/parks/${park.park_id}/save`);
      } else {
        await api.delete(`/parks/${park.park_id}/save`);
      }
    } catch {
      // Revert on failure
      setPark({ ...park, is_saved: !next });
    } finally {
      setSaveBusy(false);
    }
  };

  const openDirections = () => {
    if (!park || park.latitude == null || park.longitude == null) return;
    const lat = park.latitude;
    const lng = park.longitude;
    const label = encodeURIComponent(park.name);
    // iOS → Apple Maps; everything else → Google Maps web link
    const url = Platform.OS === 'ios'
      ? `http://maps.apple.com/?q=${label}&ll=${lat},${lng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    Linking.openURL(url).catch(() => {});
  };

  const onAddAnother = async () => {
    if (!park) return;
    try {
      // Refresh the 24h session so /(tabs)/add picks this park up on its
      // mount effect via GET /api/me/park-session.
      await api.post('/me/park-session', { park_id: park.park_id });
    } catch {}
    router.push('/(tabs)/add' as any);
  };

  const heroImage = useMemo(() => {
    const first = children.find((c) => !!c.hero_cover_image_url);
    return first?.hero_cover_image_url || null;
  }, [children]);

  const distanceFromUser = useMemo(() => {
    if (!park || !userLoc || park.latitude == null || park.longitude == null) return null;
    const d = haversine(userLoc, { lat: park.latitude, lng: park.longitude });
    return fmtDist(d);
  }, [park, userLoc]);

  const childrenWithDistance = useMemo(() => {
    if (!park || park.latitude == null || park.longitude == null) return children;
    const center = { lat: park.latitude, lng: park.longitude };
    return children.map((c) => {
      if (c.latitude == null || c.longitude == null) return c;
      const km = haversine(center, { lat: c.latitude, lng: c.longitude });
      return { ...c, _from_center_km: km } as any;
    });
  }, [children, park]);

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }
  if (!park) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <ChevronLeft size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Park</Text>
          <View style={styles.iconBtn} />
        </View>
        <Text style={styles.empty}>Park not found.</Text>
      </SafeAreaView>
    );
  }

  const subline = [park.address, park.city, park.state, park.country_code].filter(Boolean).join(' · ');
  const count = park.child_spot_count ?? children.length;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="park-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{park.name}</Text>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={toggleSave}
          disabled={saveBusy}
          testID="park-save-toggle"
        >
          <Heart
            size={20}
            color={park.is_saved ? colors.secondary : colors.text}
            fill={park.is_saved ? colors.secondary : 'transparent'}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        {/* Hero — uses first child's cover when present, otherwise a
            subtle layered card so the page still feels intentional. */}
        {heroImage ? (
          <ImageBackground source={{ uri: resolveImageUrl(heroImage) }} style={styles.heroImg} imageStyle={styles.heroImgInner}>
            <View style={styles.heroScrim} pointerEvents="none" />
            <View style={styles.heroOverlay}>
              <View style={styles.heroPill}>
                <Layers size={11} color={colors.primary} />
                <Text style={styles.heroPillTxt}>PARK · {count} photo spot{count === 1 ? '' : 's'}</Text>
              </View>
              <Text style={styles.heroOverlayTitle} numberOfLines={2}>{park.name}</Text>
              {!!subline && <Text style={styles.heroOverlaySub} numberOfLines={1}>{subline}</Text>}
            </View>
          </ImageBackground>
        ) : (
          <View style={styles.heroFallback}>
            <View style={styles.heroIcon}>
              <Layers size={26} color={colors.primary} />
            </View>
            <Text style={styles.heroOverlayTitle} numberOfLines={2}>{park.name}</Text>
            {!!subline && <Text style={styles.heroFallbackSub} numberOfLines={1}>{subline}</Text>}
          </View>
        )}

        {/* Action row — Save · Directions · Add Spot */}
        <View style={styles.actionRow}>
          <ActionButton
            icon={<Heart size={16} color={park.is_saved ? colors.secondary : colors.text} fill={park.is_saved ? colors.secondary : 'transparent'} />}
            label={park.is_saved ? 'Saved' : 'Save'}
            onPress={toggleSave}
            disabled={saveBusy}
            testID="park-save-btn"
          />
          <ActionButton
            icon={<Navigation size={16} color={colors.text} />}
            label="Directions"
            onPress={openDirections}
            testID="park-directions"
          />
          <ActionButton
            icon={<Plus size={16} color={colors.textInverse} />}
            label="Add Spot"
            onPress={onAddAnother}
            primary
            testID="park-add-another"
          />
        </View>

        {/* Distance from user pill */}
        {!!distanceFromUser && (
          <View style={styles.distancePillWrap}>
            <View style={styles.distancePill}>
              <MapPin size={11} color={colors.textSecondary} />
              <Text style={styles.distancePillTxt}>{distanceFromUser} from you</Text>
            </View>
          </View>
        )}

        <View style={{ padding: space.xl, gap: space.lg }}>
          {!!park.description && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About this park</Text>
              <Text style={styles.body}>{park.description}</Text>
            </View>
          )}

          {(park.general_parking_notes || park.general_safety_notes
            || park.general_access_notes || park.general_permit_notes) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>General notes</Text>
              {!!park.general_parking_notes && <Note label="Parking" value={park.general_parking_notes} />}
              {!!park.general_permit_notes && <Note label="Permits" value={park.general_permit_notes} />}
              {!!park.general_safety_notes && <Note label="Safety" value={park.general_safety_notes} />}
              {!!park.general_access_notes && <Note label="Access" value={park.general_access_notes} />}
            </View>
          )}

          <View style={styles.section}>
            <View style={styles.spotsHeader}>
              <Text style={styles.sectionTitle}>
                Photo spots inside this park
              </Text>
              <Text style={styles.spotsCount}>{count}</Text>
            </View>
            {childrenWithDistance.length === 0 ? (
              <Text style={styles.empty}>No spots yet — be the first to add one.</Text>
            ) : (
              <View style={{ gap: 10 }}>
                {childrenWithDistance.map((c: any) => (
                  <TouchableOpacity
                    key={c.spot_id}
                    style={styles.childRow}
                    onPress={() => router.push(`/spot/${c.spot_id}` as any)}
                    testID={`park-child-${c.spot_id}`}
                  >
                    {c.hero_cover_image_url ? (
                      <Image source={{ uri: resolveImageUrl(c.hero_cover_image_url) }} style={styles.childImg} />
                    ) : (
                      <View style={[styles.childImg, { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 }]}>
                        <MapPin size={18} color={colors.textTertiary} />
                      </View>
                    )}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.childTitle} numberOfLines={1}>{c.title}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {typeof c._from_center_km === 'number' && (
                          <Text style={styles.distChip}>
                            {fmtDist(c._from_center_km)} from park center
                          </Text>
                        )}
                        {!!c.best_time_of_day && (
                          <Text style={styles.childMeta} numberOfLines={1}>· Best: {c.best_time_of_day}</Text>
                        )}
                      </View>
                      {c.privacy_mode === 'private' && (
                        <View style={styles.privatePill}>
                          <Lock size={9} color={colors.textSecondary} />
                          <Text style={styles.privatePillTxt}>PRIVATE</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
                {hasMore && (
                  <TouchableOpacity
                    style={styles.loadMoreBtn}
                    onPress={loadMore}
                    disabled={loadingMore}
                    testID="park-load-more"
                  >
                    {loadingMore ? (
                      <ActivityIndicator size="small" color={colors.text} />
                    ) : (
                      <Text style={styles.loadMoreTxt}>Load more</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionButton({ icon, label, onPress, primary, disabled, testID }: {
  icon: React.ReactNode; label: string; onPress: () => void;
  primary?: boolean; disabled?: boolean; testID?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.actBtn, primary ? styles.actBtnPrimary : styles.actBtnGhost, disabled && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
    >
      {icon}
      <Text style={[styles.actBtnTxt, primary && { color: colors.textInverse }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Note({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={styles.noteLabel}>{label}</Text>
      <Text style={styles.body}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.lg, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.text, fontFamily: font.display, fontSize: 17 },

  // Hero
  heroImg: { width: '100%', height: 220, justifyContent: 'flex-end' },
  heroImgInner: { resizeMode: 'cover' },
  heroScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  heroOverlay: { padding: space.xl, gap: 6 },
  heroPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  heroPillTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.4 },
  heroOverlayTitle: { color: '#fff', fontFamily: font.display, fontSize: 24 },
  heroOverlaySub: { color: 'rgba(255,255,255,0.85)', fontFamily: font.body, fontSize: 12 },

  heroFallback: {
    padding: space.xl, gap: 8, alignItems: 'center',
    backgroundColor: colors.surface1,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  heroIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(245,166,35,0.16)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  heroFallbackSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, textAlign: 'center' },

  // Actions
  actionRow: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: 4,
  },
  actBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: radii.md,
  },
  actBtnGhost: {
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  actBtnPrimary: { backgroundColor: colors.primary },
  actBtnTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },

  distancePillWrap: { paddingHorizontal: space.xl, paddingTop: 6 },
  distancePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill,
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  distancePillTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },

  section: { gap: 6 },
  sectionTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  body: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 19 },
  noteLabel: { color: colors.textTertiary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 },

  spotsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  spotsCount: {
    color: colors.primary, fontFamily: font.bodyBold, fontSize: 13,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.pill,
    backgroundColor: 'rgba(245,166,35,0.12)',
  },

  childRow: {
    flexDirection: 'row', gap: 10, padding: 8,
    borderRadius: radii.md, backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  childImg: { width: 64, height: 64, borderRadius: radii.sm },
  childTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  childMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },
  distChip: {
    color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11,
    paddingHorizontal: 6, paddingVertical: 1, borderRadius: radii.sm,
    backgroundColor: colors.surface2,
  },
  privatePill: {
    alignSelf: 'flex-start', marginTop: 4,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.sm,
    backgroundColor: colors.surface2,
  },
  privatePillTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.5 },

  loadMoreBtn: {
    alignSelf: 'center', marginTop: 6, paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  loadMoreTxt: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },

  empty: { color: colors.textTertiary, fontFamily: font.body, fontSize: 13, textAlign: 'center', marginTop: 20 },
});
