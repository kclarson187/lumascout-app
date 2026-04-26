/**
 * Settings ▸ Camera Gear
 *
 * Persists to user.gear_prefs via PATCH /api/auth/me.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { X } from 'lucide-react-native';
import { SettingsScreen, Section, Pill } from '../../src/components/SettingsLayout';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import { colors, font, space } from '../../src/theme';

const BRANDS = ['Canon', 'Nikon', 'Sony', 'Fujifilm', 'Lumix', 'DJI', 'Other'];
const SHOOTS = ['Portrait', 'Wedding', 'Landscape', 'Pet', 'Drone', 'Commercial', 'Street'];

export default function CameraGear() {
  const { user, refresh } = useAuth() as any;
  const seed = (user?.gear_prefs || {}) as any;
  const [brand, setBrand] = useState<string>(seed.primary_brand ?? '');
  const [body, setBody] = useState<string>(seed.primary_body ?? '');
  const [lensInput, setLensInput] = useState<string>('');
  const [lenses, setLenses] = useState<string[]>(Array.isArray(seed.lenses) ? seed.lenses : []);
  const [shoots, setShoots] = useState<string[]>(Array.isArray(seed.shoots) ? seed.shoots : []);
  const [saving, setSaving] = useState(false);

  const addLens = () => {
    const t = lensInput.trim();
    if (!t || lenses.includes(t)) return;
    setLenses([...lenses, t]);
    setLensInput('');
  };
  const toggleShoot = (k: string) => {
    setShoots(shoots.includes(k) ? shoots.filter((s) => s !== k) : [...shoots, k]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/auth/me', {
        gear_prefs: {
          primary_brand: brand || null,
          primary_body: body.trim() || null,
          lenses,
          shoots,
        },
      });
      await refresh?.();
      Alert.alert('Saved', 'Your gear has been updated.');
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsScreen
      title="Camera Gear"
      subtitle="Personalize recommendations and your network profile"
      footer={
        <Pressable onPress={save} disabled={saving} style={[s.cta, saving && { opacity: 0.6 }]}>
          {saving ? <ActivityIndicator color="#1a1300" /> : <Text style={s.ctaTxt}>Save gear</Text>}
        </Pressable>
      }
    >
      <Section label="PRIMARY BRAND">
        <View style={s.pillRow}>
          {BRANDS.map((b) => (
            <Pill key={b} label={b} active={brand === b} onPress={() => setBrand(b)} />
          ))}
        </View>
      </Section>

      <Section label="PRIMARY BODY" helper="e.g. R5, A7 IV, Z6 II, GFX 100S, S5 II">
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Your main camera body"
          placeholderTextColor={colors.textTertiary}
          style={s.input}
          autoCapitalize="characters"
        />
      </Section>

      <Section label="FAVORITE LENSES" helper="Tap Add to tag each lens. Used for lens recommendations.">
        <View style={s.lensRow}>
          <TextInput
            value={lensInput}
            onChangeText={setLensInput}
            onSubmitEditing={addLens}
            placeholder="e.g. RF 50mm f/1.2L"
            placeholderTextColor={colors.textTertiary}
            style={[s.input, { flex: 1 }]}
            returnKeyType="done"
          />
          <Pressable onPress={addLens} style={s.addBtn}>
            <Text style={s.addBtnTxt}>Add</Text>
          </Pressable>
        </View>
        {lenses.length > 0 ? (
          <View style={[s.pillRow, { marginTop: 4 }]}>
            {lenses.map((l) => (
              <Pressable
                key={l}
                onPress={() => setLenses(lenses.filter((x) => x !== l))}
                style={s.tag}
              >
                <Text style={s.tagTxt}>{l}</Text>
                <X size={11} color={colors.textSecondary} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </Section>

      <Section label="SHOOTS MOSTLY" helper="Used to match you with referrals, mentors, and directory filters.">
        <View style={s.pillRow}>
          {SHOOTS.map((sh) => (
            <Pill key={sh} label={sh} active={shoots.includes(sh)} onPress={() => toggleShoot(sh)} />
          ))}
        </View>
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
