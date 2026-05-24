/**
 * Park detail page — Phase 2 minimal version.
 *
 * Hits GET /api/parks/{id} (returns metadata + up to 50 children) and
 * shows a simple, functional view so the "View park" CTA after spot
 * submission has a real destination.
 *
 * Phase 3 will polish: header hero, "Save park", child card thumbnails
 * with distance, directions button, etc.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, Image, RefreshControl, Platform,
} from 'react-native';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, MapPin, Plus, Layers, Lock } from 'lucide-react-native';
import { api } from '../../src/api';
import { resolveImageUrl } from '../../src/utils/image-url';
import { colors, font, space, radii } from '../../src/theme';

type ChildSpot = {
  spot_id: string;
  title: string;
  hero_cover_image_url?: string | null;
  best_time_of_day?: string | null;
  privacy_mode?: string;
  visibility_status?: string;
  owner_user_id?: string;
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
};

export default function ParkDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [park, setPark] = useState<Park | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api.get(`/parks/${id}`);
      setPark(r as Park);
    } catch (_) {
      setPark(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const onAddAnother = async () => {
    if (!park) return;
    try {
      // Start / refresh the 24h session so the Add Spot screen picks
      // this park up automatically (its mount effect reads the session).
      await api.post('/me/park-session', { park_id: park.park_id });
    } catch {}
    router.push('/(tabs)/add' as any);
  };

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

  const subline = [
    park.address, park.city, park.state, park.country_code,
  ].filter(Boolean).join(' · ');
  const count = park.child_spot_count ?? park.children?.length ?? 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="park-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{park.name}</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.xl, paddingBottom: 120, gap: space.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Layers size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>{park.name}</Text>
            {!!subline && <Text style={styles.heroSub} numberOfLines={2}>{subline}</Text>}
            <View style={styles.countPill}>
              <Text style={styles.countPillTxt}>
                {count} photo spot{count === 1 ? '' : 's'} inside this park
              </Text>
            </View>
          </View>
        </View>

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
            <Text style={styles.sectionTitle}>Photo spots inside this park</Text>
            <TouchableOpacity style={styles.addBtn} onPress={onAddAnother} testID="park-add-another">
              <Plus size={14} color={colors.textInverse} />
              <Text style={styles.addBtnTxt}>Add</Text>
            </TouchableOpacity>
          </View>
          {(park.children || []).length === 0 ? (
            <Text style={styles.empty}>No spots yet — be the first to add one.</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {(park.children || []).map((c) => (
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
                  <View style={{ flex: 1 }}>
                    <Text style={styles.childTitle} numberOfLines={1}>{c.title}</Text>
                    {!!c.best_time_of_day && (
                      <Text style={styles.childMeta} numberOfLines={1}>Best: {c.best_time_of_day}</Text>
                    )}
                    {c.privacy_mode === 'private' && (
                      <View style={styles.privatePill}>
                        <Lock size={9} color={colors.textSecondary} />
                        <Text style={styles.privatePillTxt}>PRIVATE</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
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
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.text, fontFamily: font.display, fontSize: 17 },

  hero: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  heroIcon: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(245,166,35,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { color: colors.text, fontFamily: font.display, fontSize: 18 },
  heroSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 4 },
  countPill: {
    alignSelf: 'flex-start', marginTop: 10,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill,
    backgroundColor: 'rgba(245,166,35,0.16)',
  },
  countPillTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.4 },

  section: { gap: 6 },
  sectionTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  body: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 19 },
  noteLabel: { color: colors.textTertiary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 },

  spotsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.primary },
  addBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 12 },

  childRow: {
    flexDirection: 'row', gap: 10, padding: 8,
    borderRadius: radii.md, backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  childImg: { width: 64, height: 64, borderRadius: radii.sm },
  childTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  childMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
  privatePill: {
    alignSelf: 'flex-start', marginTop: 4,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.sm,
    backgroundColor: colors.surface2,
  },
  privatePillTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.5 },

  empty: { color: colors.textTertiary, fontFamily: font.body, fontSize: 13, textAlign: 'center', marginTop: 20 },
});
