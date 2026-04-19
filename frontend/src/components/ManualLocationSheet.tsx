import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Pressable } from 'react-native';
import { X, Check, MapPinOff } from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';

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
};

const empty: ManualLocation = {
  title: '',
  address_line1: '',
  city: '',
  state: 'TX',
  postal_code: '',
  country: 'USA',
  landmark_notes: '',
};

/**
 * Manual location entry sheet — for spots that don't exist in geocoders or
 * for importing historical shoots where user doesn't want to search.
 * Coordinates are OPTIONAL. City + State are required so map/feed queries work.
 */
export default function ManualLocationSheet({
  visible,
  onClose,
  onConfirm,
  initial,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (loc: ManualLocation) => void;
  initial?: Partial<ManualLocation>;
}) {
  const [v, setV] = useState<ManualLocation>({ ...empty, ...initial });

  useEffect(() => {
    if (visible) setV({ ...empty, ...initial });
  }, [visible, initial]);

  const canSubmit = v.title.trim().length >= 2 && v.city.trim().length >= 2 && v.state.trim().length >= 2;

  const confirm = () => {
    if (!canSubmit) return;
    onConfirm({
      ...v,
      latitude: v.latitude !== undefined ? Number(v.latitude) : undefined,
      longitude: v.longitude !== undefined ? Number(v.longitude) : undefined,
    });
    onClose();
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
            Enter details by hand — perfect for importing historical shoots where you're not on-site.
            Coordinates are optional.
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

          <Pressable
            onPress={confirm}
            style={({ pressed }) => [styles.confirmBtn, (!canSubmit || pressed) && { opacity: canSubmit ? 0.85 : 0.4 }]}
            disabled={!canSubmit}
            testID="manual-confirm"
          >
            <Check size={16} color={colors.textInverse} />
            <Text style={styles.confirmTxt}>Use this location</Text>
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
  sectionLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 8 },
  fieldLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase' },
  input: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: space.md, paddingVertical: 12, color: colors.text, fontFamily: font.body, fontSize: 15 },
  confirmBtn: { marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radii.md },
  confirmTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 14 },
});
