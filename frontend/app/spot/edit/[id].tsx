/**
 * Owner spot edit screen — Feature 4 Scope B.
 *
 * Owners (and admins, though admins have a richer override screen at
 * /admin/spots/[id]/edit) edit display-safe fields on their spot. The
 * fields rendered here come from FIELD_META in src/utils/spot-edit-
 * fields.ts which is the SINGLE SOURCE OF TRUTH and must mirror the
 * backend OWNER_EDITABLE_FIELDS in routes/spot_shares.py.
 *
 * NOT editable here: coords, owner, visibility_status, moderation,
 * premium status, images. Those use other dedicated screens.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable,
  SafeAreaView,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Save, Check } from 'lucide-react-native';
import { colors, font, space, radii } from '../../../src/theme';
import { api, formatApiError } from '../../../src/api';
import { useAuth } from '../../../src/auth';
import {
  FIELD_META,
  OWNER_EDITABLE_FIELDS,
  type OwnerEditableField,
} from '../../../src/utils/spot-edit-fields';

export default function OwnerEditSpotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [spotTitle, setSpotTitle] = useState('');
  const [values, setValues] = useState<Record<string, any>>({});
  const [initial, setInitial] = useState<Record<string, any>>({});
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await api.get(`/spots/${id}`);
      const spot = r.spot || r;
      const isOwner = !!(user && spot?.owner?.user_id === user.user_id);
      const isAdmin = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'moderator';
      if (!isOwner && !isAdmin) {
        setForbidden(true);
        return;
      }
      setSpotTitle(spot?.title || 'Spot');
      const next: Record<string, any> = {};
      for (const f of OWNER_EDITABLE_FIELDS) {
        next[f] = spot?.[f] ?? (typeof spot?.[f] === 'boolean' ? false : '');
      }
      setValues(next);
      setInitial(next);
    } catch (e: any) {
      setErr(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, [id, user]);

  useEffect(() => { load(); }, [load]);

  const dirty = OWNER_EDITABLE_FIELDS.some(f => {
    const a = values[f]; const b = initial[f];
    if (Array.isArray(a) || Array.isArray(b)) {
      return JSON.stringify(a || []) !== JSON.stringify(b || []);
    }
    return (a ?? '') !== (b ?? '');
  });

  const save = async () => {
    if (!dirty) return;
    setSaving(true); setErr(null);
    try {
      const patch: Record<string, any> = {};
      for (const f of OWNER_EDITABLE_FIELDS) {
        const a = values[f]; const b = initial[f];
        const changed = Array.isArray(a) || Array.isArray(b)
          ? JSON.stringify(a || []) !== JSON.stringify(b || [])
          : (a ?? '') !== (b ?? '');
        if (changed) patch[f] = a;
      }
      await api.patch(`/spots/${id}/info`, patch);
      Alert.alert('Saved', 'Spot details updated.');
      router.back();
    } catch (e: any) {
      setErr(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  if (forbidden) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <Header onBack={() => router.back()} title="Not allowed" />
        <View style={styles.center}>
          <Text style={styles.errText}>Only the spot owner or an admin can edit this spot.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <Header onBack={() => router.back()} title="Edit spot" />

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.spotTitle} numberOfLines={2}>{spotTitle}</Text>
            <Text style={styles.helper}>
              Edit display-safe details. Coordinates, visibility, and moderation status aren't editable here.
            </Text>

            {err ? (
              <View style={styles.errBox}><Text style={styles.errText}>{err}</Text></View>
            ) : null}

            {FIELD_META.map(meta => (
              <FieldRenderer
                key={meta.key}
                meta={meta}
                value={values[meta.key]}
                onChange={(v) => setValues(prev => ({ ...prev, [meta.key]: v }))}
              />
            ))}

            <View style={{ height: space.xxxxl }} />
          </ScrollView>
        )}

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.saveBtn, (!dirty || saving) && { opacity: 0.45 }]}
            onPress={save}
            disabled={!dirty || saving}
            testID="spot-edit-save"
          >
            {saving
              ? <ActivityIndicator color={colors.textInverse} />
              : <>
                  <Save size={16} color={colors.textInverse} />
                  <Text style={styles.saveBtnText}>Save changes</Text>
                </>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} hitSlop={12} style={styles.backBtn}>
        <ArrowLeft size={22} color={colors.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={{ width: 32 }} />
    </View>
  );
}

function FieldRenderer({
  meta, value, onChange,
}: {
  meta: typeof FIELD_META[number];
  value: any;
  onChange: (v: any) => void;
}) {
  if (meta.shape === 'boolean') {
    const on = !!value;
    return (
      <Pressable
        style={styles.boolRow}
        onPress={() => onChange(!on)}
        testID={`field-${meta.key}`}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>{meta.label}</Text>
        </View>
        <View style={[styles.switchTrack, on && styles.switchTrackOn]}>
          <View style={[styles.switchThumb, on && styles.switchThumbOn]} />
        </View>
      </Pressable>
    );
  }

  if (meta.shape === 'tag-list') {
    const str = Array.isArray(value) ? value.join(', ') : (value || '');
    return (
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{meta.label}</Text>
        <TextInput
          style={styles.input}
          value={str}
          placeholder={meta.placeholder || 'a, b, c'}
          placeholderTextColor={colors.textTertiary}
          onChangeText={(t) => onChange(
            t.split(',').map(s => s.trim()).filter(Boolean),
          )}
          testID={`field-${meta.key}`}
        />
      </View>
    );
  }

  // text / textarea
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{meta.label}</Text>
      <TextInput
        style={[styles.input, meta.shape === 'textarea' && styles.textarea]}
        value={typeof value === 'string' ? value : (value == null ? '' : String(value))}
        placeholder={meta.placeholder}
        placeholderTextColor={colors.textTertiary}
        onChangeText={onChange}
        multiline={meta.shape === 'textarea'}
        maxLength={meta.maxLength}
        testID={`field-${meta.key}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle,
  },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 16, fontWeight: '700' },
  scroll: { padding: space.xl },
  spotTitle: { color: colors.text, fontSize: 19, fontWeight: '700', marginBottom: space.sm },
  helper: { color: colors.textSecondary, fontSize: 12, marginBottom: space.xl, lineHeight: 18 },
  errBox: { backgroundColor: '#3A1414', borderRadius: radii.md, padding: space.md, marginBottom: space.lg },
  errText: { color: '#FCA5A5', fontSize: 14, lineHeight: 20 },
  fieldBlock: { marginBottom: space.lg },
  fieldLabel: { color: colors.text, fontSize: 12, fontWeight: '600', marginBottom: space.sm },
  input: {
    backgroundColor: colors.surface2, borderRadius: radii.md,
    paddingHorizontal: space.md, paddingVertical: space.md,
    color: colors.text, fontSize: 14,
    minHeight: 44, borderWidth: 1, borderColor: colors.border,
  },
  textarea: { minHeight: 100, textAlignVertical: 'top' },
  boolRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    backgroundColor: colors.surface2, borderRadius: radii.md,
    paddingHorizontal: space.lg, paddingVertical: space.md,
    marginBottom: space.sm,
  },
  switchTrack: {
    width: 44, height: 26, borderRadius: 13, backgroundColor: colors.surface3,
    padding: 3, justifyContent: 'center',
  },
  switchTrackOn: { backgroundColor: colors.primary },
  switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' },
  switchThumbOn: { transform: [{ translateX: 18 }] },
  footer: {
    padding: space.lg, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle, backgroundColor: colors.surface1,
  },
  saveBtn: {
    backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radii.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  saveBtnText: { color: colors.textInverse, fontSize: 14, fontWeight: '700' },
});
