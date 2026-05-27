import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { X, Check, MapPinOff, AlertTriangle } from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';
import api from '../api';

export type ManualLocation = {
  title: string;
  address_line1: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  latitude?: number;
  longitude?: number;
  landmark_notes: string;
  // FIX(Commit 7.5 / 2026-04): provenance fields so the spot record carries
  // what the user originally typed and how we resolved it.
  original_address_input?: string;
  geocode_status?: 'success' | 'failed' | 'low_confidence' | 'skipped';
  geocode_confidence?: number;
};

const empty: ManualLocation = {
  title: '',
  address_line1: '',
  city: '',
  state: 'TX',
  postal_code: '',
  country: 'USA',
  landmark_notes: '' };

/**
 * Manual location entry sheet — for spots that don't exist in geocoders or
 * for importing historical shoots where user doesn't want to search.
 * Coordinates are OPTIONAL. City + State are required so map/feed queries work.
 */
export default function ManualLocationSheet({
  visible,
  onClose,
  onConfirm,
  initial }: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (loc: ManualLocation) => void;
  initial?: Partial<ManualLocation>;
}) {
  const [v, setV] = useState<ManualLocation>({ ...empty, ...initial });
  const [busy, setBusy] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string>('');

  useEffect(() => {
    if (visible) {
      setV({ ...empty, ...initial });
      setGeocodeError('');
    }
  }, [visible, initial]);

  const canSubmit = v.title.trim().length >= 2 && v.city.trim().length >= 2 && v.state.trim().length >= 2;

  // FIX(Commit 7.5 / 2026-04): If the user didn't hand-enter coordinates we
  // MUST resolve a real lat/lng via the Nominatim-backed /geocode/search
  // endpoint before closing the sheet. Previously we allowed the sheet to
  // close with `latitude: undefined`, which upstream was coerced to 0 via
  // `draft.latitude || 0` and shipped the spot to (0, 0) in the Atlantic.
  // Now we either succeed with real coords + confidence, or we refuse to
  // close and surface a clear, copy-spec'd error.
  const confirm = async () => {
    if (!canSubmit) return;
    setGeocodeError('');

    // Capture the user's raw input so we can replay / re-geocode later.
    const rawQueryParts = [v.title, v.address_line1, v.city, v.state, v.postal_code, v.country]
      .map((s) => (s || '').trim())
      .filter(Boolean);
    const original_address_input = rawQueryParts.join(', ');

    // Path 1 — user hand-entered lat/lng. Validate them, don't ping network.
    if (v.latitude !== undefined && v.longitude !== undefined) {
      const lat = Number(v.latitude), lng = Number(v.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
        setGeocodeError('Those coordinates look invalid. Remove them to auto-locate, or fix the values.');
        return;
      }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        setGeocodeError('Coordinates are out of range. Latitude: -90 to 90, Longitude: -180 to 180.');
        return;
      }
      onConfirm({
        ...v,
        latitude: lat,
        longitude: lng,
        original_address_input,
        geocode_status: 'skipped' });
      onClose();
      return;
    }

    // Path 2 — no coords. Auto-geocode from the typed address.
    setBusy(true);
    try {
      // Build a geocode query favoring the most specific parts the user
      // actually typed. `title` first because it's often a park/business
      // name (Nominatim handles both).
      const q = [v.title, v.address_line1, v.city, v.state, v.postal_code, v.country]
        .map((s) => (s || '').trim())
        .filter(Boolean)
        .join(', ');
      const resp = await api.get(`/geocode/search?q=${encodeURIComponent(q)}&limit=1`);
      const hit = (resp.results || [])[0];
      if (!hit || typeof hit.latitude !== 'number' || typeof hit.longitude !== 'number' || (hit.latitude === 0 && hit.longitude === 0)) {
        // FIX(Commit 7.5): differentiate rate-limit / network error from
        // "not found" so users don't get blamed for Nominatim throttles.
        if (resp.error) {
          setGeocodeError("We couldn't check this address right now. Try again in a moment, or drop a pin manually.");
        } else {
          setGeocodeError('Could not find this address. Please refine the address or drop a pin manually.');
        }
        return;
      }
      // Nominatim "importance" is roughly 0..1. Treat <= 0.2 as low confidence
      // so the caller can prompt a user confirmation (deferred to v1.1 — for
      // now we still save, but tag it so admins can audit later).
      const confidence: number | undefined = typeof hit.confidence === 'number' ? hit.confidence : undefined;
      const status: 'success' | 'low_confidence' =
        confidence !== undefined && confidence <= 0.2 ? 'low_confidence' : 'success';

      onConfirm({
        ...v,
        latitude: hit.latitude,
        longitude: hit.longitude,
        // Upgrade city/state from the geocoded result when the user left
        // them generic — this keeps map pins accurate on bulk imports.
        city: v.city || hit.city || v.city,
        state: (v.state || hit.state || v.state).slice(0, 2).toUpperCase(),
        original_address_input,
        geocode_status: status,
        geocode_confidence: confidence });
      onClose();
    } catch (e: any) {
      setGeocodeError('Could not find this address. Please refine the address or drop a pin manually.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={styles.head}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <MapPinOff size={18} color={colors.primary} />
            <Text style={styles.title}>Enter location</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12} testID="manual-loc-close"><X size={22} color={colors.text} /></TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md }}>
          <Text style={styles.help}>
            Enter the address — we'll find the map coordinates automatically.
            If you already know the exact lat/lng, you can enter them below
            to skip the lookup.
          </Text>

          <Field label="Spot name *" value={v.title}
            onChangeText={(t) => setV({ ...v, title: t })}
            placeholder="Pearl District, McAllister Park…" testID="manual-title" />
          <Field label="Address line 1" value={v.address_line1}
            onChangeText={(t) => setV({ ...v, address_line1: t })}
            placeholder="303 Pearl Pkwy" testID="manual-address" />

          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 2 }}>
              <Field label="City *" value={v.city}
                onChangeText={(t) => setV({ ...v, city: t })}
                placeholder="San Antonio" testID="manual-city" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="State *" value={v.state}
                onChangeText={(t) => setV({ ...v, state: t.toUpperCase().slice(0, 2) })}
                placeholder="TX" autoCapitalize="characters" testID="manual-state" />
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Field label="ZIP" value={v.postal_code}
                onChangeText={(t) => setV({ ...v, postal_code: t })}
                placeholder="78215" keyboardType="number-pad" testID="manual-zip" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Country" value={v.country}
                onChangeText={(t) => setV({ ...v, country: t })}
                placeholder="USA" testID="manual-country" />
            </View>
          </View>

          <Text style={styles.sectionLabel}>Optional coordinates</Text>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Field label="Latitude" value={v.latitude !== undefined ? String(v.latitude) : ''}
                onChangeText={(t) => setV({ ...v, latitude: t.trim() ? Number(t) : undefined })}
                placeholder="29.4260" keyboardType="numeric" testID="manual-lat" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Longitude" value={v.longitude !== undefined ? String(v.longitude) : ''}
                onChangeText={(t) => setV({ ...v, longitude: t.trim() ? Number(t) : undefined })}
                placeholder="-98.4861" keyboardType="numeric" testID="manual-lng" />
            </View>
          </View>

          <Field label="Landmark notes" value={v.landmark_notes}
            onChangeText={(t) => setV({ ...v, landmark_notes: t })}
            placeholder="Near the main gate; ask at the front desk…"
            multiline testID="manual-landmark" />

          {/* FIX(Commit 7.5): surface the geocode failure / validation error
              inline instead of silently closing with bad coords. */}
          {geocodeError ? (
            <View style={styles.errorBox}>
              <AlertTriangle size={14} color={colors.secondary} />
              <Text style={styles.errorTxt}>{geocodeError}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={confirm}
            style={({ pressed }) => [styles.confirmBtn, (!canSubmit || pressed || busy) && { opacity: canSubmit && !busy ? 0.85 : 0.4 }]}
            disabled={!canSubmit || busy}
            testID="manual-confirm"
          >
            {busy
              ? <ActivityIndicator size="small" color={colors.textInverse} />
              : <Check size={16} color={colors.textInverse} />}
            <Text style={styles.confirmTxt}>
              {busy ? 'Finding this place…' : 'Use this location'}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({ label, value, onChangeText, placeholder, multiline, keyboardType, autoCapitalize, testID }: any) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        style={[styles.input, multiline && { minHeight: 70, textAlignVertical: 'top' }]}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, paddingTop: Platform.OS === 'ios' ? 14 : space.xl, paddingBottom: space.md, gap: 8 },
  title: { color: colors.text, fontFamily: font.display, fontSize: 24 },
  help: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 18 },
  sectionLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, marginTop: 8 },
  fieldLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  input: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: space.md, paddingVertical: 12, color: colors.text, fontFamily: font.body, fontSize: 15 },
  confirmBtn: { marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radii.md },
  confirmTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 14 },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(208,72,72,0.08)',
    borderWidth: 1, borderColor: 'rgba(208,72,72,0.28)',
    borderRadius: radii.md, padding: 12, marginTop: 4 },
  errorTxt: { flex: 1, color: colors.secondary, fontFamily: font.bodyMedium, fontSize: 13, lineHeight: 17 } });
