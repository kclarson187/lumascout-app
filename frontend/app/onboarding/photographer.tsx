/**
 * /onboarding/photographer — Phase 2.1 (Jun 2025).
 *
 * Optional but encouraged step that unlocks Directory visibility.
 * Required fields (validated only on the primary "Finish" CTA):
 *   • Profile photo
 *   • Bio (>= 60 chars)
 *   • Specialties (>= 1)
 *   • Portfolio URL OR 3 sample photos
 *
 * Optional toggles & fields:
 *   • Booking availability · Second shooter · Mentor
 *   • Service radius (miles)
 *   • Instagram / TikTok / Facebook
 *
 * "Do this later" → /(tabs) (skip behavior).
 *
 * No portfolio URL HEAD-check this round — that lands in Phase 2.2.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Alert,
  Pressable, ActivityIndicator, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Camera, User as UserIcon, Trash2, Plus, X as XIcon,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useKeyboardHeight } from '../../src/hooks/useKeyboardHeight';
import { colors, font, space, radii } from '../../src/theme';
import { FormField } from '../../src/components/FormField';
import { SPECIALTIES } from '../../src/constants/onboardingOptions';

const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

export default function OnboardingPhotographer() {
  const { user, refresh } = useAuth();
  const kbHeight = useKeyboardHeight();

  // Fields — seed from /auth/me where present so re-entries don't lose data.
  const [photo,        setPhoto]        = useState<string | null>(
    user?.profile_photo_url || user?.avatar_url || null,
  );
  const [bio,          setBio]          = useState<string>(user?.bio || '');
  const [specialties,  setSpecialties]  = useState<string[]>(user?.specialties || []);
  const [portfolioUrl, setPortfolioUrl] = useState<string>(user?.portfolio_url || user?.website || '');
  const [samples,      setSamples]      = useState<string[]>(user?.sample_image_urls || []);
  const [booking,      setBooking]      = useState<boolean>(!!user?.booking_available);
  const [secondShoot,  setSecondShoot]  = useState<boolean>(!!(user as any)?.available_for_second_shooter);
  const [mentor,       setMentor]       = useState<boolean>(!!(user as any)?.mentorship_available);
  const [radius,       setRadius]       = useState<string>(
    user?.service_radius != null ? String((user as any).service_radius)
    : (user as any)?.service_radius_miles != null ? String((user as any).service_radius_miles) : '',
  );
  const [instagram,    setInstagram]    = useState<string>(user?.instagram || '');
  const [tiktok,       setTiktok]       = useState<string>((user as any)?.tiktok_url || '');
  const [facebook,     setFacebook]     = useState<string>((user as any)?.facebook_url || '');

  // Inline errors
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [bioErr,   setBioErr]   = useState<string | null>(null);
  const [specErr,  setSpecErr]  = useState<string | null>(null);
  const [portErr,  setPortErr]  = useState<string | null>(null);
  const [topErr,   setTopErr]   = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  // ─── Image helpers ────────────────────────────────────────────────
  const pickAndCompress = async (square: boolean): Promise<string | null> => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: square,
      aspect: square ? [1, 1] : undefined,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return null;
    const manip = await ImageManipulator.manipulateAsync(
      result.assets[0].uri,
      [{ resize: square ? { width: 600, height: 600 } : { width: 900 } }],
      { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    return `data:image/jpeg;base64,${manip.base64}`;
  };

  const onPickPhoto = useCallback(async () => {
    try {
      const uri = await pickAndCompress(true);
      if (uri) { setPhoto(uri); setPhotoErr(null); }
    } catch (e) { Alert.alert('Could not load image', formatApiError(e)); }
  }, []);

  const onAddSample = useCallback(async () => {
    if (samples.length >= 3) return;
    try {
      const uri = await pickAndCompress(false);
      if (uri) setSamples((prev) => [...prev, uri].slice(0, 3));
    } catch (e) { Alert.alert('Could not load image', formatApiError(e)); }
  }, [samples.length]);

  // ─── Validation ───────────────────────────────────────────────────
  const validateForFinish = (): boolean => {
    let ok = true;
    if (!photo) { setPhotoErr('Add a profile photo to appear in Directory.'); ok = false; } else setPhotoErr(null);
    if (specialties.length < 1) { setSpecErr('Choose at least 1 specialty.'); ok = false; } else setSpecErr(null);
    const portClean = portfolioUrl.trim();
    if (!portClean && samples.length < 3) {
      setPortErr('Add a public portfolio link or upload 3 sample photos.');
      ok = false;
    } else if (portClean && !URL_RE.test(portClean)) {
      setPortErr('Enter a valid URL (https://…).');
      ok = false;
    } else setPortErr(null);
    if (bio.trim().length < 60) {
      setBioErr('Your bio needs at least 60 characters to appear in Directory.');
      ok = false;
    } else setBioErr(null);
    return ok;
  };

  // ─── Save handlers ────────────────────────────────────────────────
  const buildPayload = (markVisible: boolean) => {
    const portClean = portfolioUrl.trim();
    const radiusNum = radius.trim() === '' ? null : Number(radius);
    return {
      profile_photo_url: photo,
      avatar_url: photo,  // mirror legacy field
      bio: bio.trim(),
      specialties,
      portfolio_url: portClean || null,
      website: portClean || null,   // mirror legacy field
      sample_image_urls: samples,
      booking_available: booking,
      available_for_second_shooter: secondShoot,
      mentorship_available: mentor,
      service_radius: Number.isFinite(radiusNum as any) ? radiusNum : null,
      service_radius_miles: Number.isFinite(radiusNum as any) ? radiusNum : null,
      instagram: instagram.trim() || null,
      tiktok_url: tiktok.trim() || null,
      facebook_url: facebook.trim() || null,
      directory_visible: markVisible,
    };
  };

  const onFinish = useCallback(async () => {
    setTopErr(null);
    if (!validateForFinish()) return;
    setSaving(true);
    try {
      await api.patch('/auth/me', buildPayload(true));
      await refresh();
      router.replace('/onboarding/activation' as any);
    } catch (e) {
      setTopErr(formatApiError(e) || "We couldn't save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, bio, specialties, portfolioUrl, samples, booking, secondShoot, mentor, radius, instagram, tiktok, facebook]);

  const onSkip = useCallback(async () => {
    // Persist whatever the user did enter (so partial work isn't lost),
    // then jump to /(tabs) per the Phase-2.1 skip-to-tabs rule.
    setSaving(true);
    try {
      await api.patch('/auth/me', buildPayload(false));
      await refresh();
    } catch {
      // Soft-fail: never block exit on a save error.
    } finally {
      setSaving(false);
      router.replace('/(tabs)' as any);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, bio, specialties, portfolioUrl, samples, booking, secondShoot, mentor, radius, instagram, tiktok, facebook]);

  const toggleSpec = (k: string) =>
    setSpecialties((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            Platform.OS === 'android' && kbHeight > 0 ? { paddingBottom: kbHeight + space.xxxl } : null,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Progress — step 4 (last input) */}
          <View style={styles.progressRow}>
            <View style={[styles.progressDot, styles.progressDotDone]} />
            <View style={[styles.progressDot, styles.progressDotDone]} />
            <View style={[styles.progressDot, styles.progressDotDone]} />
            <View style={[styles.progressDot, styles.progressDotActive]} />
          </View>

          <Text style={styles.head}>Want to appear in the photographer directory?</Text>
          <Text style={styles.sub}>Add a little more so people can trust your profile.</Text>

          {/* Profile photo */}
          <View style={styles.photoRow}>
            <Pressable onPress={onPickPhoto} style={styles.photoCircle} testID="photog-photo">
              {photo
                ? <Image source={{ uri: photo }} style={styles.photoImg} />
                : <UserIcon size={30} color={colors.textTertiary} />}
              <View style={styles.photoCam}><Camera size={12} color={colors.textInverse} /></View>
            </Pressable>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.photoLabel}>Profile photo<Text style={styles.req}>  required for directory</Text></Text>
              <Text style={styles.photoHelp}>A clear face or signature shot works best.</Text>
              {photoErr ? <Text style={styles.errTxt}>{photoErr}</Text> : null}
            </View>
          </View>

          {/* Bio */}
          <View style={{ marginTop: space.lg }}>
            <FormField
              label="Bio"
              value={bio}
              onChangeText={(v) => { setBio(v); if (bioErr) setBioErr(null); }}
              placeholder="Tell people what you shoot and where."
              multiline
              numberOfLines={4}
              required
              helper={`${bio.trim().length} / 60 characters minimum.`}
              error={bioErr}
              testID="photog-bio"
              style={{ minHeight: 80 } as any}
            />
          </View>

          {/* Specialties */}
          <Text style={styles.sectionLabel}>
            Specialties<Text style={styles.req}>  at least 1</Text>
          </Text>
          <View style={styles.chipWrap}>
            {SPECIALTIES.map((s) => {
              const on = specialties.includes(s.key);
              return (
                <Pressable
                  key={s.key}
                  onPress={() => { toggleSpec(s.key); if (specErr) setSpecErr(null); }}
                  style={[styles.chip, on && styles.chipOn]}
                  testID={`photog-spec-${s.key}`}
                >
                  <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{s.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {specErr ? <Text style={styles.errTxt}>{specErr}</Text> : null}

          {/* Portfolio OR samples */}
          <Text style={styles.sectionLabel}>Show your work</Text>
          <Text style={styles.smallHelp}>
            Add a public portfolio link OR upload 3 sample photos.
          </Text>

          <View style={{ marginTop: 10 }}>
            <FormField
              label="Portfolio link"
              value={portfolioUrl}
              onChangeText={(v) => { setPortfolioUrl(v); if (portErr) setPortErr(null); }}
              placeholder="https://yourwebsite.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              helper="Website, Instagram portfolio, Behance, or another public gallery."
              error={portErr}
              testID="photog-portfolio"
            />
          </View>

          {/* Sample photos — 3 slots */}
          <View style={styles.samplesRow}>
            {[0, 1, 2].map((i) => {
              const uri = samples[i];
              if (uri) {
                return (
                  <View key={i} style={styles.sampleCell}>
                    <Image source={{ uri }} style={styles.sampleImg} />
                    <TouchableOpacity
                      style={styles.sampleRemove}
                      onPress={() => setSamples((prev) => prev.filter((_, idx) => idx !== i))}
                      testID={`photog-sample-remove-${i}`}
                      hitSlop={6}
                    >
                      <XIcon size={11} color="#fff" />
                    </TouchableOpacity>
                  </View>
                );
              }
              return (
                <Pressable
                  key={i}
                  onPress={onAddSample}
                  style={[styles.sampleCell, styles.sampleEmpty]}
                  testID={`photog-sample-add-${i}`}
                >
                  <Plus size={18} color={colors.textTertiary} />
                </Pressable>
              );
            })}
          </View>

          {/* Optional toggles */}
          <Text style={styles.sectionLabel}>Availability (optional)</Text>
          <View style={styles.toggleList}>
            <ToggleRow label="Booking" sub="Open to hiring inquiries." value={booking} onChange={setBooking} testID="photog-toggle-booking" />
            <ToggleRow label="Second shooter" sub="Available to assist on shoots." value={secondShoot} onChange={setSecondShoot} testID="photog-toggle-second" />
            <ToggleRow label="Mentor" sub="Open to giving advice or feedback." value={mentor} onChange={setMentor} testID="photog-toggle-mentor" />
          </View>

          {/* Service radius (only really used if booking is on) */}
          <View style={{ marginTop: space.md }}>
            <FormField
              label="Service radius (miles)"
              value={radius}
              onChangeText={setRadius}
              placeholder="e.g. 50"
              keyboardType="number-pad"
              helper="How far you're willing to travel. Optional."
              testID="photog-radius"
            />
          </View>

          {/* Social links */}
          <Text style={styles.sectionLabel}>Social (optional)</Text>
          <View style={{ gap: 10 }}>
            <FormField label="Instagram handle" value={instagram} onChangeText={setInstagram} placeholder="@yourhandle" autoCapitalize="none" autoCorrect={false} testID="photog-instagram" />
            <FormField label="TikTok URL"      value={tiktok}    onChangeText={setTiktok}    placeholder="https://tiktok.com/@..." autoCapitalize="none" autoCorrect={false} keyboardType="url" testID="photog-tiktok" />
            <FormField label="Facebook URL"    value={facebook}  onChangeText={setFacebook}  placeholder="https://facebook.com/..." autoCapitalize="none" autoCorrect={false} keyboardType="url" testID="photog-facebook" />
          </View>

          {topErr ? <Text style={styles.errTxt}>{topErr}</Text> : null}

          {/* Actions */}
          <View style={{ gap: 10, marginTop: space.xxl }}>
            <TouchableOpacity
              onPress={onFinish}
              disabled={saving}
              style={[styles.primaryBtn, saving && { opacity: 0.7 }]}
              testID="photog-finish"
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator color={colors.textInverse} />
                : <Text style={styles.primaryBtnTxt}>Finish photographer profile</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onSkip}
              disabled={saving}
              style={styles.skipBtn}
              testID="photog-skip"
              activeOpacity={0.7}
            >
              <Text style={styles.skipTxt}>Do this later</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ToggleRow({
  label, sub, value, onChange, testID,
}: { label: string; sub: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleSub}>{sub}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#1f1f1f', true: colors.primary }}
        thumbColor={value ? '#fff' : '#777'}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  content: { padding: space.xl, paddingBottom: space.xxxl, gap: 0 },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.lg },
  progressDot: { width: 18, height: 3, borderRadius: 2, backgroundColor: colors.border },
  progressDotActive: { backgroundColor: colors.primary, width: 22 },
  progressDotDone: { backgroundColor: 'rgba(245,166,35,0.55)' },

  head: { color: colors.text, fontFamily: font.display, fontSize: 28, letterSpacing: -0.4, lineHeight: 34 },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, marginTop: 6, lineHeight: 20 },
  req: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase' },

  photoRow: { flexDirection: 'row', gap: 14, alignItems: 'center', marginTop: space.xl },
  photoCircle: {
    width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  photoImg: { width: 72, height: 72, borderRadius: 36 },
  photoCam: {
    position: 'absolute', right: -2, bottom: -2,
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary, borderWidth: 2, borderColor: '#000000',
  },
  photoLabel: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  photoHelp:  { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, lineHeight: 15 },

  sectionLabel: {
    color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11,
    letterSpacing: 0.7, textTransform: 'uppercase',
    marginTop: space.xl, marginBottom: 10,
  },
  smallHelp: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: -6, lineHeight: 15 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    minHeight: 36, justifyContent: 'center',
  },
  chipOn: { backgroundColor: 'rgba(245,166,35,0.16)', borderColor: colors.primary },
  chipTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 13 },
  chipTxtOn: { color: colors.primary, fontFamily: font.bodyBold },

  samplesRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  sampleCell: {
    flex: 1, aspectRatio: 1, borderRadius: radii.md, overflow: 'hidden',
    position: 'relative',
  },
  sampleEmpty: {
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
  },
  sampleImg: { width: '100%', height: '100%' },
  sampleRemove: {
    position: 'absolute', top: 4, right: 4,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },

  toggleList: {
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md, paddingHorizontal: space.md,
  },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  toggleLabel: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  toggleSub:   { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 2 },

  errTxt: { color: colors.secondary, fontFamily: font.bodyMedium, fontSize: 12, marginTop: 6, lineHeight: 16 },

  primaryBtn: {
    backgroundColor: colors.primary, borderRadius: radii.md,
    paddingVertical: 14, alignItems: 'center', justifyContent: 'center',
    minHeight: 48,
  },
  primaryBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 15, letterSpacing: 0.2 },
  skipBtn: { paddingVertical: 12, alignItems: 'center' },
  skipTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13 },
});
