import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, CalendarDays, Sparkles, Sun, Sunrise, Sunset } from 'lucide-react-native';
import { api, formatApiError } from '../../../src/api';
import { colors, font, space, radii } from '../../../src/theme';

type PlanSpot = {
  spot_id: string; title: string; city?: string; state?: string;
  primary_photo?: string | null; best_time_of_day?: string;
};
type WeekendPlan = {
  title: string; summary: string; city: string; days: number; focus?: string;
  slots: { slot: string; slot_label: string; time: string; narrative: string; tip: string; spot: PlanSpot | null }[];
  disclosure?: string;
};

const slotIcon = (slot: string) => {
  if (slot.includes('sunrise')) return Sunrise;
  if (slot.includes('golden') || slot.includes('sunset')) return Sunset;
  return Sun;
};

export default function WeekendPlanner() {
  const [city, setCity] = useState('');
  const [focus, setFocus] = useState('');
  const [days, setDays] = useState<1 | 2>(2);
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<WeekendPlan | null>(null);
  const [err, setErr] = useState('');

  const run = async () => {
    setErr('');
    if (!city.trim()) { setErr('Which city are you shooting in?'); return; }
    setLoading(true);
    setPlan(null);
    try {
      const res = await api.post('/ai/plan/weekend', {
        city: city.trim(),
        focus: focus.trim() || undefined,
        days,
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
        <Text style={styles.headTitle}>Weekend planner</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: space.xxxl }} keyboardShouldPersistTaps="handled">
          <View style={styles.iconBubble}><CalendarDays size={20} color="#ffb547" /></View>
          <Text style={styles.head}>Plan a shoot weekend</Text>
          <Text style={styles.sub}>Scout AI builds a light-window itinerary from public spots in your city.</Text>

          <Text style={styles.label}>City</Text>
          <TextInput value={city} onChangeText={setCity} placeholder="e.g. Austin, Toronto…" placeholderTextColor={colors.textTertiary} style={styles.input} testID="wp-city" />

          <Text style={styles.label}>Focus (optional)</Text>
          <TextInput value={focus} onChangeText={setFocus} placeholder="golden hour portraits, family, architecture…" placeholderTextColor={colors.textTertiary} style={styles.input} testID="wp-focus" />

          <Text style={styles.label}>Duration</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[
              { v: 1 as const, label: 'One day' },
              { v: 2 as const, label: 'Full weekend' },
            ].map(opt => (
              <TouchableOpacity
                key={opt.v}
                style={[styles.seg, days === opt.v && styles.segActive]}
                onPress={() => setDays(opt.v)}
                testID={`wp-days-${opt.v}`}
              >
                <Text style={[styles.segTxt, days === opt.v && styles.segTxtActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {err ? <Text style={styles.err}>{err}</Text> : null}
          <TouchableOpacity
            style={[styles.cta, loading && { opacity: 0.6 }]}
            disabled={loading}
            onPress={run}
            testID="wp-generate"
          >
            {loading ? <ActivityIndicator color="#fff" /> : <>
              <Sparkles size={16} color="#fff" />
              <Text style={styles.ctaTxt}>Plan my weekend</Text>
            </>}
          </TouchableOpacity>

          {plan && (
            <View style={{ marginTop: space.xxl }}>
              <Text style={styles.planTitle}>{plan.title}</Text>
              {!!plan.summary && <Text style={styles.planBody}>{plan.summary}</Text>}

              {plan.slots.map((s, i) => {
                const Icon = slotIcon(s.slot);
                return (
                  <View key={`${s.slot}-${i}`} style={styles.slotCard}>
                    <View style={styles.slotHead}>
                      <Icon size={15} color={colors.primary} />
                      <Text style={styles.slotLabel}>{s.slot_label}</Text>
                      <Text style={styles.slotTime}>{s.time}</Text>
                    </View>
                    {s.spot && (
                      <TouchableOpacity
                        onPress={() => router.push(`/spot/${s.spot!.spot_id}` as any)}
                        style={styles.slotSpot}
                        activeOpacity={0.85}
                      >
                        {s.spot.primary_photo ? (
                          <Image source={{ uri: s.spot.primary_photo }} style={styles.thumb} />
                        ) : (
                          <View style={[styles.thumb, { backgroundColor: colors.surface2 }]} />
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.spotTitle} numberOfLines={1}>{s.spot.title}</Text>
                          {(s.spot.city || s.spot.state) && (
                            <Text style={styles.spotMeta} numberOfLines={1}>{[s.spot.city, s.spot.state].filter(Boolean).join(', ')}</Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    )}
                    {!!s.narrative && <Text style={styles.slotText}>{s.narrative}</Text>}
                    {!!s.tip && <Text style={styles.slotTip}>💡 {s.tip}</Text>}
                  </View>
                );
              })}
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
  iconBubble: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,181,71,0.14)', borderWidth: 1, borderColor: 'rgba(255,181,71,0.35)', marginBottom: space.md },
  head: { color: colors.text, fontFamily: font.display, fontSize: 26, letterSpacing: -0.5 },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13.5, lineHeight: 20, marginTop: 6 },
  label: { color: colors.textSecondary, fontFamily: font.bodySemibold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', marginTop: space.lg, marginBottom: 6 },
  input: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 12, color: colors.text, fontFamily: font.body, fontSize: 14 },
  seg: { flex: 1, paddingVertical: 12, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  segActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12.5 },
  segTxtActive: { color: '#fff', fontFamily: font.bodyBold },
  err: { color: colors.secondary, fontFamily: font.body, fontSize: 12, marginTop: 8 },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radii.md, marginTop: space.lg },
  ctaTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 14 },
  planTitle: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.4 },
  planBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13.5, lineHeight: 20, marginTop: 4, marginBottom: space.md },
  slotCard: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: space.md, marginBottom: 10 },
  slotHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  slotLabel: { color: colors.text, fontFamily: font.bodyBold, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  slotTime: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  slotSpot: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface2, borderRadius: radii.md, padding: 8, marginBottom: 6 },
  thumb: { width: 48, height: 48, borderRadius: radii.sm },
  spotTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13.5 },
  spotMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 1 },
  slotText: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12.5, lineHeight: 18 },
  slotTip: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11.5, lineHeight: 17, marginTop: 6 },
  disclosure: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 10, textAlign: 'center' },
});
