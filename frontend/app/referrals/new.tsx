/**
 * Post a Need — Referral Marketplace form.
 * Path: /referrals/new
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { ArrowLeft, Zap, Camera, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii, SHOOT_TYPES } from '../../src/theme';
import { Input, Chip } from '../../src/components/ui';
import KeyboardSafe from '../../src/components/KeyboardSafe';

const GIG_OPTIONS = [
  { key: 'full_session_referral', label: 'Full Session Referral' },
  { key: 'second_shooter', label: 'Second Shooter' },
  { key: 'associate_shooter', label: 'Associate Shooter' },
  { key: 'content_creator', label: 'Content Creator' },
  { key: 'pet_session', label: 'Pet Session' },
  { key: 'wedding_support', label: 'Wedding Support' },
  { key: 'event_coverage', label: 'Event Coverage' },
];

export default function PostReferral() {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [shootType, setShootType] = useState<string>('Family');
  const [gigType, setGigType] = useState<string>('full_session_referral');
  const [city, setCity] = useState(user?.city || '');
  const [state, setState] = useState(user?.state || '');
  const [eventDate, setEventDate] = useState('');
  const [durationHours, setDurationHours] = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [notes, setNotes] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const addRefImage = async () => {
    if (refImages.length >= 4) { Alert.alert('Max 4 reference images'); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') { Alert.alert('Permission required'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7, allowsEditing: false,
    });
    if (r.canceled || !r.assets?.[0]?.uri) return;
    const manipulated = await ImageManipulator.manipulateAsync(
      r.assets[0].uri,
      [{ resize: { width: 1200 } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    setRefImages((prev) => [...prev, `data:image/jpeg;base64,${manipulated.base64}`]);
  };

  const submit = async () => {
    if (title.trim().length < 4) { Alert.alert('Add a clear title (4+ characters)'); return; }
    if (!city.trim()) { Alert.alert('City is required'); return; }
    setSubmitting(true);
    try {
      const payload: any = {
        title: title.trim(),
        shoot_type: shootType,
        gig_type: gigType,
        city: city.trim(), state: state.trim() || null,
        urgency: isUrgent ? 'urgent' : 'normal',
      };
      if (eventDate.trim()) payload.event_date = eventDate.trim();
      if (durationHours) payload.duration_hours = Number(durationHours) || null;
      if (budgetMin) payload.budget_min = Number(budgetMin) || null;
      if (budgetMax) payload.budget_max = Number(budgetMax) || null;
      if (notes.trim()) payload.notes = notes.trim();
      if (refImages.length > 0) payload.reference_images = refImages;

      const res = await api.post('/referrals', payload);
      router.replace(`/referrals/${res.need_id}` as any);
    } catch (e) {
      Alert.alert('Could not post', formatApiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={10} testID="referrals-new-back">
          <ArrowLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Post a Need</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardSafe>
        <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: space.xxxl, gap: space.lg }}>
          <View style={styles.card}>
            <Text style={styles.section}>What are you looking for?</Text>
            <Input
              label="Title"
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Need Austin family photographer Saturday"
              maxLength={140}
              testID="ref-title"
            />

            <Text style={styles.label}>Gig type</Text>
            <View style={styles.chipRow}>
              {GIG_OPTIONS.map((g) => (
                <Chip
                  key={g.key}
                  label={g.label}
                  active={gigType === g.key}
                  onPress={() => setGigType(g.key)}
                  testID={`ref-gig-${g.key}`}
                />
              ))}
            </View>

            <Text style={styles.label}>Shoot type</Text>
            <View style={styles.chipRow}>
              {SHOOT_TYPES.slice(0, 12).map((t) => (
                <Chip
                  key={t}
                  label={t}
                  active={shootType === t}
                  onPress={() => setShootType(t)}
                />
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.section}>Where + when</Text>
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <View style={{ flex: 2 }}>
                <Input label="City" value={city} onChangeText={setCity} testID="ref-city" />
              </View>
              <View style={{ flex: 1 }}>
                <Input label="State / Prov" value={state} onChangeText={setState} autoCapitalize="characters" maxLength={3} />
              </View>
            </View>
            <Input
              label="Event date (optional)"
              value={eventDate}
              onChangeText={setEventDate}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
            />
            <Input
              label="Duration in hours (optional)"
              value={durationHours}
              onChangeText={(t) => setDurationHours(t.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              placeholder="e.g. 2"
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.section}>Budget (optional)</Text>
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <View style={{ flex: 1 }}>
                <Input
                  label="Min $"
                  value={budgetMin}
                  onChangeText={(t) => setBudgetMin(t.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Input
                  label="Max $"
                  value={budgetMax}
                  onChangeText={(t) => setBudgetMax(t.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.section}>Details (optional)</Text>
            <Input
              label="Notes for applicants"
              value={notes}
              onChangeText={setNotes}
              placeholder="Style, vibe, must-knows, logistics…"
              multiline
              maxLength={1500}
              style={{ minHeight: 100, textAlignVertical: 'top' }}
            />

            <Text style={styles.label}>Reference photos (up to 4)</Text>
            <View style={styles.refRow}>
              {refImages.map((img, i) => (
                <View key={i} style={styles.refThumbWrap}>
                  <TouchableOpacity
                    style={styles.refRemove}
                    onPress={() => setRefImages((prev) => prev.filter((_, j) => j !== i))}
                    hitSlop={8}
                  >
                    <X size={14} color={colors.textInverse} />
                  </TouchableOpacity>
                  <View style={[styles.refThumb, { backgroundColor: colors.surface2 }]} />
                </View>
              ))}
              {refImages.length < 4 ? (
                <TouchableOpacity onPress={addRefImage} style={styles.refAdd} testID="ref-add-img">
                  <Camera size={18} color={colors.primary} />
                  <Text style={styles.refAddTxt}>Add</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.urgentRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Zap size={14} color={isUrgent ? '#ef4444' : colors.textTertiary} />
                <Text style={styles.urgentLabel}>Mark as urgent</Text>
              </View>
              <Switch
                value={isUrgent}
                onValueChange={setIsUrgent}
                trackColor={{ false: colors.surface2, true: '#ef4444' }}
              />
            </View>
            <Text style={styles.urgentHelp}>
              Urgent needs get a red chip, featured in the Urgent rail.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.submit, submitting && { opacity: 0.7 }]}
            onPress={submit}
            disabled={submitting}
            testID="ref-submit"
          >
            {submitting ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.submitTxt}>Post need</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardSafe>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 16 },

  card: {
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.lg, padding: space.md, gap: space.md,
  },
  section: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  label: {
    color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11,
    letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 4,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  refRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  refThumbWrap: { position: 'relative' },
  refThumb: {
    width: 70, height: 70, borderRadius: radii.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  refRemove: {
    position: 'absolute', top: -6, right: -6, zIndex: 2,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#ef4444',
    alignItems: 'center', justifyContent: 'center',
  },
  refAdd: {
    width: 70, height: 70, borderRadius: radii.sm,
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)', borderStyle: 'dashed',
    backgroundColor: 'rgba(245,166,35,0.06)',
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  refAddTxt: { color: colors.primary, fontFamily: font.bodyMedium, fontSize: 10 },

  urgentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  urgentLabel: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 14 },
  urgentHelp: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },

  submit: {
    backgroundColor: colors.primary,
    paddingVertical: 14, borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
    marginTop: space.md,
  },
  submitTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14, letterSpacing: 0.3 },
});
