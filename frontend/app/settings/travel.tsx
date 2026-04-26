/**
 * Settings ▸ Travel & Explore
 *
 * Persists to user.travel_prefs via PATCH /api/auth/me.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { X } from 'lucide-react-native';
import { SettingsScreen, Section, Pill, Toggle } from '../../src/components/SettingsLayout';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import { colors, font } from '../../src/theme';

const RADII = [
  { key: 0, label: '0 mi' },
  { key: 25, label: '25 mi' },
  { key: 50, label: '50 mi' },
  { key: 100, label: '100 mi' },
  { key: 1000, label: 'Statewide' },
  { key: 99999, label: 'Nationwide' },
];
const INTERESTS = ['Elopements', 'Weddings', 'Pets', 'Branding', 'Landscape trips', 'Content creator work'];

export default function TravelExplore() {
  const { user, refresh } = useAuth() as any;
  const seed = (user?.travel_prefs || {}) as any;
  const [radius, setRadius] = useState<number>(seed.willing_to_travel_mi ?? 50);
  const [paid, setPaid] = useState<boolean>(seed.travel_for_paid_jobs ?? false);
  const [interests, setInterests] = useState<string[]>(Array.isArray(seed.interests) ? seed.interests : []);
  const [bucketInput, setBucketInput] = useState('');
  const [bucket, setBucket] = useState<string[]>(Array.isArray(seed.bucket_list) ? seed.bucket_list : []);
  const [saving, setSaving] = useState(false);

  const toggleInterest = (k: string) =>
    setInterests(interests.includes(k) ? interests.filter((x) => x !== k) : [...interests, k]);
  const addBucket = () => {
    const t = bucketInput.trim();
    if (!t || bucket.includes(t)) return;
    setBucket([...bucket, t]);
    setBucketInput('');
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/auth/me', {
        travel_prefs: {
          willing_to_travel_mi: radius,
          travel_for_paid_jobs: paid,
          interests,
          bucket_list: bucket,
        },
      });
      await refresh?.();
      Alert.alert('Saved', 'Your travel preferences have been updated.');
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsScreen
      title="Travel & Explore"
      subtitle="Tell LumaScout where you want opportunities"
      footer={
        <Pressable onPress={save} disabled={saving} style={[s.cta, saving && { opacity: 0.6 }]}>
          {saving ? <ActivityIndicator color="#1a1300" /> : <Text style={s.ctaTxt}>Save preferences</Text>}
        </Pressable>
      }
    >
      <Section label="WILLING TO TRAVEL">
        <View style={s.pillRow}>
          {RADII.map((r) => (
            <Pill key={r.key} label={r.label} active={radius === r.key} onPress={() => setRadius(r.key)} />
          ))}
        </View>
      </Section>

      <Section label="PAID OPPORTUNITIES">
        <Toggle
          label="Travel for paid jobs"
          helper="Show me referrals and bookings outside my home area when budget is offered."
          value={paid}
          onChange={setPaid}
        />
      </Section>

      <Section label="INTERESTED IN" helper="Used for referral matching and Explore suggestions.">
        <View style={s.pillRow}>
          {INTERESTS.map((i) => (
            <Pill key={i} label={i} active={interests.includes(i)} onPress={() => toggleInterest(i)} />
          ))}
        </View>
      </Section>

      <Section label="BUCKET LIST DESTINATIONS" helper="Cities or states you'd love to shoot. We'll surface trips and locals.">
        <View style={s.lensRow}>
          <TextInput
            value={bucketInput}
            onChangeText={setBucketInput}
            onSubmitEditing={addBucket}
            placeholder="e.g. Iceland, Big Sur, Patagonia"
            placeholderTextColor={colors.textTertiary}
            style={[s.input, { flex: 1 }]}
            returnKeyType="done"
            autoCapitalize="words"
          />
          <Pressable onPress={addBucket} style={s.addBtn}>
            <Text style={s.addBtnTxt}>Add</Text>
          </Pressable>
        </View>
        {bucket.length > 0 ? (
          <View style={[s.pillRow, { marginTop: 4 }]}>
            {bucket.map((b) => (
              <Pressable key={b} onPress={() => setBucket(bucket.filter((x) => x !== b))} style={s.tag}>
                <Text style={s.tagTxt}>{b}</Text>
                <X size={11} color={colors.textSecondary} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </Section>
    </SettingsScreen>
  );
}

const s = StyleSheet.create({
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  lensRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    minHeight: 44, paddingHorizontal: 12,
    backgroundColor: colors.surface2, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    color: colors.text, fontFamily: font.body, fontSize: 14,
  },
  addBtn: {
    height: 44, paddingHorizontal: 18, borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  addBtnTxt: { color: '#1a1300', fontFamily: font.bodyBold, fontSize: 13 },
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 11, height: 30, borderRadius: 15,
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
  },
  tagTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },
  cta: {
    height: 50, borderRadius: 25, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaTxt: { color: '#1a1300', fontFamily: font.bodyBold, fontSize: 15 },
});
