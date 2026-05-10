/**
 * onboarding/profile-setup.tsx
 * ─────────────────────────────────────────────────────────────────
 * May 2026 — Member profile completion flow.
 *
 * Required (gates `profile_complete`):
 *   • Name             → user.name
 *   • Portfolio link   → user.website
 *   • City             → user.city
 *   • State            → user.state
 *   • Years in business → user.years_experience  (0 is valid)
 *
 * Optional (never gate the flag):
 *   • Service radius (mi)              → user.service_radius_miles
 *   • Currently accepting bookings     → user.booking_available
 *   • Instagram handle                 → user.instagram
 *   • Facebook URL                     → user.facebook_url
 *   • TikTok URL                       → user.tiktok_url
 *   • Available as 2nd shooter         → user.available_for_second_shooter
 *   • Open to mentoring                → user.mentorship_available
 *   • Specialties                      → user.specialties[]
 *
 * Field-name mapping is intentionally to the existing canonical user
 * schema so /auth/me and the profile page automatically render the
 * new data without separate plumbing. No new backend fields.
 */
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Switch,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Pressable,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, Camera, ImagePlus, Trash2, User as UserIcon } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import { formatApiError } from '../../src/api';
import { useKeyboardHeight } from '../../src/hooks/useKeyboardHeight';

// US state abbreviations + a sentinel for "Other / international" so
// we never block a user who's outside the US. The full picker is a
// scrollable list — no native picker dep required.
const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

const SPECIALTY_OPTIONS = [
  'Portraits','Weddings','Couples','Families','Pets','Seniors','Sports',
  'Events','Landscape','Drone','Real Estate','Automotive','Street','Branding',
  'Headshots','Maternity','Newborn','Travel','Wildlife','Concerts','Graduation',
];

// Looser URL regex that matches the backend (`^https?://...\....$`),
// plus a friendly auto-prefix when the user types "myportfolio.com"
// without a scheme.
const URL_RE = /^https?:\/\/[^\s]+\.[^\s]+$/i;
function autoPrefixUrl(s: string): string {
  const t = s.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}
function isValidUrlSoft(s: string): boolean {
  if (!s) return true; // optional fields → empty is valid
  return URL_RE.test(autoPrefixUrl(s));
}

