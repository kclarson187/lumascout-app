/**
 * Admin Park edit — Phase 5 of the Park-Based Multi-Spot Workflow.
 *
 * Lets admins edit a parent park's metadata (name, address, general
 * notes). The PATCH /api/parks/{id} endpoint propagates name changes
 * to the denormalized park_name on all child spots.
 *
 * This screen is admin/super-admin-only — the underlying endpoint
 * also accepts edits from the park creator, but the navigation entry
 * only exists from /admin/parks for now.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Check, Layers } from 'lucide-react-native';
import { api, formatApiError } from '../../../../src/api';
import { colors, font, space, radii } from '../../../../src/theme';

type Park = {
  park_id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country_code?: string | null;
  description?: string | null;
  general_parking_notes?: string | null;
  general_permit_notes?: string | null;
  general_safety_notes?: string | null;
  general_access_notes?: string | null;
  child_spot_count?: number;
  status?: string;
};

export default function AdminParkEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [park, setPark] = useState<Park | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Editable form state
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateField, setStateField] = useState('');
  const [description, setDescription] = useState('');
  const [parking, setParking] = useState('');
  const [permit, setPermit] = useState('');
  const [safety, setSafety] = useState('');
  const [access, setAccess] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api.get(`/parks/${id}`);
      setPark(r as Park);
      setName((r as Park).name || '');
      setAddress((r as Park).address || '');
      setCity((r as Park).city || '');
      setStateField((r as Park).state || '');
      setDescription((r as Park).description || '');
      setParking((r as Park).general_parking_notes || '');
      setPermit((r as Park).general_permit_notes || '');
      setSafety((r as Park).general_safety_notes || '');
      setAccess((r as Park).general_access_notes || '');
    } catch {
      setPark(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const onSave = async () => {
    if (!park) return;
    if (!name.trim() || name.trim().length < 2) {
      Alert.alert('Name required', 'Park name must be at least 2 characters.');
      return;
    }
    setSaving(true);
    setSaved(false);
    try {
      const patch: any = {
        name: name.trim(),
        address: address.trim() || null,
        city: city.trim() || null,
        state: stateField.trim() || null,
        description: description.trim() || null,
        general_parking_notes: parking.trim() || null,
        general_permit_notes: permit.trim() || null,
        general_safety_notes: safety.trim() || null,
        general_access_notes: access.trim() || null,
      };
      const r = await api.patch(`/parks/${park.park_id}`, patch);
      setPark(r as Park);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      Alert.alert('Could not save', formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }
  if (!park) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <Header onBack={() => router.back()} title="Edit park" />
        <Text style={styles.empty}>Park not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <Header onBack={() => router.back()} title="Edit park" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: space.lg, paddingBottom: 120, gap: space.lg }}
        >
          <View style={styles.heroCard}>
            <View style={styles.heroIcon}>
              <Layers size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle} numberOfLines={1}>{park.name}</Text>
              <Text style={styles.heroSub}>
                {(park.child_spot_count ?? 0)} child spot{(park.child_spot_count ?? 0) === 1 ? '' : 's'}
                {park.status && park.status !== 'active' ? ` · ${park.status}` : ''}
              </Text>
            </View>
          </View>

          {saved && (
            <View style={styles.savedBanner}>
              <Check size={13} color={colors.success} />
              <Text style={styles.savedTxt}>Saved</Text>
            </View>
          )}

          <Field label="Park name *" value={name} onChange={setName} />
          <Field label="Address" value={address} onChange={setAddress} placeholder="Street address" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 2 }}>
              <Field label="City" value={city} onChange={setCity} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="State" value={stateField} onChange={setStateField} autoCapitalize="characters" maxLength={3} />
            </View>
          </View>

          <Field label="Description" value={description} onChange={setDescription} multiline />
          <Field label="General parking notes" value={parking} onChange={setParking} multiline />
          <Field label="General permit notes" value={permit} onChange={setPermit} multiline />
          <Field label="General safety notes" value={safety} onChange={setSafety} multiline />
          <Field label="General access notes" value={access} onChange={setAccess} multiline />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => router.back()}
            disabled={saving}
            testID="park-edit-cancel"
          >
            <Text style={styles.cancelTxt}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={onSave}
            disabled={saving}
            testID="park-edit-save"
          >
            {saving ? (
              <ActivityIndicator color={colors.textInverse} size="small" />
            ) : (
              <>
                <Check size={15} color={colors.textInverse} />
                <Text style={styles.saveTxt}>Save changes</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.iconBtn} testID="park-edit-back">
        <ChevronLeft size={22} color={colors.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.iconBtn} />
    </View>
  );
}

function Field({
  label, value, onChange, placeholder, multiline, autoCapitalize, maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  maxLength?: number;
}) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        maxLength={maxLength}
        style={[styles.input, multiline && { minHeight: 80, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.lg, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.text, fontFamily: font.display, fontSize: 17 },

  heroCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  heroIcon: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(245,166,35,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  heroSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 1 },

  savedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(45,160,90,0.12)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.success,
  },
  savedTxt: { color: colors.success, fontFamily: font.bodyBold, fontSize: 12 },

  label: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 },
  input: {
    padding: 12, borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    color: colors.text, fontFamily: font.body, fontSize: 14,
  },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: space.lg, paddingBottom: Platform.OS === 'ios' ? 24 : space.lg,
    flexDirection: 'row', gap: 8,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  cancelBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 13, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  cancelTxt: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  saveBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  saveTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 13 },

  empty: { color: colors.textTertiary, fontFamily: font.body, fontSize: 13, textAlign: 'center', marginTop: 20 },
});
