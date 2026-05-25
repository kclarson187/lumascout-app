/**
 * In-app public shared-spot view — Feature 4 Scope B.
 *
 * Read-only mirror of GET /api/spots/shared/{token}. Used when a user
 * who happens to have LumaScout installed taps a share link — the
 * deep-link router can route /shared/{token} here to render natively
 * instead of bouncing to the web HTML page. Unauthenticated; the
 * backend handles all access control and sanitization.
 *
 * Unavailable parity: any 404 from the API surfaces the SAME generic
 * "Link unavailable" UI regardless of underlying cause (revoked /
 * deleted / rejected / suspended / never-existed).
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Image, TouchableOpacity,
  ActivityIndicator, Linking, Platform, SafeAreaView,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, MapPin, Navigation, Lock, EyeOff } from 'lucide-react-native';
import { colors, font, space, radii } from '../../src/theme';
import { api } from '../../src/api';

type SharedPayload = {
  status: 'ok' | 'unavailable';
  visibility?: 'public' | 'private';
  show_exact_location?: boolean;
  coord_precision?: 'exact' | 'approximate';
  robots?: string;
  spot?: any;
  shared_by?: { display_name: string };
};

export default function SharedSpotScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const [data, setData] = useState<SharedPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!token) return;
    let mounted = true;
    (async () => {
      try {
        const r = await api.get(`/spots/shared/${token}`);
        if (!mounted) return;
        if (r?.status === 'unavailable' || r?.status !== 'ok') {
          setUnavailable(true);
        } else {
          setData(r);
        }
      } catch (_e) {
        if (mounted) setUnavailable(true);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [token]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  if (unavailable || !data || data.status !== 'ok' || !data.spot) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <Header onBack={() => router.back()} title="" />
        <View style={styles.center}>
          <View style={styles.unavIcon}><Lock size={28} color={colors.textSecondary} /></View>
          <Text style={styles.unavTitle}>Link unavailable</Text>
          <Text style={styles.unavBody}>
            This share link is no longer available. Ask the photographer for a new one.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const s = data.spot;
  const isPrivate = data.visibility === 'private';
  const showExact = !!data.show_exact_location;
  const lat = s.latitude;
  const lng = s.longitude;
  const mapsUrl = (typeof lat === 'number' && typeof lng === 'number')
    ? (Platform.OS === 'ios'
      ? `https://maps.apple.com/?q=${lat},${lng}`
      : `https://www.google.com/maps?q=${lat},${lng}`)
    : null;

  const hero = s.hero_image_url || (s.images && s.images[0]?.image_url);
  const photos = (s.images || []).slice(0, 12);

  const notes: { label: string; value: string }[] = [
    { label: 'Best light', value: s.best_light_notes || s.best_time_of_day },
    { label: 'Parking', value: s.parking_notes },
    { label: 'Walking', value: s.walking_notes },
    { label: 'Safety', value: s.safety_notes },
    { label: 'Permit', value: s.permit_notes },
    { label: 'Fee', value: s.fee_notes },
    { label: 'Access', value: s.access_notes },
    { label: 'Notes', value: s.notes },
  ].filter(n => !!n.value);

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <Header onBack={() => router.back()} title="" />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xxxxl }}>
        {hero ? (
          <Image source={{ uri: hero }} style={styles.hero} resizeMode="cover" />
        ) : (
          <View style={[styles.hero, { backgroundColor: colors.surface2 }]} />
        )}

        <View style={styles.body}>
          <Text style={styles.title}>{s.title || 'Photo location'}</Text>
          <Text style={styles.byline}>
            Shared by {data.shared_by?.display_name || 'a LumaScout photographer'}
          </Text>

          <View style={styles.badges}>
            {isPrivate ? (
              <View style={styles.badge}>
                <Lock size={11} color={colors.warning} />
                <Text style={[styles.badgeText, { color: colors.warning }]}>Private location</Text>
              </View>
            ) : null}
            {!showExact ? (
              <View style={styles.badge}>
                <EyeOff size={11} color={colors.textSecondary} />
                <Text style={styles.badgeText}>Approximate area only</Text>
              </View>
            ) : null}
          </View>

          {s.description ? (
            <Text style={styles.description}>{s.description}</Text>
          ) : null}

          {photos.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.galleryRow}>
              {photos.map((p: any, i: number) => (
                <Image key={i} source={{ uri: p.image_url }} style={styles.thumb} />
              ))}
            </ScrollView>
          ) : null}

          <View style={styles.card}>
            <View style={styles.coordRow}>
              <MapPin size={16} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.coordLabel}>
                  {showExact ? 'Exact location' : 'Approximate area'}
                </Text>
                <Text style={styles.coordValue}>
                  {typeof lat === 'number' && typeof lng === 'number'
                    ? `${lat}, ${lng}`
                    : '—'}
                </Text>
              </View>
              {mapsUrl ? (
                <TouchableOpacity
                  style={styles.mapsBtn}
                  onPress={() => Linking.openURL(mapsUrl)}
                  testID="shared-open-maps"
                >
                  <Navigation size={14} color={colors.textInverse} />
                  <Text style={styles.mapsBtnText}>Open in Maps</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {notes.map((n, i) => (
              <View key={i} style={styles.noteRow}>
                <Text style={styles.noteLabel}>{n.label}</Text>
                <Text style={styles.noteValue}>{n.value}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.foot}>LumaScout — premium photo locations for photographers.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} hitSlop={12} style={styles.backBtn}>
        <ArrowLeft size={22} color={colors.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={{ width: 32 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  header: {
    flexDirection: 'row', alignItems: 'center', position: 'absolute',
    top: Platform.OS === 'ios' ? 44 : 16, left: 0, right: 0, zIndex: 10,
    paddingHorizontal: space.md,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.text, fontWeight: '700' },

  hero: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surface2 },
  body: { padding: space.xl },
  title: { color: colors.text, fontSize: 28, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  byline: { color: colors.textSecondary, fontSize: 12, marginTop: 4, marginBottom: space.md },

  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: space.md },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.surface2, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },

  description: { color: colors.text, fontSize: 14, lineHeight: 22, marginBottom: space.lg, opacity: 0.92 },

  galleryRow: { gap: 8, marginBottom: space.lg },
  thumb: { width: 140, height: 140, borderRadius: radii.md, backgroundColor: colors.surface2 },

  card: { backgroundColor: colors.surface1, borderRadius: radii.lg, padding: space.lg, marginBottom: space.lg },
  coordRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingBottom: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  coordLabel: { color: colors.textSecondary, fontSize: 12 },
  coordValue: { color: colors.text, fontSize: 14, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 2 },
  mapsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999,
  },
  mapsBtnText: { color: colors.textInverse, fontSize: 12, fontWeight: '700' },

  noteRow: { paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  noteLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 4 },
  noteValue: { color: colors.text, fontSize: 14, lineHeight: 22 },

  foot: { color: colors.textTertiary, fontSize: 12, textAlign: 'center', marginTop: space.lg },

  unavIcon: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surface2,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.lg,
  },
  unavTitle: { color: colors.text, fontSize: 19, fontWeight: '700', marginBottom: space.sm, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  unavBody: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 22 },
});