export default function ProfileSetupScreen() {
  const { user, loading, refresh, updateProfile, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const kbHeight = useKeyboardHeight();

  // ───── form state — prefilled from existing user so re-prompted
  // users (incomplete legacy accounts) keep all data they already
  // had. Defensive defaults keep the inputs always controlled.
  const [name, setName] = useState((user?.name || '').trim());
  const [website, setWebsite] = useState((user?.website || '').trim());
  const [city, setCity] = useState((user?.city || '').trim());
  const [state, setState] = useState((user?.state || '').trim().toUpperCase());
  const [statePickerOpen, setStatePickerOpen] = useState(false);
  // June 2025 — international support: when true, the state field
  // becomes a free-text input (e.g. "Bavaria", "ON", "São Paulo") and
  // we skip the US-state-list constraint. Auto-detected on mount when
  // the existing user.state isn't a recognised US abbrev.
  const initialIntl = !!(user?.state && !US_STATES.includes((user.state || '').trim().toUpperCase()));
  const [intlMode, setIntlMode] = useState(initialIntl);
  const [years, setYears] = useState<string>(
    user?.years_experience != null ? String(user.years_experience) : '',
  );
  // optional
  const [serviceRadius, setServiceRadius] = useState<string>(
    (user as any)?.service_radius_miles != null ? String((user as any).service_radius_miles) : '',
  );
  const [acceptingBookings, setAcceptingBookings] = useState<boolean>(
    !!(user as any)?.booking_available,
  );
  const [instagram, setInstagram] = useState((user?.instagram || '').trim());
  const [facebook, setFacebook] = useState(((user as any)?.facebook_url || '').trim());
  const [tiktok, setTiktok] = useState(((user as any)?.tiktok_url || '').trim());
  const [secondShooter, setSecondShooter] = useState<boolean>(
    !!(user as any)?.available_for_second_shooter,
  );
  const [mentoring, setMentoring] = useState<boolean>(
    !!(user as any)?.mentorship_available,
  );
  const [specialties, setSpecialties] = useState<string[]>(
    Array.isArray(user?.specialties) ? (user!.specialties as string[]) : [],
  );
  // ─── Profile photo + Banner (May 2026, optional) ────────────────────
  // Both store a data: URL while in-flight; we send them through to
  // PATCH /auth/me on Save so the user's existing edit logic
  // (avatar_image_url + avatar_url + banner_image_url) is reused
  // verbatim. Prefilled from existing user fields so a re-prompted
  // user never loses what they already had.
  const [avatarUri, setAvatarUri] = useState<string | null>(
    (user as any)?.avatar_image_url || user?.avatar_url || null,
  );
  const [bannerUri, setBannerUri] = useState<string | null>(
    (user as any)?.banner_image_url || null,
  );
  const [uploadingKind, setUploadingKind] = useState<'avatar' | 'banner' | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Re-fetch the user on mount in case they navigated here via a
  // stale cache (e.g. another device updated the profile).
  useEffect(() => { refresh(); }, [refresh]);

  // Already complete? Bounce back to the app. This protects against
  // an admin-side back-fill that flips the flag while this screen
  // is open, and prevents the rare back-button-into-this-screen
  // scenario after a successful save.
  useEffect(() => {
    if (!loading && user && (user as any).profile_complete) {
      router.replace('/(tabs)');
    }
  }, [user, loading]);

  // ───── validation
  const validate = useCallback((): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!name.trim() || name.trim().length < 2) e.name = 'Please enter your name (2+ characters).';
    const w = autoPrefixUrl(website);
    if (!w) e.website = 'Add a portfolio or social link.';
    else if (!URL_RE.test(w)) e.website = 'That doesn\'t look like a valid link.';
    if (!city.trim()) e.city = 'Where are you based?';
    if (!state.trim()) e.state = intlMode ? 'Enter your region.' : 'Pick a state.';
    const yn = Number(years);
    if (years === '' || !Number.isFinite(yn) || yn < 0) e.years = 'Use 0 if you\'re just starting out.';
    // Optional URL validations
    if (facebook && !isValidUrlSoft(facebook)) e.facebook = 'Invalid URL.';
    if (tiktok && !isValidUrlSoft(tiktok)) e.tiktok = 'Invalid URL.';
    return e;
  }, [name, website, city, state, years, facebook, tiktok, intlMode]);

  const canSave = useMemo(() => Object.keys(validate()).length === 0 && !submitting, [validate, submitting]);

  const toggleSpec = (s: string) => {
    setSpecialties((prev) => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  // ─── Pick + manipulate avatar / banner (May 2026) ─────────────────
  // Logic mirrors `pickAndUpload` on /(tabs)/profile.tsx so the
  // resulting data: URLs are byte-compatible with the existing edit
  // flow — the only difference is we hold them in component state
  // until the user taps Save & Continue, instead of writing each
  // upload immediately. This keeps the onboarding feel "everything
  // saves together" and lets the user remove/replace before commit.
  const pickAndStage = useCallback(async (kind: 'avatar' | 'banner') => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Allow photo access', 'LumaScout needs permission to read your photos for the profile picture.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        // @ts-ignore — string union accepted by SDK 54
        mediaTypes: ['images'],
        quality: 1,
        base64: false,
        allowsEditing: true,
        aspect: kind === 'banner' ? [3, 1] : [1, 1],
      });
      if (res.canceled) return;
      const asset = res.assets[0];
      setUploadingKind(kind);
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: kind === 'banner' ? 1400 : 600 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!manipulated.base64) {
        Alert.alert('Could not process image');
        return;
      }
      const dataUrl = `data:image/jpeg;base64,${manipulated.base64}`;
      if (kind === 'avatar') setAvatarUri(dataUrl);
      else setBannerUri(dataUrl);
    } catch (e: any) {
      Alert.alert('Couldn\'t add the image', formatApiError(e) || 'Please try again.');
    } finally {
      setUploadingKind(null);
    }
  }, []);

  // Has user changed the avatar/banner relative to what's already on
  // the user record? If unchanged, we skip those keys entirely on save
  // so the backend $set never re-writes them (small bandwidth win,
  // and avoids accidentally copying the existing value back into
  // both `avatar_image_url` AND `avatar_url` when only one was set).
  const avatarChanged = useMemo(() => {
    const original = (user as any)?.avatar_image_url || user?.avatar_url || null;
    return avatarUri !== original;
  }, [avatarUri, user]);
  const bannerChanged = useMemo(() => {
    const original = (user as any)?.banner_image_url || null;
    return bannerUri !== original;
  }, [bannerUri, user]);

  const handleSave = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      Alert.alert('Almost there', 'Please complete the required fields highlighted in red.');
      return;
    }
    setSubmitting(true);
    try {
      // Compose patch — send ONLY the keys we care about so other
      // fields (avatar, bio, plan, role, prefs) are untouched.
      const yn = Number(years);
      const sr = serviceRadius.trim() === '' ? null : Number(serviceRadius);
      await updateProfile({
        name: name.trim(),
        website: autoPrefixUrl(website),
        city: city.trim(),
        state: intlMode ? state.trim() : state.trim().toUpperCase(),
        years_experience: Number.isFinite(yn) ? yn : 0,
        // Optional — only send the ones the user actually engaged with.
        // Empty strings stay as empty strings so the backend $set
        // doesn't pick them up (UserUpdateIn drops null, not '').
        // We coerce blanks → null so server-side filter (`v is not None`)
        // skips them and previous values aren't accidentally cleared.
        service_radius_miles: Number.isFinite(sr as number) ? (sr as number) : (undefined as any),
        booking_available: acceptingBookings,
        instagram: instagram.trim() || (undefined as any),
        facebook_url: facebook.trim() ? autoPrefixUrl(facebook) : (undefined as any),
        tiktok_url: tiktok.trim() ? autoPrefixUrl(tiktok) : (undefined as any),
        available_for_second_shooter: secondShooter,
        mentorship_available: mentoring,
        specialties,
        // ── Profile photo + Banner (May 2026) ───────────────────────
        // Only include when the user changed them in this session.
        // When unchanged we OMIT the keys entirely so an existing
        // server-side avatar / banner is never re-sent (and never
        // accidentally overwritten on a future schema migration).
        // avatar_image_url + avatar_url match the existing
        // /(tabs)/profile.tsx contract — both fields are written so
        // older readers of `avatar_url` continue to work.
        ...(avatarChanged && avatarUri
          ? { avatar_image_url: avatarUri, avatar_url: avatarUri }
          : {}),
        ...(bannerChanged && bannerUri
          ? { banner_image_url: bannerUri }
          : {}),
      } as any);
      // Hard refresh so /auth/me's recomputed `profile_complete`
      // arrives before the Gate re-evaluates on the next render.
      await refresh();
      router.replace('/(tabs)');
    } catch (err: any) {
      Alert.alert('Couldn\'t save your profile', formatApiError(err) || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign out?',
      'You\'ll need to sign back in to use LumaScout. Your account stays exactly where you left it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: async () => { try { await logout(); router.replace('/onboarding'); } catch {} } },
      ],
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[s.scroll, { paddingBottom: space.xl + (Platform.OS === 'android' ? kbHeight : 0) }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={s.kicker}>WELCOME TO LUMASCOUT</Text>
          <Text style={s.title}>Complete your photographer profile</Text>
          <Text style={s.subtitle}>
            Help other photographers know who you are, where you work, and what you shoot.
          </Text>

          {/* ───────────── REQUIRED ───────────── */}
          <Text style={s.sectionLabel}>REQUIRED</Text>

          <Field label="Name" error={errors.name}>
            <TextInput
              style={[s.input, errors.name && s.inputError]}
              value={name}
              onChangeText={setName}
              placeholder="Your full name"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="words"
              returnKeyType="next"
              testID="profile-setup-name"
            />
          </Field>

          <Field label="Portfolio link" error={errors.website} hint="Website, Instagram, Adobe Portfolio…">
            <TextInput
              style={[s.input, errors.website && s.inputError]}
              value={website}
              onChangeText={setWebsite}
              placeholder="https://myportfolio.com"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="next"
              testID="profile-setup-website"
            />
          </Field>

          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 2 }}>
              <Field label="City" error={errors.city}>
                <TextInput
                  style={[s.input, errors.city && s.inputError]}
                  value={city}
                  onChangeText={setCity}
                  placeholder="San Antonio"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="words"
                  testID="profile-setup-city"
                />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label={intlMode ? 'Region' : 'State'} error={errors.state}>
                {intlMode ? (
                  <TextInput
                    style={[s.input, errors.state && s.inputError]}
                    value={state}
                    onChangeText={setState}
                    placeholder="Region"
                    placeholderTextColor={colors.textTertiary}
                    autoCapitalize="words"
                    maxLength={40}
                    testID="profile-setup-state-intl"
                  />
                ) : (
                  <TouchableOpacity
                    style={[s.input, s.statePill, errors.state && s.inputError]}
                    onPress={() => setStatePickerOpen((v) => !v)}
                    testID="profile-setup-state"
                  >
                    <Text style={[s.stateTxt, !state && { color: colors.textTertiary }]}>
                      {state || 'TX'}
                    </Text>
                  </TouchableOpacity>
                )}
              </Field>
            </View>
          </View>

          {statePickerOpen && !intlMode ? (
            <View style={s.statePicker}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 4 }}>
                {US_STATES.map((st) => (
                  <TouchableOpacity
                    key={st}
                    onPress={() => { setState(st); setStatePickerOpen(false); }}
                    style={[s.stateChip, state === st && s.stateChipActive]}
                  >
                    <Text style={[s.stateChipTxt, state === st && s.stateChipTxtActive]}>{st}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  key="__intl"
                  onPress={() => { setIntlMode(true); setState(''); setStatePickerOpen(false); }}
                  style={[s.stateChip, { paddingHorizontal: 12 }]}
                  testID="profile-setup-state-intl-toggle"
                >
                  <Text style={s.stateChipTxt}>🌍 Other / Intl.</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          ) : null}

          {intlMode ? (
            <TouchableOpacity
              onPress={() => { setIntlMode(false); setState(''); }}
              style={{ alignSelf: 'flex-start', paddingVertical: 4 }}
            >
              <Text style={{ color: colors.primary, fontFamily: font.bodyBold, fontSize: 12 }}>
                ← Back to US states
              </Text>
            </TouchableOpacity>
          ) : null}

          <Field label="Years in business" error={errors.years} hint="Use 0 if you're just starting out.">
            <TextInput
              style={[s.input, errors.years && s.inputError]}
              value={years}
              onChangeText={(t) => setYears(t.replace(/[^0-9]/g, ''))}
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
              keyboardType="number-pad"
              maxLength={2}
              testID="profile-setup-years"
            />
          </Field>

          {/* ───────────── PROFILE PHOTO (optional, encouraged) ─────
              Sits between Required and Optional so it gets visual
              prominence without blocking completion. PRD copy:
              "Help other photographers recognize and trust you." */}
          <View style={s.photoSection}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable
                onPress={() => pickAndStage('avatar')}
                style={s.avatarRing}
                accessibilityLabel="Add a profile photo"
                testID="profile-setup-avatar-pick"
              >
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={s.avatarImg} />
                ) : (
                  <View style={s.avatarPlaceholder}>
                    {uploadingKind === 'avatar'
                      ? <ActivityIndicator color={colors.primary} />
                      : <UserIcon size={28} color={colors.textTertiary} />}
                  </View>
                )}
                <View style={s.avatarBadge}>
                  <Camera size={11} color={colors.textInverse} />
                </View>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={s.photoTitle}>Add a profile photo</Text>
                <Text style={s.photoHint}>
                  Help other photographers recognize and trust you.{'  '}
                  <Text style={s.optionalTag}>Optional</Text>
                </Text>
                <View style={s.photoBtnRow}>
                  <TouchableOpacity
                    onPress={() => pickAndStage('avatar')}
                    style={s.photoPrimaryBtn}
                    disabled={uploadingKind === 'avatar'}
                    testID="profile-setup-avatar-upload"
                  >
                    <ImagePlus size={13} color={colors.textInverse} />
                    <Text style={s.photoPrimaryTxt}>
                      {avatarUri ? 'Replace photo' : 'Upload Photo'}
                    </Text>
                  </TouchableOpacity>
                  {avatarUri ? (
                    <TouchableOpacity
                      onPress={() => setAvatarUri(null)}
                      style={s.photoGhostBtn}
                      hitSlop={6}
                      testID="profile-setup-avatar-remove"
                    >
                      <Trash2 size={13} color={colors.textSecondary} />
                      <Text style={s.photoGhostTxt}>Remove</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={s.photoGhostTxt}>or skip for now</Text>
                  )}
                </View>
              </View>
            </View>
          </View>

          {/* ───────────── BANNER IMAGE (optional) ───────────────────
              Same pattern as the avatar but with a wider 3:1 aspect
              and stacked layout so the preview reads at a glance. */}
          <View style={s.photoSection}>
            <Text style={s.photoTitle}>Add a banner image</Text>
            <Text style={s.photoHint}>
              Show off your photography style with a cover image.{'  '}
              <Text style={s.optionalTag}>Optional</Text>
            </Text>
            <Pressable
              onPress={() => pickAndStage('banner')}
              style={[s.bannerWrap, !!bannerUri && { borderStyle: 'solid' }]}
              testID="profile-setup-banner-pick"
            >
              {bannerUri ? (
                <Image source={{ uri: bannerUri }} style={s.bannerImg} />
              ) : (
                <View style={s.bannerPlaceholder}>
                  {uploadingKind === 'banner'
                    ? <ActivityIndicator color={colors.primary} />
                    : <ImagePlus size={26} color={colors.textTertiary} />}
                  <Text style={s.bannerHint}>Tap to choose a wide cover photo</Text>
                </View>
              )}
            </Pressable>
            <View style={[s.photoBtnRow, { marginTop: 10 }]}>
              <TouchableOpacity
                onPress={() => pickAndStage('banner')}
                style={s.photoPrimaryBtn}
                disabled={uploadingKind === 'banner'}
                testID="profile-setup-banner-upload"
              >
                <ImagePlus size={13} color={colors.textInverse} />
                <Text style={s.photoPrimaryTxt}>
                  {bannerUri ? 'Replace banner' : 'Upload Banner'}
                </Text>
              </TouchableOpacity>
              {bannerUri ? (
                <TouchableOpacity
                  onPress={() => setBannerUri(null)}
                  style={s.photoGhostBtn}
                  hitSlop={6}
                  testID="profile-setup-banner-remove"
                >
                  <Trash2 size={13} color={colors.textSecondary} />
                  <Text style={s.photoGhostTxt}>Remove</Text>
                </TouchableOpacity>
              ) : (
                <Text style={s.photoGhostTxt}>or skip</Text>
              )}
            </View>
          </View>

          {/* ───────────── OPTIONAL ───────────── */}
          <Text style={[s.sectionLabel, { marginTop: space.xl }]}>OPTIONAL</Text>
          <Text style={s.sectionHint}>Skip anything that doesn't apply yet — you can edit these later from your profile.</Text>

          <Field label="Service radius (miles)" optional>
            <TextInput
              style={s.input}
              value={serviceRadius}
              onChangeText={(t) => setServiceRadius(t.replace(/[^0-9]/g, ''))}
              placeholder="e.g. 50"
              placeholderTextColor={colors.textTertiary}
              keyboardType="number-pad"
              maxLength={3}
            />
          </Field>

          <ToggleRow label="Currently accepting bookings" value={acceptingBookings} onChange={setAcceptingBookings} />

          <Field label="Instagram handle" optional>
            <TextInput
              style={s.input}
              value={instagram}
              onChangeText={setInstagram}
              placeholder="@yourhandle"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>

          <Field label="Facebook URL" optional error={errors.facebook}>
            <TextInput
              style={[s.input, errors.facebook && s.inputError]}
              value={facebook}
              onChangeText={setFacebook}
              placeholder="https://facebook.com/your-page"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </Field>

          <Field label="TikTok URL" optional error={errors.tiktok}>
            <TextInput
              style={[s.input, errors.tiktok && s.inputError]}
              value={tiktok}
              onChangeText={setTiktok}
              placeholder="https://tiktok.com/@yourhandle"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </Field>

          <ToggleRow label="Available as 2nd shooter" value={secondShooter} onChange={setSecondShooter} />
          <ToggleRow label="Open to mentoring" value={mentoring} onChange={setMentoring} />

          <Text style={s.fieldLabel}>Specialties <Text style={s.optionalTag}>Optional</Text></Text>
          <View style={s.chipRow}>
            {SPECIALTY_OPTIONS.map((sp) => {
              const on = specialties.includes(sp);
              return (
                <TouchableOpacity
                  key={sp}
                  onPress={() => toggleSpec(sp)}
                  style={[s.specChip, on && s.specChipOn]}
                >
                  {on ? <Check size={12} color={colors.textInverse} /> : null}
                  <Text style={[s.specChipTxt, on && s.specChipTxtOn]}>{sp}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity onPress={handleSignOut} style={{ alignSelf: 'center', paddingVertical: space.lg }}>
            <Text style={s.signOut}>Not you? Sign out</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* ───────── Sticky bottom Save bar ─────────
            May 2026 fix — the bar used to be `position: absolute`
            inside the KeyboardAvoidingView. On iOS with
            `behavior="padding"` the KAV pads its bottom by keyboard
            height, which pushed the absolutely-pinned bar BELOW the
            keyboard (and out of view) until the user hit Return to
            dismiss the keyboard. Switching to a flex-layout sibling
            of the ScrollView lets the bar ride the KAV's natural
            compression — so it stays above the keyboard on iOS and
            above the OS nav on Android without any absolute math. */}
        <View style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
          <TouchableOpacity
            onPress={handleSave}
            disabled={!canSave}
            style={[s.saveBtn, !canSave && s.saveBtnDisabled]}
            testID="profile-setup-save"
          >
            {submitting
              ? <ActivityIndicator color={colors.textInverse} />
              : <Text style={s.saveTxt}>Save & Continue</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ───── small subcomponents ─────────────────────────────────────────
function Field({
  label, hint, optional, error, children,
}: { label: string; hint?: string; optional?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: space.md }}>
      <Text style={s.fieldLabel}>
        {label}{optional ? <Text style={s.optionalTag}>  Optional</Text> : null}
      </Text>
      {children}
      {error ? <Text style={s.errorTxt}>{error}</Text>
        : hint ? <Text style={s.hintTxt}>{hint}</Text> : null}
    </View>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={s.toggleRow}>
      <Text style={s.toggleLbl}>{label}<Text style={s.optionalTag}>  Optional</Text></Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.surface2, true: colors.primary }}
        thumbColor={Platform.OS === 'android' ? (value ? colors.textInverse : colors.surface) : undefined}
      />
    </Pressable>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: space.lg, paddingTop: space.md },
  kicker: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 1.4, marginBottom: 6 },
  title: { color: colors.text, fontFamily: font.display, fontSize: 26, lineHeight: 32 },
  subtitle: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, lineHeight: 20, marginTop: 8 },
  sectionLabel: { color: colors.textTertiary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 1.2, marginTop: space.xl, marginBottom: 4 },
  sectionHint: { color: colors.textTertiary, fontFamily: font.body, fontSize: 12, marginBottom: space.sm },

  fieldLabel: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 12, letterSpacing: 0.4, marginBottom: 6 },
  optionalTag: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  hintTxt: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 4 },
  errorTxt: { color: colors.secondary, fontFamily: font.body, fontSize: 12, marginTop: 4 },

  input: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 11,
    color: colors.text,
    fontFamily: font.body,
    fontSize: 15,
    minHeight: 48,
  },
  inputError: { borderColor: colors.secondary },

  statePill: { justifyContent: 'center' },
  stateTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  statePicker: { marginTop: 6 },
  stateChip: {
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, minWidth: 48, alignItems: 'center',
  },
  stateChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  stateChipTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 12 },
  stateChipTxtActive: { color: colors.textInverse },

  toggleRow: {
    marginTop: space.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.md,
  },
  toggleLbl: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14, flex: 1, paddingRight: 10 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  specChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill,
  },
  specChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  specChipTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 12 },
  specChipTxtOn: { color: colors.textInverse },

  bottomBar: {
    // May 2026 — NOT absolute. Flex-sibling of the ScrollView so the
    // KeyboardAvoidingView's natural compression on iOS lifts the
    // bar above the keyboard without any manual offset math. The
    // scroll view above it still takes `flex: 1` so the bar always
    // sticks to the bottom of the visible area.
    paddingHorizontal: space.lg, paddingTop: space.md,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: -2 } },
      android: { elevation: 8 },
      default: {},
    }),
  },
  saveBtn: {
    minHeight: 50, borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 15 },

  signOut: { color: colors.textTertiary, fontFamily: font.body, fontSize: 13, textDecorationLine: 'underline' },

  // ─── Profile photo + Banner sections (May 2026) ─────────────────
  photoSection: {
    marginTop: space.lg,
    padding: space.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  photoTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14, lineHeight: 18 },
  photoHint: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17, marginTop: 4 },
  photoBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' },
  photoPrimaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radii.pill, backgroundColor: colors.primary,
  },
  photoPrimaryTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 12 },
  photoGhostBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  photoGhostTxt: { color: colors.textTertiary, fontFamily: font.body, fontSize: 12 },

  // Avatar ring
  avatarRing: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 2, borderColor: colors.primary,
    padding: 3,
    overflow: 'visible',
  },
  avatarImg: { width: '100%', height: '100%', borderRadius: 999 },
  avatarPlaceholder: {
    width: '100%', height: '100%', borderRadius: 999,
    backgroundColor: colors.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarBadge: {
    position: 'absolute', right: -2, bottom: -2,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.primary,
    borderWidth: 2, borderColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
  },

  // Banner — 3:1 aspect, dashed when empty so it reads as a drop zone
  bannerWrap: {
    marginTop: 10,
    width: '100%', aspectRatio: 3,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  bannerImg: { width: '100%', height: '100%' },
  bannerPlaceholder: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  bannerHint: { color: colors.textTertiary, fontFamily: font.body, fontSize: 12 },
});
