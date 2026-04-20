/**
 * Scout AI — Quick preference setup (FLOW 2).
 * 4 questions, all optional. Saves to POST /api/ai/preferences then routes to
 * the personalized-welcome reply in /scout-ai.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, Check } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import ScoutAIAvatar from '../../src/components/ScoutAIAvatar';

const SHOOTS = ['Family', 'Pet', 'Portrait', 'Seniors', 'Branding', 'Wedding', 'Nature', 'Urban'];
const PRIORITIES = [
  'Easy parking', 'Low crowds', 'Strong sunset', 'Strong sunrise',
  'Background variety', 'Family-friendly', 'Dog-friendly', 'Quick access',
  'Hidden gems', 'Seasonal scenery',
];
const DISTANCES: Array<{ label: string; value: string }> = [
  { label: 'Under 15 miles', value: '15' },
  { label: 'Under 30 miles', value: '30' },
  { label: 'Under 60 miles', value: '60' },
  { label: 'Road trip mode', value: 'roadtrip' },
];
const TIMES: Array<{ label: string; value: string }> = [
  { label: 'Sunrise', value: 'sunrise' },
  { label: 'Morning', value: 'morning' },
  { label: 'Golden hour', value: 'golden_hour' },
  { label: 'Sunset', value: 'sunset' },
  { label: 'Evening', value: 'evening' },
  { label: 'It depends', value: 'flexible' },
];

const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '');

export default function ScoutAISetup() {
  const [shoots, setShoots] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [distance, setDistance] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const togglePriority = (p: string) => {
    setPriorities((prev) => {
      if (prev.includes(p)) return prev.filter((x) => x !== p);
      if (prev.length >= 3) return prev; // spec: up to 3
      return [...prev, p];
    });
  };

  const submit = async (skip = false) => {
    setSaving(true);
    try {
      if (!skip) {
        await api.post('/ai/preferences', {
          shoots: shoots.map(toSlug),
          priorities: priorities.map(toSlug),
          max_distance: distance,
          preferred_time: time,
        });
      }
      // FLOW 3: personalized welcome inside the chat — we compose a reassuring
      // opener from the preferences that just got saved (or a generic one if
      // the user skipped).
      const topShoots = shoots.slice(0, 2).join(' + ') || 'your style';
      const topPris = priorities.slice(0, 2).join(', ').toLowerCase() || 'what matters most to you';
      const opener = skip
        ? ''
        : `Prioritise ${topShoots} with an emphasis on ${topPris}. Suggest a few starter spots.`;
      router.replace({
        pathname: '/scout-ai',
        params: opener ? { placement: 'home', q: opener } : { placement: 'home' },
      } as any);
    } catch (e) {
      Alert.alert('Scout AI', formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
          <ScoutAIAvatar size={32} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Help me tailor your scouting</Text>
            <Text style={styles.subtitle}>4 quick questions — all optional</Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 120, gap: 24 }}>
        {/* Q1 */}
        <View style={{ gap: 8 }}>
          <Text style={styles.qLabel}>1. What do you shoot most often?</Text>
          <Text style={styles.qHint}>Pick any that fit — multiple is fine.</Text>
          <View style={styles.chipWrap}>
            {SHOOTS.map((s) => {
              const active = shoots.includes(s);
              return (
                <TouchableOpacity
                  key={s}
                  onPress={() => setShoots((p) => active ? p.filter((x) => x !== s) : [...p, s])}
                  style={[styles.chip, active && styles.chipActive]}
                  testID={`scout-shoot-${toSlug(s)}`}
                >
                  {active && <Check size={11} color={colors.textInverse} />}
                  <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{s}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Q2 */}
        <View style={{ gap: 8 }}>
          <Text style={styles.qLabel}>2. What matters most when picking a spot?</Text>
          <Text style={styles.qHint}>Select up to 3 · {priorities.length}/3</Text>
          <View style={styles.chipWrap}>
            {PRIORITIES.map((p) => {
              const active = priorities.includes(p);
              return (
                <TouchableOpacity
                  key={p}
                  onPress={() => togglePriority(p)}
                  style={[styles.chip, active && styles.chipActive]}
                  disabled={!active && priorities.length >= 3}
                  testID={`scout-prio-${toSlug(p)}`}
                >
                  {active && <Check size={11} color={colors.textInverse} />}
                  <Text style={[styles.chipTxt, active && styles.chipTxtActive, !active && priorities.length >= 3 && { opacity: 0.4 }]}>
                    {p}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Q3 */}
        <View style={{ gap: 8 }}>
          <Text style={styles.qLabel}>3. How far are you usually willing to drive?</Text>
          <View style={styles.chipWrap}>
            {DISTANCES.map((d) => {
              const active = distance === d.value;
              return (
                <TouchableOpacity
                  key={d.value}
                  onPress={() => setDistance(active ? null : d.value)}
                  style={[styles.chip, active && styles.chipActive]}
                  testID={`scout-dist-${d.value}`}
                >
                  {active && <Check size={11} color={colors.textInverse} />}
                  <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{d.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Q4 */}
        <View style={{ gap: 8 }}>
          <Text style={styles.qLabel}>4. When do you usually shoot?</Text>
          <View style={styles.chipWrap}>
            {TIMES.map((t) => {
              const active = time === t.value;
              return (
                <TouchableOpacity
                  key={t.value}
                  onPress={() => setTime(active ? null : t.value)}
                  style={[styles.chip, active && styles.chipActive]}
                  testID={`scout-time-${t.value}`}
                >
                  {active && <Check size={11} color={colors.textInverse} />}
                  <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity onPress={() => submit(true)} style={styles.secondaryBtn} disabled={saving}>
          <Text style={styles.secondaryTxt}>Skip for now</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => submit(false)}
          style={[styles.primaryBtn, saving && { opacity: 0.5 }]}
          disabled={saving}
          testID="scout-setup-submit"
        >
          <Text style={styles.primaryTxt}>{saving ? 'Saving…' : 'See my recommendations'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: space.xl, paddingVertical: space.md,
    borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 18, letterSpacing: -0.2 },
  subtitle: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 1 },
  qLabel: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  qHint: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },
  chipTxtActive: { color: colors.textInverse, fontFamily: font.bodySemibold },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', gap: 8,
    paddingHorizontal: space.xl, paddingVertical: space.md,
    backgroundColor: colors.bg,
    borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryBtn: {
    flex: 1, backgroundColor: colors.primary, paddingVertical: 14,
    borderRadius: radii.md, alignItems: 'center',
  },
  primaryTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 13, letterSpacing: 0.2 },
  secondaryBtn: { paddingHorizontal: 16, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  secondaryTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13 },
});
