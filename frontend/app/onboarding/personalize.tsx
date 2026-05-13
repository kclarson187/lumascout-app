/**
 * /onboarding/personalize — Phase 2.1 (Jun 2025).
 *
 * Skippable step #4 in the new-user wizard. Captures three quick
 * signals so the rest of the app can tune recommendations:
 *   • Specialties     (multi-select chips, 12 options)
 *   • Goals           (multi-select chips, 6 options)
 *   • Experience      (single-select radio cards, 4 levels)
 *
 * Save:    PATCH /auth/me → /onboarding/location
 * Skip:    → /(tabs) directly
 *
 * No validation — all fields are optional. We do require at least
 * something to enable the primary CTA only as a soft nudge.
 */
import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Sparkles, Check } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import { SPECIALTIES, GOALS, EXPERIENCE_LEVELS } from '../../src/constants/onboardingOptions';

export default function OnboardingPersonalize() {
  const { user, refresh } = useAuth();

  const [specialties, setSpecialties] = useState<string[]>(user?.specialties || []);
  const [goals,       setGoals]       = useState<string[]>(user?.goals || []);
  const [experience,  setExperience]  = useState<string | null>(user?.experience_level || null);
  const [saving,      setSaving]      = useState(false);

  const toggleSpec = (k: string) => setSpecialties((prev) =>
    prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
  );
  const toggleGoal = (k: string) => setGoals((prev) =>
    prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
  );

  const anyPicked = useMemo(
    () => specialties.length > 0 || goals.length > 0 || !!experience,
    [specialties, goals, experience],
  );

  const persistAndNext = async (next: string) => {
    setSaving(true);
    try {
      await api.patch('/auth/me', {
        specialties,
        goals,
        experience_level: experience,
      });
      await refresh();
      router.replace(next as any);
    } catch (e) {
      Alert.alert('Couldn\'t save', formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const onContinue = () => persistAndNext('/onboarding/location');
  const onSkip     = () => router.replace('/(tabs)' as any);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* progress — step 2 of 4 */}
        <View style={styles.progressRow}>
          <View style={[styles.progressDot, styles.progressDotDone]} />
          <View style={[styles.progressDot, styles.progressDotActive]} />
          <View style={styles.progressDot} />
          <View style={styles.progressDot} />
        </View>

        <Text style={styles.head}>What do you want from LumaScout?</Text>
        <Text style={styles.sub}>Pick a few so we can tune your feed.</Text>

        {/* Specialties */}
        <Text style={styles.sectionLabel}>What do you shoot?</Text>
        <View style={styles.chipWrap}>
          {SPECIALTIES.map((s) => {
            const on = specialties.includes(s.key);
            return (
              <Pressable
                key={s.key}
                onPress={() => toggleSpec(s.key)}
                style={[styles.chip, on && styles.chipOn]}
                testID={`personalize-spec-${s.key}`}
              >
                <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Goals */}
        <Text style={styles.sectionLabel}>What are you looking for?</Text>
        <View style={styles.chipWrap}>
          {GOALS.map((g) => {
            const on = goals.includes(g.key);
            return (
              <Pressable
                key={g.key}
                onPress={() => toggleGoal(g.key)}
                style={[styles.chip, on && styles.chipOn]}
                testID={`personalize-goal-${g.key}`}
              >
                <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{g.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Experience */}
        <Text style={styles.sectionLabel}>How would you describe yourself?</Text>
        <View style={{ gap: 8 }}>
          {EXPERIENCE_LEVELS.map((e) => {
            const on = experience === e.key;
            return (
              <Pressable
                key={e.key}
                onPress={() => setExperience(on ? null : e.key)}
                style={[styles.expRow, on && styles.expRowOn]}
                testID={`personalize-exp-${e.key}`}
              >
                <View style={[styles.radio, on && styles.radioOn]}>
                  {on ? <Check size={11} color={colors.textInverse} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.expLabel}>{e.label}</Text>
                  {e.helper ? <Text style={styles.expHelper}>{e.helper}</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Actions */}
        <View style={{ gap: 10, marginTop: space.xxl }}>
          <TouchableOpacity
            onPress={onContinue}
            disabled={saving}
            style={[styles.primaryBtn, (!anyPicked || saving) && styles.primaryBtnDim]}
            testID="personalize-continue"
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <>
                <Sparkles size={14} color={colors.textInverse} />
                <Text style={styles.primaryBtnTxt}>See my recommendations</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onSkip}
            disabled={saving}
            style={styles.skipBtn}
            testID="personalize-skip"
            activeOpacity={0.7}
          >
            <Text style={styles.skipTxt}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  content: { padding: space.xl, paddingBottom: space.xxxl, gap: 6 },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.lg },
  progressDot: { width: 18, height: 3, borderRadius: 2, backgroundColor: colors.border },
  progressDotActive: { backgroundColor: colors.primary, width: 22 },
  progressDotDone: { backgroundColor: 'rgba(245,166,35,0.55)' },

  head: { color: colors.text, fontFamily: font.display, fontSize: 28, letterSpacing: -0.4, lineHeight: 34 },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, marginTop: 6, lineHeight: 20 },

  sectionLabel: {
    color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11,
    letterSpacing: 0.7, textTransform: 'uppercase',
    marginTop: space.xl, marginBottom: 10,
  },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    minHeight: 36, justifyContent: 'center',
  },
  chipOn: {
    backgroundColor: 'rgba(245,166,35,0.16)', borderColor: colors.primary,
  },
  chipTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 13 },
  chipTxtOn: { color: colors.primary, fontFamily: font.bodyBold },

  expRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: space.md, paddingVertical: 12,
    borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    minHeight: 56,
  },
  expRowOn: { borderColor: colors.primary, backgroundColor: 'rgba(245,166,35,0.08)' },
  radio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 1.5, borderColor: colors.textTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  expLabel: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  expHelper: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 2 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: radii.md,
    paddingVertical: 14, minHeight: 48,
  },
  primaryBtnDim: { opacity: 0.6 },
  primaryBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 15 },
  skipBtn: { paddingVertical: 12, alignItems: 'center' },
  skipTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13 },
});
