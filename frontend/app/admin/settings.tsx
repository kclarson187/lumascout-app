import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch, Alert, ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform } from 'react-native';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';

export default function AdminSettings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setSettings(await api.get('/admin/settings')); }
    catch (e) { Alert.alert('Load failed', formatApiError(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (patch: any) => {
    if (user?.role !== 'super_admin') {
      Alert.alert('Super admin required', 'Only super_admin can change platform settings.');
      return;
    }
    setSaving(true);
    try {
      const r = await api.patch('/admin/settings', patch);
      setSettings(r.settings);
    } catch (e) { Alert.alert('Could not save', formatApiError(e)); }
    finally { setSaving(false); }
  };

  if (loading || !settings) return <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />;

  const disabled = user?.role !== 'super_admin';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
      >
        {disabled && (
          <View style={styles.lock}>
            <Text style={styles.lockTxt}>View-only — only super_admin can edit platform settings.</Text>
          </View>
        )}

        <Section title="General">
          <TextRow label="App name"      value={settings.app_name}      onSubmit={(v) => save({ app_name: v })}      disabled={disabled} />
          <TextRow label="Support email" value={settings.support_email} onSubmit={(v) => save({ support_email: v })} disabled={disabled} />
          <ToggleRow label="Maintenance mode"    help="UI toggle today. Backend enforcement lands in Phase 2." value={!!settings.maintenance_mode}    onChange={(v) => save({ maintenance_mode: v })}    disabled={disabled} />
          <ToggleRow label="Public registration" help="Allow new user signups from the app."                     value={!!settings.public_registration} onChange={(v) => save({ public_registration: v })} disabled={disabled} />
        </Section>

        <Section title="Content moderation">
          <ToggleRow label="Require moderation for public spots"  value={!!settings.require_moderation_spots}  onChange={(v) => save({ require_moderation_spots: v })}  disabled={disabled} />
          <ToggleRow label="Require moderation for photos"        value={!!settings.require_moderation_photos} onChange={(v) => save({ require_moderation_photos: v })} disabled={disabled} />
          <ToggleRow label="Auto-approve verified contributors"   value={!!settings.auto_approve_verified}     onChange={(v) => save({ auto_approve_verified: v })}     disabled={disabled} />
          <TextRow   label="Duplicate radius (meters)"            value={String(settings.duplicate_radius_m)}  onSubmit={(v) => save({ duplicate_radius_m: parseFloat(v) || 200 })} disabled={disabled} keyboardType="numeric" />
        </Section>

        <Section title="Map & privacy">
          <TextRow label="Default privacy mode"     value={settings.default_privacy_mode} onSubmit={(v) => save({ default_privacy_mode: v })} disabled={disabled} />
          <TextRow label="Approximate radius (km)"  value={String(settings.approximate_radius_km)} onSubmit={(v) => save({ approximate_radius_km: parseFloat(v) || 1 })} disabled={disabled} keyboardType="numeric" />
        </Section>

        {saving && <ActivityIndicator color={colors.primary} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={{ gap: 4 }}>{children}</View>
    </View>
  );
}

function ToggleRow({ label, help, value, onChange, disabled }: { label: string; help?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {help && <Text style={styles.rowHelp}>{help}</Text>}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: colors.primary, false: colors.border }} />
    </View>
  );
}

function TextRow({ label, value, onSubmit, disabled, keyboardType }: { label: string; value: string; onSubmit: (v: string) => void; disabled?: boolean; keyboardType?: any }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  const changed = v !== value;
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <TextInput
          value={v}
          onChangeText={setV}
          editable={!disabled}
          keyboardType={keyboardType}
          style={styles.input}
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
        />
      </View>
      {changed && !disabled && (
        <TouchableOpacity onPress={() => onSubmit(v)} style={styles.saveBtn}>
          <Text style={styles.saveBtnTxt}>Save</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  lock: { padding: space.md, borderRadius: radii.md, backgroundColor: 'rgba(208,72,72,0.08)', borderColor: colors.secondary, borderWidth: 1 },
  lockTxt: { color: colors.secondary, fontFamily: font.bodyMedium, fontSize: 12 },
  section: { gap: 4, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, padding: space.md, borderRadius: radii.lg },
  sectionTitle: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  rowLabel: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  rowHelp: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10 },
  input: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, paddingHorizontal: 10, paddingVertical: 8, color: colors.text, fontFamily: font.body, fontSize: 13 },
  saveBtn: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: radii.sm, backgroundColor: colors.primary },
  saveBtnTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 11 },
});
