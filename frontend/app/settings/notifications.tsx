/**
 * Notifications preferences screen.
 * Path: /settings/notifications
 *
 * Gives users fine-grained control: per-category toggles, quiet hours,
 * daily cap, master on/off, plus a "Send test push" button so they can
 * verify delivery on-device.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import {
  ArrowLeft, Bell, BellOff, Moon, Zap, Compass, Users, MessageSquare,
  Sparkles, ShoppingBag, MessageCircle, Megaphone, Clock, TestTube,
} from 'lucide-react-native';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';

type Prefs = {
  push_enabled: boolean;
  daily_cap: number;
  timezone: string;
  quiet_hours: { enabled: boolean; start: string; end: string };
  categories: {
    explore: boolean; network: boolean; messages: boolean;
    referrals: boolean; marketplace: boolean; community: boolean;
    promotions: boolean;
  };
};

const CATEGORY_META: { key: keyof Prefs['categories']; label: string; hint: string; icon: any }[] = [
  { key: 'explore',     label: 'Explore & spots',   hint: 'New top-rated spots near you, golden hour tips, trending locations.', icon: Compass },
  { key: 'messages',    label: 'Messages',          hint: 'DM requests + incoming messages.',                                  icon: MessageSquare },
  { key: 'network',     label: 'Network',           hint: 'Profile viewers + new followers.',                                  icon: Users },
  { key: 'referrals',   label: 'Referrals',         hint: 'New referral gigs near you + application updates.',                 icon: Sparkles },
  { key: 'marketplace', label: 'Marketplace',       hint: 'Sales, payouts, refunds, wishlist deals.',                          icon: ShoppingBag },
  { key: 'community',   label: 'Community',         hint: 'Featured uploads, replies to your posts, poll updates.',            icon: MessageCircle },
  { key: 'promotions',  label: 'Tips & promotions', hint: 'Occasional nudges about Pro / Elite perks and creator tools.',      icon: Megaphone },
];

const DAILY_CAP_OPTIONS = [3, 5, 10, 15, 25];

export default function NotificationsPrefs() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/me/notification-preferences');
      setPrefs(r);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Could not load preferences.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (patch: Partial<Prefs> | { categories?: Partial<Prefs['categories']> } | { quiet_hours?: Partial<Prefs['quiet_hours']> }) => {
    if (saving) return;
    setSaving(true);
    try {
      const r = await api.patch('/me/notification-preferences', patch);
      setPrefs(r);
    } catch (e: any) {
      Alert.alert('Could not save', e?.response?.data?.detail || 'Please try again.');
    } finally { setSaving(false); }
  };

  const toggleCategory = (key: keyof Prefs['categories']) => {
    if (!prefs) return;
    save({ categories: { [key]: !prefs.categories[key] } } as any);
  };

  const toggleQuiet = () => {
    if (!prefs) return;
    save({ quiet_hours: { enabled: !prefs.quiet_hours.enabled } } as any);
  };

  const togglePush = () => {
    if (!prefs) return;
    save({ push_enabled: !prefs.push_enabled });
  };

  const setCap = (n: number) => save({ daily_cap: n });

  const sendTestPush = async () => {
    if (testing) return;
    setTesting(true);
    try {
      const r = await api.post('/me/notifications/test-push', {});
      if (r.delivered) {
        Alert.alert(
          'Test push queued',
          Platform.OS === 'web'
            ? 'Pushes only arrive on a real mobile device. Install the app on your phone to see this land.'
            : 'A test push is on its way. If it doesn\'t arrive, check device-level notification permissions.'
        );
      } else {
        Alert.alert(
          'Not sent',
          'Your current preferences blocked this push. Check: push_enabled, promotions category, quiet hours, or daily cap.',
        );
      }
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Please try again.');
    } finally { setTesting(false); }
  };

  if (loading || !prefs) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.hBtn} hitSlop={10}>
          <ArrowLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Notifications</Text>
          <Text style={styles.headerSub}>Stay in the loop without the noise.</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Master toggle */}
        <View style={styles.heroCard}>
          <View style={[styles.iconRing, { backgroundColor: prefs.push_enabled ? 'rgba(245,166,35,0.14)' : colors.surface2 }]}>
            {prefs.push_enabled
              ? <Bell size={22} color={colors.primary} />
              : <BellOff size={22} color={colors.textTertiary} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>Push notifications</Text>
            <Text style={styles.heroSub}>Master switch for all mobile pushes.</Text>
          </View>
          <Switch
            value={prefs.push_enabled}
            onValueChange={togglePush}
            trackColor={{ false: colors.surface2, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>

        {/* Categories */}
        <Text style={styles.section}>Categories</Text>
        <View style={styles.sectionCard}>
          {CATEGORY_META.map((c, idx) => {
            const Icon = c.icon;
            const on = !!prefs.categories[c.key];
            return (
              <View key={c.key} style={[styles.row, idx < CATEGORY_META.length - 1 && styles.rowDivider]}>
                <View style={styles.rowIcon}>
                  <Icon size={16} color={on ? colors.primary : colors.textTertiary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, !on && { color: colors.textTertiary }]}>{c.label}</Text>
                  <Text style={styles.rowHint}>{c.hint}</Text>
                </View>
                <Switch
                  value={on}
                  onValueChange={() => toggleCategory(c.key)}
                  trackColor={{ false: colors.surface2, true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>
            );
          })}
        </View>

        {/* Quiet hours */}
        <Text style={styles.section}>Quiet hours</Text>
        <View style={styles.sectionCard}>
          <View style={styles.row}>
            <View style={styles.rowIcon}><Moon size={16} color={prefs.quiet_hours.enabled ? colors.primary : colors.textTertiary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, !prefs.quiet_hours.enabled && { color: colors.textTertiary }]}>Silence between {prefs.quiet_hours.start} – {prefs.quiet_hours.end}</Text>
              <Text style={styles.rowHint}>Uses your device timezone ({prefs.timezone}).</Text>
            </View>
            <Switch
              value={prefs.quiet_hours.enabled}
              onValueChange={toggleQuiet}
              trackColor={{ false: colors.surface2, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
          {prefs.quiet_hours.enabled && (
            <View style={[styles.row, styles.rowDivider, { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <View style={styles.rowIcon}><Clock size={16} color={colors.textSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>Window</Text>
                <Text style={styles.rowHint}>Tap to edit start / end (HH:MM 24h).</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {[['21:00', '07:00'], ['22:00', '07:00'], ['23:00', '08:00'], ['00:00', '09:00']].map(([s, e]) => {
                  const active = prefs.quiet_hours.start === s && prefs.quiet_hours.end === e;
                  return (
                    <TouchableOpacity
                      key={`${s}-${e}`}
                      style={[styles.window, active && styles.windowActive]}
                      onPress={() => save({ quiet_hours: { enabled: true, start: s, end: e } } as any)}
                    >
                      <Text style={[styles.windowTxt, active && styles.windowTxtActive]}>{s.slice(0, 2)}–{e.slice(0, 2)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        </View>

        {/* Daily cap */}
        <Text style={styles.section}>Frequency</Text>
        <View style={styles.sectionCard}>
          <View style={styles.row}>
            <View style={styles.rowIcon}><Zap size={16} color={colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Max pushes per day</Text>
              <Text style={styles.rowHint}>We'll never exceed this — high-priority first.</Text>
            </View>
          </View>
          <View style={styles.capRow}>
            {DAILY_CAP_OPTIONS.map((n) => {
              const active = prefs.daily_cap === n;
              return (
                <TouchableOpacity key={n} style={[styles.capChip, active && styles.capChipActive]} onPress={() => setCap(n)}>
                  <Text style={[styles.capTxt, active && styles.capTxtActive]}>{n}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Phase 1 (Jun 2026) — Golden Hour entry row */}
        <Text style={styles.section}>Photography</Text>
        <View style={styles.sectionCard}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/settings/golden-hour-alerts' as any)}
            testID="goto-golden-hour-alerts"
          >
            <View style={styles.rowIcon}>
              <Sparkles size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Golden Hour Alerts</Text>
              <Text style={styles.rowHint}>
                Get reminded before golden + blue hour at your saved spots.
              </Text>
            </View>
            <Text style={[styles.rowHint, { color: colors.primary }]}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Test push */}
        <TouchableOpacity style={styles.testBtn} onPress={sendTestPush} disabled={testing || !prefs.push_enabled} activeOpacity={0.8}>
          {testing ? <ActivityIndicator color={colors.textInverse} /> : (
            <>
              <TestTube size={16} color={colors.textInverse} />
              <Text style={styles.testTxt}>Send test push</Text>
            </>
          )}
        </TouchableOpacity>
        <Text style={styles.testHint}>
          Pushes only deliver to real devices with notifications allowed. On web this is a no-op.
        </Text>
      </ScrollView>
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
  heroTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  heroSub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 2 },

  section: {
    color: colors.textTertiary, fontFamily: font.bodyBold, fontSize: 10,
    letterSpacing: 1.1, paddingHorizontal: space.lg, marginTop: space.xl, marginBottom: 8,
  },
  sectionCard: {
    marginHorizontal: space.md,
    backgroundColor: colors.surface1, borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowIcon: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },
  rowHint: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 3, lineHeight: 15 },

  window: {
    paddingHorizontal: 8, height: 26, borderRadius: 13,
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  windowActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  windowTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 10 },
  windowTxtActive: { color: colors.textInverse },

  capRow: { flexDirection: 'row', gap: 8, padding: 14, paddingTop: 0 },
  capChip: {
    width: 42, height: 36, borderRadius: 18,
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  capChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  capTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 13 },
  capTxtActive: { color: colors.textInverse },

  testBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginHorizontal: space.md, marginTop: space.xl,
    paddingVertical: 13, borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  testTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },
  testHint: {
    color: colors.textTertiary, fontFamily: font.body, fontSize: 11,
    textAlign: 'center', marginHorizontal: space.xl, marginTop: 8, lineHeight: 15,
  },
});
