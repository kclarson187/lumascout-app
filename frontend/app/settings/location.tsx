/**
 * Settings ▸ Location Preferences
 *
 * Persists to user.location_prefs via PATCH /api/auth/me.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { SettingsScreen, Section, Pill, Toggle } from '../../src/components/SettingsLayout';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import { colors, font, space } from '../../src/theme';

const RADII = [
  { key: 10, label: '10 mi' },
  { key: 25, label: '25 mi' },
  { key: 50, label: '50 mi' },
  { key: 100, label: '100 mi' },
  { key: 99999, label: 'Anywhere' },
];

export default function LocationPreferences() {
  const { user, refresh } = useAuth() as any;
  const seed = (user?.location_prefs || {}) as any;
  const [radius, setRadius] = useState<number>(seed.discovery_radius_mi ?? 50);
  const [city, setCity] = useState<string>(seed.default_city ?? user?.city ?? '');
  const [useGps, setUseGps] = useState<boolean>(seed.use_live_gps ?? true);
  const [nearbyAlerts, setNearbyAlerts] = useState<boolean>(seed.nearby_notifications ?? true);
  const [hideExact, setHideExact] = useState<boolean>(seed.hide_exact_location ?? false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/auth/me', {
        location_prefs: {
          discovery_radius_mi: radius,
          default_city: city.trim() || null,
          use_live_gps: useGps,
          nearby_notifications: nearbyAlerts,
          hide_exact_location: hideExact,
        },
      });
      await refresh?.();
      Alert.alert('Saved', 'Your location preferences have been updated.');
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsScreen
      title="Location Preferences"
      subtitle="Control how LumaScout uses your location"
      footer={
        <Pressable onPress={save} disabled={saving} style={[s.cta, saving && { opacity: 0.6 }]}>
          {saving ? <ActivityIndicator color="#1a1300" /> : <Text style={s.ctaTxt}>Save preferences</Text>}
        </Pressable>
      }
    >
      <Section label="DISCOVERY RADIUS" helper="Used for Explore + Nearby sorting.">
        <View style={s.pillRow}>
          {RADII.map((r) => (
            <Pill key={r.key} label={r.label} active={radius === r.key} onPress={() => setRadius(r.key)} />
          ))}
        </View>
      </Section>

      <Section label="DEFAULT CITY" helper="Used when GPS is unavailable.">
        <TextInput
          value={city}
          onChangeText={setCity}
          placeholder="e.g. San Antonio, TX"
          placeholderTextColor={colors.textTertiary}
          style={s.input}
          autoCapitalize="words"
          returnKeyType="done"
        />
      </Section>

      <Section label="GPS">
        <Toggle
          label="Use live GPS"
          helper="Improves Nearby accuracy. Disabling falls back to your default city."
          value={useGps}
          onChange={setUseGps}
        />
      </Section>

      <Section label="NEARBY NOTIFICATIONS">
        <Toggle
          label="New spots near me"
          helper="Get notified when fresh spots are added within your discovery radius."
          value={nearbyAlerts}
          onChange={setNearbyAlerts}
        />
      </Section>

      <Section label="PRIVACY">
        <Toggle
          label="Hide exact location when browsing"
          helper="Other photographers won't see your precise coordinates on shared shoots."
          value={hideExact}
          onChange={setHideExact}
        />
      </Section>
    </SettingsScreen>
  );
}

const s = StyleSheet.create({
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  input: {
    minHeight: 44, paddingHorizontal: 12,
    backgroundColor: colors.surface2, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    color: colors.text, fontFamily: font.body, fontSize: 14,
  },
  cta: {
    height: 50, borderRadius: 25, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaTxt: { color: '#1a1300', fontFamily: font.bodyBold, fontSize: 15 },
});
