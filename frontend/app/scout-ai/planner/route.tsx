import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, MapPinned, Sparkles, Navigation2, LocateFixed } from 'lucide-react-native';
import * as Location from 'expo-location';
import { api, formatApiError } from '../../../src/api';
import { colors, font, space, radii } from '../../../src/theme';

type Stop = {
  spot_id: string; title: string; city?: string; state?: string;
  primary_photo?: string | null; best_time_of_day?: string;
  order: number; distance_from_prev_km: number; eta_from_prev_min: number;
  reason?: string;
};
type RoutePlan = {
  title: string; summary: string; focus?: string;
  stops: Stop[]; total_distance_km: number; total_eta_min: number;
  disclosure?: string;
};

export default function RoutePlanner() {
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [maxStops, setMaxStops] = useState<4 | 5 | 6>(5);
  const [focus, setFocus] = useState('');
  const [loading, setLoading] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [err, setErr] = useState('');

  const grabLocation = async () => {
    setLocBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setErr('Enable location access or enter coordinates manually.');
        return;
      }
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLat(p.coords.latitude.toFixed(5));
      setLng(p.coords.longitude.toFixed(5));
      setErr('');
    } catch {
      setErr('Could not read your location.');
    } finally {
      setLocBusy(false);
    }
  };

  const run = async () => {
    setErr('');
    const la = parseFloat(lat), lo = parseFloat(lng);
    if (isNaN(la) || isNaN(lo)) { setErr('Enter valid coordinates, or tap "Use my location".'); return; }
    setLoading(true);
    setPlan(null);
    try {
      const res = await api.post('/ai/plan/route', {
        base_lat: la, base_lng: lo,
        max_stops: maxStops,
        focus: focus.trim() || undefined,
        radius_km: 80,
      });
      setPlan(res);
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headTitle}>Route planner</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: space.xxxl }} keyboardShouldPersistTaps="handled">
          <View style={styles.iconBubble}><MapPinned size={20} color="#6aa9ff" /></View>
          <Text style={styles.head}>Build a one-day route</Text>
          <Text style={styles.sub}>Scout AI orders nearby spots by proximity + light. Distances are straight-line estimates.</Text>

          <TouchableOpacity style={styles.locBtn} onPress={grabLocation} disabled={locBusy} testID="rp-use-my-location">
            {locBusy ? <ActivityIndicator color={colors.primary} /> : <LocateFixed size={14} color={colors.primary} />}
            <Text style={styles.locTxt}>{locBusy ? 'Locating…' : 'Use my current location'}</Text>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Latitude</Text>
              <TextInput value={lat} onChangeText={setLat} placeholder="30.2672" placeholderTextColor={colors.textTertiary} style={styles.input} keyboardType="decimal-pad" testID="rp-lat" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Longitude</Text>
              <TextInput value={lng} onChangeText={setLng} placeholder="-97.7431" placeholderTextColor={colors.textTertiary} style={styles.input} keyboardType="decimal-pad" testID="rp-lng" />
            </View>
          </View>

          <Text style={styles.label}>Focus (optional)</Text>
          <TextInput value={focus} onChangeText={setFocus} placeholder="golden hour, architecture, nature…" placeholderTextColor={colors.textTertiary} style={styles.input} testID="rp-focus" />

          <Text style={styles.label}>Number of stops</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[4, 5, 6].map(n => (
              <TouchableOpacity
                key={n}
                style={[styles.seg, maxStops === n && styles.segActive]}
                onPress={() => setMaxStops(n as 4 | 5 | 6)}
                testID={`rp-stops-${n}`}
              >
                <Text style={[styles.segTxt, maxStops === n && styles.segTxtActive]}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {err ? <Text style={styles.err}>{err}</Text> : null}
          <TouchableOpacity
            style={[styles.cta, loading && { opacity: 0.6 }]}
            disabled={loading}
            onPress={run}
            testID="rp-generate"
          >
            {loading ? <ActivityIndicator color="#fff" /> : <>
              <Sparkles size={16} color="#fff" />
              <Text style={styles.ctaTxt}>Build my route</Text>
            </>}
          </TouchableOpacity>

          {plan && (
            <View style={{ marginTop: space.xxl }}>
              <Text style={styles.planTitle}>{plan.title}</Text>
              {!!plan.summary && <Text style={styles.planBody}>{plan.summary}</Text>}
              <View style={styles.totals}>
                <View style={styles.totalBox}><Text style={styles.totalVal}>{plan.total_distance_km.toFixed(0)} km</Text><Text style={styles.totalLabel}>total</Text></View>
                <View style={styles.totalBox}><Text style={styles.totalVal}>~{Math.round(plan.total_eta_min / 60 * 10) / 10} h</Text><Text style={styles.totalLabel}>driving</Text></View>
                <View style={styles.totalBox}><Text style={styles.totalVal}>{plan.stops.length}</Text><Text style={styles.totalLabel}>stops</Text></View>
              </View>

              {plan.stops.map((s) => (
                <TouchableOpacity key={s.spot_id} style={styles.stopCard} onPress={() => router.push(`/spot/${s.spot_id}` as any)} activeOpacity={0.85}>
                  <View style={styles.stopBadge}><Text style={styles.stopBadgeTxt}>{s.order}</Text></View>
                  {s.primary_photo ? <Image source={{ uri: s.primary_photo }} style={styles.thumb} /> : <View style={[styles.thumb, { backgroundColor: colors.surface2 }]} />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.spotTitle} numberOfLines={1}>{s.title}</Text>
                    <View style={styles.legRow}>
                      <Navigation2 size={11} color={colors.textTertiary} />
                      <Text style={styles.legTxt}>+{s.distance_from_prev_km.toFixed(1)} km · {s.eta_from_prev_min} min</Text>
                    </View>
                    {!!s.reason && <Text style={styles.spotReason} numberOfLines={2}>{s.reason}</Text>}
                  </View>
                </TouchableOpacity>
              ))}
              {!!plan.disclosure && <Text style={styles.disclosure}>{plan.disclosure}</Text>}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 17 },
  iconBubble: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(106,169,255,0.14)', borderWidth: 1, borderColor: 'rgba(106,169,255,0.35)', marginBottom: space.md },
  head: { color: colors.text, fontFamily: font.display, fontSize: 26, letterSpacing: -0.5 },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13.5, lineHeight: 20, marginTop: 6 },
  locBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: space.md, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: 'rgba(32,130,255,0.12)', borderWidth: 1, borderColor: 'rgba(32,130,255,0.35)' },
  locTxt: { color: colors.primary, fontFamily: font.bodySemibold, fontSize: 12 },
  label: { color: colors.textSecondary, fontFamily: font.bodySemibold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', marginTop: space.lg, marginBottom: 6 },
  input: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 12, color: colors.text, fontFamily: font.body, fontSize: 14 },
  seg: { flex: 1, paddingVertical: 12, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  segActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13 },
  segTxtActive: { color: '#fff', fontFamily: font.bodyBold },
  err: { color: colors.secondary, fontFamily: font.body, fontSize: 12, marginTop: 8 },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radii.md, marginTop: space.lg },
  ctaTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 14 },
  planTitle: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.4 },
  planBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13.5, lineHeight: 20, marginTop: 4 },
  totals: { flexDirection: 'row', gap: 8, marginTop: space.md, marginBottom: space.md },
  totalBox: { flex: 1, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingVertical: 10, alignItems: 'center' },
  totalVal: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  totalLabel: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  stopCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: 10, marginBottom: 8 },
  stopBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  stopBadgeTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 12 },
  thumb: { width: 54, height: 54, borderRadius: radii.sm },
  spotTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  legRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  legTxt: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  spotReason: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11.5, lineHeight: 16, marginTop: 4 },
  disclosure: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 10, textAlign: 'center', lineHeight: 16 },
});
