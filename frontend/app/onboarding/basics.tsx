/**
 * /onboarding/basics \u2014 Phase 1 onboarding v2 (Jun 2025).
 *
 * "Set up your public profile" \u2014 blocking step shown to new email-path
 * signups before /(tabs). Collects the minimum required fields:
 *
 *   \u2022 First name        (required, private)
 *   \u2022 Display name      (required, public; defaults to first_name)
 *   \u2022 Username           (required, public; live-checked availability)
 *   \u2022 Home area          (required, public; city/region, never address)
 *
 * Optional:
 *   \u2022 Profile photo      (with explicit "Skip photo" button)
 *
 * Persistence: a single PATCH /auth/me payload that also sets
 * `basics_complete: true` so the user lands cleanly in the app.
 *
 * Existing (legacy) users never see this screen \u2014 the server's
 * `_compute_basics_complete` grandfathers them via `basics_complete: true`.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Alert,
  KeyboardAvoidingView, Platform, Pressable, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Camera, User as UserIcon, Trash2 } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useAuth } from '../../src/auth';
import { api, formatApiError } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import { useKeyboardHeight } from '../../src/hooks/useKeyboardHeight';
import { FormField } from '../../src/components/FormField';
import { UsernameField } from '../../src/components/UsernameField';
import { computeCompletionPercent } from '../../src/utils/profileCompletion';

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

export default function OnboardingBasics() {
  const { user, refresh } = useAuth();
  const kbHeight = useKeyboardHeight();

  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [displayName, setDisplayName] = useState(user?.display_name || user?.name || '');
  const [username, setUsername] = useState((user?.username || '').toLowerCase());
  const [homeArea, setHomeArea] = useState(user?.home_area || (user?.city ? `${user.city}${user.state ? ', ' + user.state : ''}` : ''));
  const [photo, setPhoto] = useState<string | null>(user?.profile_photo_url || user?.avatar_url || null);

  const [firstErr, setFirstErr] = useState<string | null>(null);
  const [displayErr, setDisplayErr] = useState<string | null>(null);
  const [homeErr, setHomeErr] = useState<string | null>(null);
  const [topErr, setTopErr] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  // Auto-fill display_name once first_name is typed and display is still empty.
  useEffect(() => {
    if (!displayName.trim() && firstName.trim()) {
      setDisplayName(firstName.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstName]);

  const optimisticPercent = useMemo(() => computeCompletionPercent({
    first_name: firstName, display_name: displayName, username, home_area: homeArea,
    profile_photo_url: photo,
  }), [firstName, displayName, username, homeArea, photo]);

  const pickPhoto = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') return;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const manip = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 600, height: 600 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      const dataUri = `data:image/jpeg;base64,${manip.base64}`;
      setPhoto(dataUri);
    } catch (e) {
      Alert.alert('Could not load image', formatApiError(e));
    }
  }, []);

  const validate = (): boolean => {
    let ok = true;
    if (firstName.trim().length < 2) { setFirstErr('Add a name people can recognize.'); ok = false; } else setFirstErr(null);
    if (displayName.trim().length < 2) { setDisplayErr('Add a name people can recognize.'); ok = false; } else setDisplayErr(null);
    if (!USERNAME_RE.test(username.trim())) {
      ok = false; // UsernameField surfaces its own error copy.
    }
    if (homeArea.trim().length < 2) { setHomeErr('Choose a city or metro area.'); ok = false; } else setHomeErr(null);
    return ok;
  };

  const onSave = useCallback(async (opts?: { skipPhoto?: boolean }) => {
    setTopErr(null);
    if (!validate()) return;
    setSaving(true);
    try {
      const payload: any = {
        first_name: firstName.trim(),
        display_name: displayName.trim(),
        name: displayName.trim(), // keep legacy `name` mirrored so existing UI works
        username: username.trim(),
        home_area: homeArea.trim(),
        basics_complete: true,
      };
      if (!opts?.skipPhoto && photo) {
        payload.profile_photo_url = photo;
        // Mirror to legacy field so /auth/me consumers using `avatar_url` see it
        payload.avatar_url = photo;
      }
      await api.patch('/auth/me', payload);
      await refresh();
      // Phase 2.1 — chain into the personalize step instead of dropping
      // straight into /(tabs). Existing users (already complete) never
      // see this screen so they're not impacted.
      router.replace('/onboarding/personalize' as any);
    } catch (e: any) {
      const raw = String(formatApiError(e) || '');
      if (/username/i.test(raw)) {
        setTopErr('That username is taken. Try another.');
      } else {
        setTopErr("We couldn't save your profile. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }, [firstName, displayName, username, homeArea, photo, refresh]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            Platform.OS === 'android' && kbHeight > 0 ? { paddingBottom: kbHeight + space.xxxl } : null,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Wizard progress indicator */}
          <View style={styles.progressRow}>
            <View style={[styles.progressDot, styles.progressDotActive]} />
            <View style={styles.progressDot} />
            <View style={styles.progressDot} />
            <Text style={styles.progressPct}>{optimisticPercent}%</Text>
          </View>

          <Text style={styles.head}>Set up your public profile</Text>
          <Text style={styles.sub}>Keep it simple. You can edit this any time.</Text>

          {/* Profile photo (optional) */}
          <View style={styles.photoRow}>
            <Pressable onPress={pickPhoto} style={styles.photoCircle} testID="basics-photo">
              {photo
                ? <Image source={{ uri: photo }} style={styles.photoImg} />
                : <UserIcon size={30} color={colors.textTertiary} />}
              <View style={styles.photoCam}>
                <Camera size={12} color={colors.textInverse} />
              </View>
            </Pressable>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.photoLabel}>Profile photo</Text>
              <Text style={styles.photoHelp}>Optional now. Recommended for trust and recognition.</Text>
              {photo ? (
                <TouchableOpacity onPress={() => setPhoto(null)} style={styles.photoRemove} hitSlop={6}>
                  <Trash2 size={11} color={colors.secondary} />
                  <Text style={styles.photoRemoveTxt}>Remove</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          <View style={{ gap: space.md, marginTop: space.lg }}>
            <FormField
              label="First name"
              value={firstName}
              onChangeText={(v) => { setFirstName(v); if (firstErr) setFirstErr(null); }}
              placeholder="Sophie"
              autoCapitalize="words"
              required
              helper="Used for payouts and support. Not shown on your profile."
              error={firstErr}
              testID="basics-first-name"
            />

            <FormField
              label="Display name"
              value={displayName}
              onChangeText={(v) => { setDisplayName(v); if (displayErr) setDisplayErr(null); }}
              placeholder="Sophie Reyes"
              autoCapitalize="words"
              required
              helper="Your real name or studio name — this is what others see."
              error={displayErr}
              testID="basics-display-name"
            />

            <UsernameField
              value={username}
              onChangeText={setUsername}
              required
              testID="basics-username"
            />

            <FormField
              label="Home area"
              value={homeArea}
              onChangeText={(v) => { setHomeArea(v); if (homeErr) setHomeErr(null); }}
              placeholder="Austin, TX"
              autoCapitalize="words"
              required
              helper="Shown as city/region, never your exact address."
              error={homeErr}
              testID="basics-home-area"
            />
          </View>

          {topErr ? <Text style={styles.topErr}>{topErr}</Text> : null}

          <View style={{ marginTop: space.xxl, gap: 10 }}>
            <TouchableOpacity
              onPress={() => onSave()}
              disabled={saving}
              style={[styles.primaryBtn, saving && styles.primaryBtnDisabled]}
              testID="basics-continue"
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <Text style={styles.primaryBtnTxt}>Continue</Text>
              )}
            </TouchableOpacity>

            {!photo ? (
              <TouchableOpacity
                onPress={() => onSave({ skipPhoto: true })}
                disabled={saving}
                style={styles.skipBtn}
                testID="basics-skip-photo"
                activeOpacity={0.7}
              >
                <Text style={styles.skipBtnTxt}>Skip photo</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  content: { padding: space.xl, paddingBottom: space.xxxl, minHeight: '100%' },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.lg },
  progressDot: { width: 18, height: 3, borderRadius: 2, backgroundColor: colors.border },
  progressDotActive: { backgroundColor: colors.primary, width: 22 },
  progressPct: {
    marginLeft: 'auto',
    color: colors.textTertiary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.5,
  },

  head: { color: colors.text, fontFamily: font.display, fontSize: 32, letterSpacing: -0.5 },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, marginTop: space.sm, lineHeight: 20 },

  photoRow: { flexDirection: 'row', gap: 14, alignItems: 'center', marginTop: space.xl },
  photoCircle: {
    width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  photoImg: { width: 72, height: 72, borderRadius: 36 },
  photoCam: {
    position: 'absolute', right: -2, bottom: -2,
    width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary, borderWidth: 2, borderColor: '#000000',
  },
  photoLabel: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  photoHelp: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, lineHeight: 15 },
  photoRemove: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  photoRemoveTxt: { color: colors.secondary, fontFamily: font.bodyMedium, fontSize: 11 },

  topErr: {
    color: colors.secondary, fontFamily: font.bodyMedium, fontSize: 12,
    marginTop: space.md, lineHeight: 16,
  },

  primaryBtn: {
    backgroundColor: colors.primary, borderRadius: radii.md,
    paddingVertical: 14, alignItems: 'center', justifyContent: 'center',
    minHeight: 48,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 15, letterSpacing: 0.2 },

  skipBtn: {
    paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
  },
  skipBtnTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13 },
});
