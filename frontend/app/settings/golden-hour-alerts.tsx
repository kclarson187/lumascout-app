/**
 * Golden Hour Alerts settings screen.
 * Path: /settings/golden-hour-alerts
 *
 * Phase 1 (Jun 2026) — App Store-ready golden-hour push notifications.
 *
 * Surfaces the four toggles from the user spec (master, starting-soon,
 * starts-now, reminder timing) plus quiet hours + daily cap. Free users
 * see all toggles in a "locked" state with an inline Pro/Elite upsell
 * that routes to the existing paywall (no new paywall is created).
 *
 * Backed by:
 *   • GET  /api/me/golden-hour-preferences
 *   • PATCH /api/me/golden-hour-preferences
 *
 * Permission priming: the FIRST time the user enables the master
 * toggle on iOS, we present a custom priming card BEFORE iOS's native
 * permission prompt — Apple HIG requirement.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch,
  ActivityIndicator, Alert, Platform, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import {
  ArrowLeft, Sparkles, Moon, Clock, Zap, Lock, Crown, Sun,
} from 'lucide-react-native';
import * as Notifications from 'expo-notifications';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';

type Prefs = {
  enabled: boolean;
  startingSoonEnabled: boolean;
  startsNowEnabled: boolean;
  reminderMinutesBefore: number;
  savedSpotsOnly: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  maxGoldenHourNotificationsPerDay: number;
  updatedAt?: string | null;
};

type Tier = 'anon' | 'free' | 'pro' | 'elite';

const REMINDER_OPTIONS: { value: 15 | 30 | 60; label: string }[] = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
];

const CAP_OPTIONS = [1, 2, 3, 5];
const QUIET_PRESETS: [string, string][] = [
  ['21:00', '07:00'], ['22:00', '07:00'], ['23:00', '08:00'], ['00:00', '09:00'],
];

export default function GoldenHourAlerts() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [tier, setTier] = useState<Tier>('anon');
  const [canEnable, setCanEnable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPriming, setShowPriming] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/me/golden-hour-preferences');
      setPrefs(r.preferences);
      setTier(r.tier);
      setCanEnable(!!r.can_enable);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not load Golden Hour preferences.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Save a partial patch + optimistic merge. */
  const save = async (patch: Partial<Prefs>) => {
    if (!prefs) return;
    setSaving(true);
    const next: Prefs = { ...prefs, ...patch };
    setPrefs(next);
    try {
      const r = await api.patch('/me/golden-hour-preferences', patch);
      setPrefs(r.preferences);
    } catch (e: any) {
      const detail = e?.data?.detail || e?.message;
      // Free user tried to flip enabled=true → route to paywall.
      if (e?.status === 402 || detail === 'pro_required') {
        // revert optimistic update
        setPrefs(prefs);
        router.push('/paywall?reason=golden_hour' as any);
        return;
      }
      // Revert + show error
      setPrefs(prefs);
      Alert.alert("Couldn't save", String(detail || 'Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  /** Master toggle with permission priming on first iOS enable. */
  const toggleMaster = async () => {
    if (!prefs) return;
    if (!canEnable) {
      router.push('/paywall?reason=golden_hour' as any);
      return;
    }
    const turningOn = !prefs.enabled;
    if (turningOn && Platform.OS === 'ios') {
      // Check current permission state — if undetermined, show priming.
      try {
        const status = await Notifications.getPermissionsAsync();
        if (!status.granted && (status as any).canAskAgain !== false) {
          setShowPriming(true);
          return; // priming flow handles the actual save
        }
        if (!status.granted && (status as any).canAskAgain === false) {
          Alert.alert(
            'Notifications are off',
            'Open Settings → LumaScout → Notifications to enable Golden Hour Alerts.',
          );
          return;
        }
      } catch {
        // continue — non-fatal
      }
    }
    save({ enabled: turningOn });
  };

  const grantAndEnable = async () => {
    setShowPriming(false);
    try {
      const r = await Notifications.requestPermissionsAsync();
      if (!r.granted) {
        Alert.alert(
          'Notifications declined',
          "We won't be able to alert you for golden hour. You can change this in Settings → LumaScout → Notifications.",
        );
        return;
      }
      save({ enabled: true });
    } catch (e: any) {
      Alert.alert('Permission error', String(e?.message || e));
    }
  };

  if (loading || !prefs) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.empty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const locked = !canEnable;
  const dim = (on: boolean) => (on && !locked ? colors.text : colors.textTertiary);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity style={styles.hBtn} onPress={() => router.back()} testID="gh-back">
          <ArrowLeft size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Golden Hour Alerts</Text>
          <Text style={styles.headerSub}>
            {locked ? 'Pro feature' : 'Personalised for your saved spots'}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 80 }}>
        {/* Hero */}
        <View style={styles.heroCard}>
          <View style={[styles.iconRing, { backgroundColor: 'rgba(245,166,35,0.15)' }]}>
            <Sun size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>Catch the best light</Text>
            <Text style={styles.heroSub}>
              We'll ping you before golden and blue hour at your saved spots — twice at most per day.
            </Text>
          </View>
        </View>

        {/* Pro / Elite upsell banner (Free only) */}
        {locked && (
          <TouchableOpacity
            style={styles.upsell}
            onPress={() => router.push('/paywall?reason=golden_hour' as any)}
            testID="gh-upsell"
          >
            <View style={[styles.iconRing, { backgroundColor: 'rgba(245,166,35,0.18)' }]}>
              <Crown size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.upsellTitle}>Unlock with Pro</Text>
              <Text style={styles.upsellSub}>
                Golden Hour alerts at your saved spots, two pushes/day max.
              </Text>
            </View>
            <Text style={styles.upsellCta}>See plans</Text>
          </TouchableOpacity>
        )}

        {/* Master toggle */}
        <Text style={styles.section}>Master</Text>
        <View style={styles.sectionCard}>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              {locked ? <Lock size={16} color={colors.textTertiary} /> : <Sparkles size={16} color={prefs.enabled ? colors.primary : colors.textTertiary} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: dim(prefs.enabled) }]}>Golden Hour Alerts</Text>
              <Text style={styles.rowHint}>
                {locked ? 'Pro or Elite required.' : 'Master switch for golden + blue hour reminders.'}
              </Text>
            </View>
            <Switch
              value={!locked && prefs.enabled}
              onValueChange={toggleMaster}
              disabled={saving}
              trackColor={{ false: colors.surface2, true: colors.primary }}
              thumbColor="#fff"
              testID="gh-master"
            />
          </View>
        </View>

        {/* Sub-toggles */}
        <Text style={styles.section}>What to send</Text>
        <View style={styles.sectionCard}>
          <View style={[styles.row, styles.rowDivider]}>
            <View style={styles.rowIcon}>
              <Clock size={16} color={dim(prefs.startingSoonEnabled)} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: dim(prefs.startingSoonEnabled) }]}>Starting Soon Reminder</Text>
              <Text style={styles.rowHint}>
                Heads-up before the window opens.
              </Text>
            </View>
            <Switch
              value={!locked && prefs.startingSoonEnabled}
              onValueChange={() => !locked && save({ startingSoonEnabled: !prefs.startingSoonEnabled })}
              disabled={locked || saving}
              trackColor={{ false: colors.surface2, true: colors.primary }}
              thumbColor="#fff"
              testID="gh-starting-soon"
            />
          </View>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Zap size={16} color={dim(prefs.startsNowEnabled)} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: dim(prefs.startsNowEnabled) }]}>Starts Now Alert</Text>
              <Text style={styles.rowHint}>Fires when the window opens (≤5 min out).</Text>
            </View>
            <Switch
              value={!locked && prefs.startsNowEnabled}
              onValueChange={() => !locked && save({ startsNowEnabled: !prefs.startsNowEnabled })}
              disabled={locked || saving}
              trackColor={{ false: colors.surface2, true: colors.primary }}
              thumbColor="#fff"
              testID="gh-starts-now"
            />
          </View>
        </View>

        {/* Reminder timing */}
        <Text style={styles.section}>Reminder timing</Text>
        <View style={styles.sectionCard}>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Clock size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Send the early reminder</Text>
              <Text style={styles.rowHint}>How far ahead to ping for "starting soon".</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {REMINDER_OPTIONS.map((opt) => {
                const active = prefs.reminderMinutesBefore === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => !locked && save({ reminderMinutesBefore: opt.value })}
                    disabled={locked || saving}
                    testID={`gh-reminder-${opt.value}`}
                  >
                    <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* Quiet hours */}
        <Text style={styles.section}>Quiet hours</Text>
        <View style={styles.sectionCard}>
          <View style={[styles.row, prefs.quietHoursEnabled && styles.rowDivider]}>
            <View style={styles.rowIcon}>
              <Moon size={16} color={prefs.quietHoursEnabled ? colors.primary : colors.textTertiary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>
                Silence between {prefs.quietHoursStart} – {prefs.quietHoursEnd}
              </Text>
              <Text style={styles.rowHint}>Uses your device timezone.</Text>
            </View>
            <Switch
              value={prefs.quietHoursEnabled}
              onValueChange={() => save({ quietHoursEnabled: !prefs.quietHoursEnabled })}
              disabled={saving}
              trackColor={{ false: colors.surface2, true: colors.primary }}
              thumbColor="#fff"
              testID="gh-quiet"
            />
          </View>
          {prefs.quietHoursEnabled && (
            <View style={styles.row}>
              <View style={styles.rowIcon} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>Window</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {QUIET_PRESETS.map(([s, e]) => {
                  const active = prefs.quietHoursStart === s && prefs.quietHoursEnd === e;
                  return (
                    <TouchableOpacity
                      key={`${s}-${e}`}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => save({ quietHoursStart: s, quietHoursEnd: e })}
                      disabled={saving}
                    >
                      <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>
                        {s.slice(0, 2)}–{e.slice(0, 2)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        </View>

        {/* Daily cap */}
        <Text style={styles.section}>Daily limit</Text>
        <View style={styles.sectionCard}>
          <View style={styles.row}>
            <View style={styles.rowIcon}><Zap size={16} color={colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Max golden-hour pushes / day</Text>
              <Text style={styles.rowHint}>2 is plenty — one morning, one evening.</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {CAP_OPTIONS.map((n) => {
                const active = prefs.maxGoldenHourNotificationsPerDay === n;
                return (
                  <TouchableOpacity
                    key={n}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => !locked && save({ maxGoldenHourNotificationsPerDay: n })}
                    disabled={locked || saving}
                  >
                    <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{n}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* Saved-spots only chip (informational; locked at savedSpotsOnly=true in Phase 1) */}
        <Text style={styles.footHint}>
          Pings only fire at your saved spots in this release.
        </Text>
      </ScrollView>

      {/* iOS Permission Priming */}
      <Modal visible={showPriming} animationType="fade" transparent onRequestClose={() => setShowPriming(false)}>
        <View style={styles.primeBackdrop}>
          <View style={styles.primeCard}>
            <View style={[styles.iconRing, { backgroundColor: 'rgba(245,166,35,0.15)', alignSelf: 'center' }]}>
              <Sun size={26} color={colors.primary} />
            </View>
            <Text style={styles.primeTitle}>Allow Golden Hour Alerts?</Text>
            <Text style={styles.primeSub}>
              LumaScout will only send a friendly heads-up before golden + blue hour at your saved spots. Two pushes per day max. You can turn this off any time.
            </Text>
            <TouchableOpacity style={styles.primeBtn} onPress={grantAndEnable} testID="gh-prime-allow">
              <Text style={styles.primeBtnTxt}>Allow notifications</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primeBtnGhost} onPress={() => setShowPriming(false)} testID="gh-prime-skip">
              <Text style={styles.primeBtnGhostTxt}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.sm, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  hBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 16 },
  headerSub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 2 },

  heroCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: space.md, marginTop: space.md,
    padding: 14, borderRadius: radii.lg,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  iconRing: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  heroSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2, lineHeight: 17 },

  upsell: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: space.md, marginTop: space.md,
    padding: 12, borderRadius: radii.lg,
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.40)',
  },
  upsellTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  upsellSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
  upsellCta: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 12 },

  section: {
    color: colors.textTertiary, fontFamily: font.bodyBold, fontSize: 10,
    letterSpacing: 1, textTransform: 'uppercase',
    paddingHorizontal: space.md, paddingTop: space.lg, paddingBottom: 6,
  },
  sectionCard: {
    marginHorizontal: space.md, borderRadius: radii.lg,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 14,
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowIcon: { width: 28, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  rowHint: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2, lineHeight: 16 },

  chip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill,
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.4 },
  chipTxtActive: { color: colors.textInverse },

  footHint: {
    color: colors.textTertiary, fontFamily: font.body, fontSize: 11,
    paddingHorizontal: space.md, paddingTop: space.md, lineHeight: 16,
  },

  // Priming modal
  primeBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center', padding: space.xxl,
  },
  primeCard: {
    width: '100%', maxWidth: 360,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg, padding: space.xxl,
    borderWidth: 1, borderColor: colors.border,
    gap: 12, alignItems: 'center',
  },
  primeTitle: {
    color: colors.text, fontFamily: font.display, fontSize: 20,
    textAlign: 'center', letterSpacing: -0.3, marginTop: 4,
  },
  primeSub: {
    color: colors.textSecondary, fontFamily: font.body, fontSize: 13,
    textAlign: 'center', lineHeight: 19,
  },
  primeBtn: {
    marginTop: 8, width: '100%',
    paddingVertical: 14, borderRadius: radii.md,
    backgroundColor: colors.primary, alignItems: 'center',
  },
  primeBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 15 },
  primeBtnGhost: { paddingVertical: 8, alignItems: 'center' },
  primeBtnGhostTxt: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 13 },
});
