import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  Switch,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { ChevronLeft, ChevronRight, MapPin, Image as ImageIcon, Plus, Check, X, Zap, Crown, AlertTriangle, Search, Map as MapIcon, Edit3, FileText, Sun, Eye, EyeOff, Sparkles, Circle } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii, SHOOT_TYPES, BEST_TIMES, PRIVACY_MODES } from '../../src/theme';
import { Button } from '../../src/components/Button';
import LocationSearchSheet, { PlaceResult } from '../../src/components/LocationSearchSheet';
import MapPickerSheet from '../../src/components/MapPickerSheet';
import ManualLocationSheet, { ManualLocation } from '../../src/components/ManualLocationSheet';
import { Input, Chip } from '../../src/components/ui';
import ScoutAICard from '../../src/components/ScoutAICard';

const STEPS = ['Photos', 'Location', 'Details', 'Ratings', 'Privacy', 'Review'];

type Draft = {
  latitude?: number;
  longitude?: number;
  locationLabel?: string;
  locationSource?: 'gps' | 'searched_place' | 'dropped_pin' | 'manual_entry';
  originalSearchQuery?: string;
  geocodeConfidence?: number;
  addressLine1?: string;
  postalCode?: string;
  landmarkNotes?: string;
  // FIX(Commit 7.5 / 2026-04): location-integrity provenance fields.
  originalAddressInput?: string;
  geocodeStatus?: 'success' | 'failed' | 'low_confidence' | 'skipped';
  landmark: string;  // Step 3 user-entered "Park / landmark / area" (surfaced separately)
  images: { image_url: string; caption?: string; is_cover: boolean }[];
  title: string;
  city: string;
  state: string;
  description: string;
  shoot_types: string[];
  style_tags: string[];
  best_time_of_day?: string;
  sunrise_rating: number;
  sunset_rating: number;
  morning_golden_hour_rating: number;
  evening_golden_hour_rating: number;
  shade_rating: number;
  variety_rating: number;
  crowd_level: number;
  safety_rating: number;
  parking_rating: number;   // 1-5 ease of parking (higher = easier)
  walk_rating: number;      // 1-5 walking distance (lower = easier)
  composition_flex: number; // 1-5 compositional flexibility
  dog_friendly: boolean;
  kid_friendly: boolean;
  accessible: boolean;
  indoor: boolean;
  permit_required: boolean;
  fee_required: boolean;
  parking_notes: string;
  lens_recommendations: string;
  best_lens_range: string;  // e.g. "35-85mm"
  // FIX(2026-04): [1.2] Consolidated free-form notes captured on Ratings & Notes step.
  notes: string;
  privacy_mode: string;
  location_display_mode: string;
};

type DupCandidate = {
  spot_id: string;
  title: string;
  city: string;
  state: string;
  distance_m: number;
  title_similarity: number;
  images?: { image_url: string }[];
};

const initialDraft: Draft = {
  images: [],
  title: '',
  city: '',
  state: 'TX',
  landmark: '',
  description: '',
  shoot_types: [],
  style_tags: [],
  sunrise_rating: 3,
  sunset_rating: 4,
  morning_golden_hour_rating: 4,
  evening_golden_hour_rating: 4,
  shade_rating: 3,
  variety_rating: 4,
  crowd_level: 3,
  safety_rating: 4,
  parking_rating: 3,
  walk_rating: 2,
  composition_flex: 3,
  dog_friendly: false,
  kid_friendly: true,
  accessible: false,
  indoor: false,
  permit_required: false,
  fee_required: false,
  parking_notes: '',
  lens_recommendations: '',
  best_lens_range: '',
  notes: '',
  privacy_mode: 'public',
  location_display_mode: 'exact',
};

export default function AddSpot() {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [submitting, setSubmitting] = useState(false);
  const [dupCandidates, setDupCandidates] = useState<DupCandidate[]>([]);
  const [dupChecking, setDupChecking] = useState(false);
  // Location-method sheet state + recent locations for one-tap reuse
  const [searchOpen, setSearchOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [aiAssistBusy, setAiAssistBusy] = useState(false);
  const [aiAssistError, setAiAssistError] = useState('');
  const [aiAssistTips, setAiAssistTips] = useState<string[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  // Raw editable string for style tags so the user can freely type commas and
  // spaces. We only split into an array when the input loses focus.
  const [tagsText, setTagsText] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/me/recent-locations', { limit: 8 });
        setRecent(r?.items || []);
      } catch {}
    })();
  }, []);

  // Handlers for each location method — each one populates the draft and
  // records the `locationSource` so the backend knows where the coord came from.
  const applyGps = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location permission denied',
          "That's okay — you can search, drop a pin, or enter the location by hand instead.",
        );
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      setDraft({
        ...draft,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        locationLabel: `Current location · ${loc.coords.latitude.toFixed(4)}, ${loc.coords.longitude.toFixed(4)}`,
        locationSource: 'gps',
        originalSearchQuery: undefined,
        geocodeConfidence: undefined,
      });
    } catch (e) {
      Alert.alert('Could not read location', String(e));
    }
  };

  const applySearchedPlace = (p: PlaceResult) => {
    if (p.latitude == null || p.longitude == null) return;
    setDraft({
      ...draft,
      latitude: p.latitude,
      longitude: p.longitude,
      locationLabel: p.display_name,
      locationSource: 'searched_place',
      originalSearchQuery: p.name || p.display_name,
      geocodeConfidence: p.confidence,
      city: p.city || draft.city,
      state: (p.state || draft.state || '').slice(0, 2).toUpperCase() || draft.state,
      title: draft.title || p.name || '',
    });
  };

  const applyDroppedPin = (pin: { latitude: number; longitude: number; label: string; city: string; state: string; country: string }) => {
    setDraft({
      ...draft,
      latitude: pin.latitude,
      longitude: pin.longitude,
      locationLabel: pin.label,
      locationSource: 'dropped_pin',
      city: pin.city || draft.city,
      state: (pin.state || draft.state || '').slice(0, 2).toUpperCase() || draft.state,
    });
  };

  const applyManualEntry = (loc: ManualLocation) => {
    setDraft({
      ...draft,
      latitude: loc.latitude,
      longitude: loc.longitude,
      locationLabel: [loc.address_line1, `${loc.city}, ${loc.state}`].filter(Boolean).join(' · '),
      locationSource: 'manual_entry',
      addressLine1: loc.address_line1,
      postalCode: loc.postal_code,
      landmarkNotes: loc.landmark_notes,
      title: draft.title || loc.title,
      city: loc.city,
      state: (loc.state || '').slice(0, 2).toUpperCase(),
      // FIX(Commit 7.5): carry the raw user input + geocode resolution forward.
      originalAddressInput: loc.original_address_input,
      geocodeStatus: loc.geocode_status,
      geocodeConfidence: loc.geocode_confidence ?? draft.geocodeConfidence,
    });
  };

  const applyRecentLocation = (r: any) => {
    setDraft({
      ...draft,
      latitude: r.latitude,
      longitude: r.longitude,
      locationLabel: `${r.title} (reused)`,
      locationSource: 'manual_entry',
      city: r.city || draft.city,
      state: (r.state || draft.state || '').slice(0, 2).toUpperCase() || draft.state,
    });
  };

  // Debounced duplicate check whenever lat/lng/title changes
  React.useEffect(() => {
    if (draft.latitude == null || draft.longitude == null) {
      setDupCandidates([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setDupChecking(true);
      try {
        const r = await api.get('/spots/check-duplicates', {
          latitude: draft.latitude,
          longitude: draft.longitude,
          title: draft.title || undefined,
          radius_m: 200,
        });
        if (!cancelled) setDupCandidates(r?.candidates || []);
      } catch { if (!cancelled) setDupCandidates([]); }
      finally { if (!cancelled) setDupChecking(false); }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [draft.latitude, draft.longitude, draft.title]);

  if (!user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: space.xl }}>
        <Text style={{ color: colors.text, fontFamily: font.display, fontSize: 28, marginBottom: 12 }}>
          Sign in to add spots
        </Text>
        <Button title="Sign in" onPress={() => router.push('/(auth)/login')} />
      </SafeAreaView>
    );
  }

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const prev = () => (step === 0 ? router.replace('/(tabs)') : setStep((s) => s - 1));

  const pickImages = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Media permission required to upload photos');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 1,
      base64: false,
      selectionLimit: 6,
    });
    if (res.canceled) return;

    // Resize & compress each picked image so the final BSON doc stays well under
    // MongoDB's 16MB hard cap. We cap width at 1280px and JPEG quality at 0.6
    // which typically keeps each base64 payload under ~600KB.
    const processed: { image_url: string; is_cover: boolean }[] = [];
    for (let i = 0; i < res.assets.length; i++) {
      const a = res.assets[i];
      try {
        const manipulated = await ImageManipulator.manipulateAsync(
          a.uri,
          [{ resize: { width: 1280 } }],
          {
            compress: 0.6,
            format: ImageManipulator.SaveFormat.JPEG,
            base64: true,
          },
        );
        if (manipulated.base64) {
          processed.push({
            image_url: `data:image/jpeg;base64,${manipulated.base64}`,
            is_cover: draft.images.length === 0 && processed.length === 0,
          });
        }
      } catch (err) {
        console.warn('Image compression failed, skipping photo', err);
      }
    }

    if (processed.length === 0) {
      Alert.alert('Could not process photos', 'Please try picking different images.');
      return;
    }
    setDraft({ ...draft, images: [...draft.images, ...processed].slice(0, 8) });
  };

  const setCover = (idx: number) => {
    setDraft({
      ...draft,
      images: draft.images.map((img, i) => ({ ...img, is_cover: i === idx })),
    });
  };

  const removeImg = (idx: number) => {
    const next = draft.images.filter((_, i) => i !== idx);
    if (next.length > 0 && !next.some((i) => i.is_cover)) next[0].is_cover = true;
    setDraft({ ...draft, images: next });
  };

  const toggleInArr = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const canProceed = () => {
    // New step order: 0=Photos, 1=Location, 2=Details, 3=Notes, 4=Privacy, 5=Review
    if (step === 0) return draft.privacy_mode !== 'public' || draft.images.length >= 1;
    // FIX(Commit 7.5 / 2026-04): require REAL coordinates. Previously we let
    // manual_entry through with lat==null which downstream coerced to 0,
    // saving the spot at (0, 0) in the Atlantic Ocean. That's gone now — you
    // cannot leave the Location step without a geocoded address or a dropped pin.
    if (step === 1) return !!(draft.city && draft.state
      && draft.latitude != null && draft.longitude != null
      && !(draft.latitude === 0 && draft.longitude === 0));
    if (step === 2) return draft.title.trim() && draft.city.trim();
    return true;
  };

  // FIX(Commit 7.5): Publish gate now requires valid, non-zero coordinates.
  const canPublishFromReview =
    (draft.images.length >= 1 || draft.privacy_mode === 'private') &&
    draft.title.trim().length >= 3 &&
    draft.city.trim().length >= 2 &&
    draft.latitude != null && draft.longitude != null &&
    !(draft.latitude === 0 && draft.longitude === 0) &&
    draft.shoot_types.length > 0;

  const buildPayload = (asDraft: boolean) => ({
    title: draft.title,
    description: draft.description,
    // FIX(Commit 7.5 / 2026-04): DO NOT coerce lat/lng with `|| 0`. That's
    // how the "save to the ocean" bug happened — a null lat/lng was silently
    // replaced with 0 and the spot landed at (0, 0) in the Atlantic.
    // Null values now propagate to the backend, where the SpotCreateIn
    // pydantic validator will reject them with a 422 and a user-friendly
    // message. Upstream guards stop the submit before it ever gets here.
    latitude: draft.latitude,
    longitude: draft.longitude,
    city: draft.city,
    state: draft.state,
    privacy_mode: draft.privacy_mode,
    location_display_mode: draft.location_display_mode,
    shoot_types: draft.shoot_types,
    style_tags: draft.style_tags,
    best_time_of_day: draft.best_time_of_day,
    sunrise_rating: draft.sunrise_rating,
    sunset_rating: draft.sunset_rating,
    morning_golden_hour_rating: draft.morning_golden_hour_rating,
    evening_golden_hour_rating: draft.evening_golden_hour_rating,
    shade_rating: draft.shade_rating,
    variety_rating: draft.variety_rating,
    crowd_level: draft.crowd_level,
    safety_rating: draft.safety_rating,
    dog_friendly: draft.dog_friendly,
    kid_friendly: draft.kid_friendly,
    accessible: draft.accessible,
    indoor: draft.indoor,
    permit_required: draft.permit_required,
    fee_required: draft.fee_required,
    parking_notes: draft.parking_notes,
    lens_recommendations: draft.lens_recommendations,
    best_lens_range: draft.best_lens_range,
    parking_rating: draft.parking_rating,
    walk_rating: draft.walk_rating,
    composition_flex: draft.composition_flex,
    landmark_notes: draft.landmark || draft.landmarkNotes || '',
    notes: draft.notes,
    best_months: [],
    images: draft.images,
    // Location provenance (new)
    source_type: draft.locationSource,
    original_search_query: draft.originalSearchQuery,
    geocode_confidence: draft.geocodeConfidence,
    address_line1: draft.addressLine1,
    postal_code: draft.postalCode,
    // FIX(Commit 7.5): carry provenance so admins can audit / replay geocodes.
    original_address_input: draft.originalAddressInput,
    geocode_status: draft.geocodeStatus,
    save_as_draft: asDraft,
  });

  const runAiUploadAssist = async () => {
    setAiAssistError('');
    if (!draft.city && !draft.title && !draft.landmark && !draft.description) {
      setAiAssistError('Add at least a city, landmark, or rough title so Scout AI has something to work from.');
      return;
    }
    setAiAssistBusy(true);
    try {
      const resp = await api.post('/ai/assist/upload', {
        rough_title: draft.title || draft.landmark || undefined,
        city: draft.city || undefined,
        state: draft.state || undefined,
        lat: draft.latitude ?? undefined,
        lng: draft.longitude ?? undefined,
        shoot_types: draft.shoot_types?.length ? draft.shoot_types : undefined,
        notes: draft.description || undefined,
      });
      const patch: Partial<Draft> = {};
      if (resp.title && (!draft.title || draft.title.length < resp.title.length)) patch.title = resp.title;
      if (resp.summary && (!draft.description || draft.description.length < 40)) patch.description = resp.summary;
      if (resp.best_time_of_day && resp.best_time_of_day !== 'any') patch.best_time_of_day = resp.best_time_of_day;
      setDraft((d) => ({ ...d, ...patch }));
      setAiAssistTips(resp.tips || []);
    } catch (e) {
      setAiAssistError(formatApiError(e));
    } finally {
      setAiAssistBusy(false);
    }
  };


  const submit = async () => {
    if (!draft.title || !draft.city) {
      Alert.alert('Missing fields', 'Please add a title and city before publishing.');
      return;
    }
    if (draft.latitude == null || draft.longitude == null
        || (draft.latitude === 0 && draft.longitude === 0)) {
      // FIX(Commit 7.5 / 2026-04): hard location gate — no more "manual_entry"
      // bypass that let (0, 0) land in the DB. Copy matches the product spec.
      Alert.alert(
        'Location required',
        'Could not find this address. Please refine the address or drop a pin manually.'
      );
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/spots', buildPayload(false));
      Alert.alert('Spot submitted', draft.privacy_mode === 'public' ? 'Your public spot is in review.' : 'Saved!', [
        { text: 'OK', onPress: () => { setDraft(initialDraft); setStep(0); router.replace('/(tabs)'); } },
      ]);
    } catch (e) {
      Alert.alert('Could not submit', formatApiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const saveAsDraft = async () => {
    if (!draft.title.trim() || !draft.city.trim()) {
      Alert.alert('A few basics first', 'Please add at least a title and city before saving as draft.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/spots', buildPayload(true));
      Alert.alert('Draft saved', 'You can finish this spot later from your Profile.', [
        { text: 'OK', onPress: () => { setDraft(initialDraft); setStep(0); router.replace('/(tabs)/profile'); } },
      ]);
    } catch (e) {
      Alert.alert('Could not save draft', formatApiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={prev} testID="add-back">
            <ChevronLeft color={colors.text} size={24} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{STEPS[step]}</Text>
          <Text style={styles.headerStep}>{step + 1} / {STEPS.length}</Text>
        </View>

        <View style={styles.progress}>
          <View style={[styles.progressFill, { width: `${((step + 1) / STEPS.length) * 100}%` }]} />
        </View>

        {/* FIX(Commit 7.6 / 2026-04): keyboardDismissMode lets users swipe
            the form to dismiss the keyboard — iOS interactive tracking,
            Android drag-to-dismiss. Combined with keyboardShouldPersistTaps
            means taps on buttons/labels still work while the keyboard is up. */}
        <ScrollView
          contentContainerStyle={{ padding: space.xl, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        >
          {step === 0 && (
            <View style={{ gap: space.lg }}>
              <Text style={styles.heading}>Add photos</Text>
              <Text style={styles.sub}>Start with your shots. You'll assign a location next. Public spots need at least one photo — tap an image to make it the cover.</Text>
              <TouchableOpacity style={styles.uploadCard} onPress={pickImages} testID="add-pick-images">
                <ImageIcon size={28} color={colors.primary} />
                <Text style={styles.uploadText}>Choose photos</Text>
                <Text style={styles.uploadHint}>Up to 8 images</Text>
              </TouchableOpacity>
              <View style={styles.imgGrid}>
                {draft.images.map((img, i) => (
                  <TouchableOpacity key={i} style={styles.imgWrap} onPress={() => setCover(i)}>
                    <Image source={{ uri: img.image_url }} style={styles.imgThumb} />
                    {img.is_cover && <View style={styles.coverBadge}><Text style={styles.coverTxt}>COVER</Text></View>}
                    <TouchableOpacity style={styles.imgRemove} onPress={() => removeImg(i)}>
                      <X size={14} color="#fff" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {step === 1 && (
            <View style={{ gap: space.lg }}>
              <Text style={styles.heading}>Where was this shot?</Text>
              <Text style={styles.sub}>
                You don't need to be there. Search a place, drop a pin, or type the details by hand — perfect for past sessions.
              </Text>

              {/* Currently selected */}
              {draft.locationLabel ? (
                <View style={styles.selectedCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <MapPin size={16} color={colors.primary} />
                    <Text style={styles.selectedKicker}>
                      {draft.locationSource === 'gps' ? 'Current location' :
                       draft.locationSource === 'searched_place' ? 'Searched place' :
                       draft.locationSource === 'dropped_pin' ? 'Dropped pin' :
                       draft.locationSource === 'manual_entry' ? 'Manual entry' : 'Location'}
                    </Text>
                  </View>
                  <Text style={styles.selectedLabel} numberOfLines={2}>{draft.locationLabel}</Text>
                  {draft.latitude != null && draft.longitude != null && (
                    <Text style={styles.selectedCoords}>{draft.latitude.toFixed(5)}, {draft.longitude.toFixed(5)}</Text>
                  )}
                  <TouchableOpacity
                    onPress={() => setDraft({ ...draft, latitude: undefined, longitude: undefined, locationLabel: undefined, locationSource: undefined })}
                    style={styles.changeBtn}
                    testID="add-change-location"
                  >
                    <Text style={styles.changeBtnTxt}>Change</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {/* Recent locations — one-tap reuse for portfolio imports */}
                  {recent.length > 0 && (
                    <View style={styles.recentWrap}>
                      <Text style={styles.recentLabel}>Reuse a recent location</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
                        {recent.map((r, i) => (
                          <TouchableOpacity
                            key={i}
                            style={styles.recentChip}
                            onPress={() => applyRecentLocation(r)}
                            testID={`recent-loc-${i}`}
                          >
                            <MapPin size={12} color={colors.primary} />
                            <View>
                              <Text style={styles.recentChipName} numberOfLines={1}>{r.title || 'Untitled'}</Text>
                              <Text style={styles.recentChipSub} numberOfLines={1}>{r.city}, {r.state}</Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  {/* 4 methods — order matches user preference hierarchy:
                    1. Search (most common, autocomplete-powered)
                    2. Current location (live scouting)
                    3. Drop a pin (trails / offline)
                    4. Manual entry (portfolio imports, historical shoots) */}
                  <View style={{ gap: 10 }}>
                    <MethodCard
                      icon={<Search size={20} color={colors.primary} />}
                      title="Search a place"
                      body="Park, landmark, business, or address. Autocomplete-powered — the fastest way for most spots."
                      onPress={() => setSearchOpen(true)}
                      testID="method-search"
                      featured
                    />
                    <MethodCard
                      icon={<MapPin size={20} color={colors.primary} />}
                      title="Use current location"
                      body="Good for live scouting or if you're on-site right now."
                      onPress={applyGps}
                      testID="method-gps"
                    />
                    <MethodCard
                      icon={<MapIcon size={20} color={colors.primary} />}
                      title="Drop a pin on the map"
                      body="Perfect for trails, hidden fields, pull-offs, or custom spots without an address."
                      onPress={() => setMapOpen(true)}
                      testID="method-pin"
                    />
                    <MethodCard
                      icon={<Edit3 size={20} color={colors.primary} />}
                      title="Enter location manually"
                      body="No GPS needed. Great for adding historical portfolio shoots."
                      onPress={() => setManualOpen(true)}
                      testID="method-manual"
                    />
                  </View>
                </>
              )}

              {/* Duplicate check output */}
              {draft.locationLabel && (
                <>
                  {dupChecking && (
                    <Text style={{ color: colors.textTertiary, fontFamily: font.body, fontSize: 12 }}>
                      Checking for nearby spots…
                    </Text>
                  )}
                  {dupCandidates.length > 0 && (
                    <View style={styles.dupCard}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <AlertTriangle size={16} color={colors.warning} />
                        <Text style={styles.dupTitle}>
                          {dupCandidates.length === 1 ? 'Looks like this spot exists' : `${dupCandidates.length} nearby spots found`}
                        </Text>
                      </View>
                      <Text style={styles.dupBody}>
                        Tap one to view it — or continue if yours is truly different.
                      </Text>
                      <View style={{ gap: 8, marginTop: 6 }}>
                        {dupCandidates.map((c) => (
                          <TouchableOpacity
                            key={c.spot_id}
                            onPress={() => router.push(`/spot/${c.spot_id}`)}
                            style={styles.dupRow}
                            testID={`dup-${c.spot_id}`}
                          >
                            {c.images?.[0]?.image_url ? (
                              <Image source={{ uri: c.images[0].image_url }} style={styles.dupThumb} />
                            ) : <View style={[styles.dupThumb, { backgroundColor: colors.surface2 }]} />}
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 }} numberOfLines={1}>
                                {c.title}
                              </Text>
                              <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 11 }} numberOfLines={1}>
                                {c.city}, {c.state} · {c.distance_m}m away{c.title_similarity > 0.6 ? ' · likely match' : ''}
                              </Text>
                            </View>
                            <ChevronRight size={16} color={colors.textSecondary} />
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.quickSave}
                    onPress={() => { setDraft({ ...draft, privacy_mode: 'private', location_display_mode: 'exact' }); setStep(5); }}
                    testID="add-quick-save"
                  >
                    <Zap size={16} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.quickSaveTitle}>Quick save private</Text>
                      <Text style={styles.quickSaveSub}>Skip details — log this spot for yourself now, fill in notes later.</Text>
                    </View>
                    <ChevronRight size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {step === 2 && (
            <View style={{ gap: space.lg }}>
              <Text style={styles.heading}>Basic details</Text>
              <Text style={styles.sub}>Name it clearly. City, state, and any park or landmark help other photographers find it.</Text>

              {/* Scout AI helper — only on the Details step where writing help matters most. */}
              <ScoutAICard placement="upload" variant="row" />

              <Input label="Spot name" value={draft.title} onChangeText={(t) => setDraft({ ...draft, title: t })} placeholder="e.g. Bluebonnet Fields at Muleshoe Bend" testID="add-title" />
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <View style={{ flex: 2 }}>
                  <Input label="City" value={draft.city} onChangeText={(t) => setDraft({ ...draft, city: t })} placeholder="Austin — not county" testID="add-city" />
                  <Text style={styles.helper}>Use the actual city/town name, not a county or region.</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="State" value={draft.state} onChangeText={(t) => setDraft({ ...draft, state: t.toUpperCase().slice(0, 2) })} placeholder="TX" testID="add-state" />
                </View>
              </View>
              <Input
                label="Park / landmark / area (optional)"
                value={draft.landmark}
                onChangeText={(t) => setDraft({ ...draft, landmark: t })}
                placeholder="e.g. McKinney Falls State Park · Zilker"
                testID="add-landmark"
              />
              <Text style={styles.helper}>If the spot sits inside a park, neighborhood, or known location, add that here.</Text>

              {/* Scout AI direct autofill — generates title+summary+tips from the current draft. */}
              <TouchableOpacity
                style={styles.aiAssistBtn}
                onPress={runAiUploadAssist}
                disabled={aiAssistBusy}
                testID="add-ai-assist"
                activeOpacity={0.85}
              >
                {aiAssistBusy
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Sparkles size={14} color={colors.primary} />}
                <Text style={styles.aiAssistTxt}>
                  {aiAssistBusy ? 'Scout AI is drafting…' : 'Draft this listing with Scout AI'}
                </Text>
              </TouchableOpacity>
              {aiAssistError ? <Text style={styles.aiAssistErr}>{aiAssistError}</Text> : null}

              <Input
                label="Description"
                value={draft.description}
                onChangeText={(t) => setDraft({ ...draft, description: t })}
                multiline
                placeholder="What makes this spot great? Parking, access, best angles, background variety, crowd timing, permit notes, pro tips…"
                style={{ minHeight: 120, textAlignVertical: 'top' }}
                testID="add-description"
              />
              <Text style={styles.helper}>Pros cover: parking hack, best arrival time, composition spots, seasonal gotchas, permits.</Text>

              {aiAssistTips.length > 0 && (
                <View style={styles.aiTipsBox}>
                  <Text style={styles.aiTipsLabel}>Scout AI photography tips</Text>
                  {aiAssistTips.map((t, i) => (
                    <Text key={i} style={styles.aiTipsItem}>• {t}</Text>
                  ))}
                </View>
              )}

              <Text style={styles.subSectionLabel}>Shoot types</Text>
              <View style={styles.chipRow}>
                {SHOOT_TYPES.map((t) => (
                  <Chip
                    key={t}
                    label={t}
                    active={draft.shoot_types.includes(t)}
                    onPress={() => setDraft({ ...draft, shoot_types: toggleInArr(draft.shoot_types, t) })}
                    testID={`add-shoot-${t}`}
                  />
                ))}
              </View>
              <Text style={styles.subSectionLabel}>Style tags (e.g. Sunset, Urban, Wildflowers)</Text>
              <Input
                placeholder="Comma separated tags"
                value={tagsText}
                onChangeText={setTagsText}
                onBlur={() => {
                  const tags = tagsText.split(',').map((x) => x.trim()).filter(Boolean);
                  const seen = new Set<string>();
                  const unique: string[] = [];
                  for (const t of tags) {
                    const k = t.toLowerCase();
                    if (!seen.has(k)) {
                      seen.add(k);
                      unique.push(t);
                    }
                  }
                  setDraft({ ...draft, style_tags: unique });
                  setTagsText(unique.join(', '));
                }}
                autoCapitalize="none"
                autoCorrect={false}
                testID="add-tags"
              />
              {draft.style_tags.length > 0 && (
                <View style={[styles.chipRow, { marginTop: space.sm }]}>
                  {draft.style_tags.map((tg) => (
                    <View key={tg} style={styles.tagPill}>
                      <Text style={styles.tagPillText}>#{tg}</Text>
                      <TouchableOpacity
                        onPress={() => {
                          const nextTags = draft.style_tags.filter((x) => x !== tg);
                          setDraft({ ...draft, style_tags: nextTags });
                          setTagsText(nextTags.join(', '));
                        }}
                        style={styles.tagPillClose}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <X size={12} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {step === 3 && (
            <View style={{ gap: space.lg }}>
              <Text style={styles.heading}>Ratings & Notes</Text>
              <Text style={styles.sub}>Rate real conditions, then jot anything future-you would want to know.</Text>

              {/* ---- Best time of day ---- */}
              <Text style={styles.subSectionLabel}>Best time of day</Text>
              <View style={styles.chipRow}>
                {BEST_TIMES.map((t) => (
                  <Chip
                    key={t.key}
                    label={t.label}
                    active={draft.best_time_of_day === t.key}
                    onPress={() => setDraft({ ...draft, best_time_of_day: t.key })}
                  />
                ))}
              </View>

              {/* ---- Group 1: Light ---- */}
              <View style={styles.groupCard}>
                <View style={styles.groupHead}>
                  <Sun size={14} color={colors.primary} />
                  <Text style={styles.groupLabel}>Light</Text>
                </View>
                <Rating label="Sunrise quality" value={draft.sunrise_rating} onChange={(v) => setDraft({ ...draft, sunrise_rating: v })} showHint />
                <Rating label="Sunset quality" value={draft.sunset_rating} onChange={(v) => setDraft({ ...draft, sunset_rating: v })} />
                <Rating label="Morning golden hour" value={draft.morning_golden_hour_rating} onChange={(v) => setDraft({ ...draft, morning_golden_hour_rating: v })} />
                <Rating label="Evening golden hour" value={draft.evening_golden_hour_rating} onChange={(v) => setDraft({ ...draft, evening_golden_hour_rating: v })} />
              </View>

              {/* ---- Group 2: Logistics ---- */}
              <View style={styles.groupCard}>
                <View style={styles.groupHead}>
                  <MapPin size={14} color={colors.primary} />
                  <Text style={styles.groupLabel}>Logistics</Text>
                </View>
                <Rating label="Shade availability" value={draft.shade_rating} onChange={(v) => setDraft({ ...draft, shade_rating: v })} />
                <Rating label="Crowd level (5 = very crowded)" value={draft.crowd_level} onChange={(v) => setDraft({ ...draft, crowd_level: v })} />
                <Rating label="Parking ease (5 = easy)" value={draft.parking_rating} onChange={(v) => setDraft({ ...draft, parking_rating: v })} />
                <Rating label="Walking distance (1 = trailhead, 5 = long hike)" value={draft.walk_rating} onChange={(v) => setDraft({ ...draft, walk_rating: v })} />
              </View>

              {/* ---- Group 3: Creative ---- */}
              <View style={styles.groupCard}>
                <View style={styles.groupHead}>
                  <Edit3 size={14} color={colors.primary} />
                  <Text style={styles.groupLabel}>Creative</Text>
                </View>
                <Rating label="Background variety" value={draft.variety_rating} onChange={(v) => setDraft({ ...draft, variety_rating: v })} />
                <Rating label="Composition flexibility" value={draft.composition_flex} onChange={(v) => setDraft({ ...draft, composition_flex: v })} />
                <Input
                  label="Best lens range"
                  value={draft.best_lens_range}
                  onChangeText={(t) => setDraft({ ...draft, best_lens_range: t })}
                  placeholder="e.g. 35-85mm"
                  testID="add-lens-range"
                />
              </View>

              {/* ---- Binary flags ---- */}
              <Text style={styles.subSectionLabel}>Access & rules</Text>
              <View style={{ gap: space.md }}>
                <Toggle label="Dog friendly" value={draft.dog_friendly} onChange={(v) => setDraft({ ...draft, dog_friendly: v })} />
                <Toggle label="Kid friendly" value={draft.kid_friendly} onChange={(v) => setDraft({ ...draft, kid_friendly: v })} />
                <Toggle label="Wheelchair accessible" value={draft.accessible} onChange={(v) => setDraft({ ...draft, accessible: v })} />
                <Toggle label="Indoor option" value={draft.indoor} onChange={(v) => setDraft({ ...draft, indoor: v })} />
                <Toggle label="Permit required" value={draft.permit_required} onChange={(v) => setDraft({ ...draft, permit_required: v })} />
                <Toggle label="Fee required" value={draft.fee_required} onChange={(v) => setDraft({ ...draft, fee_required: v })} />
              </View>

              <Input
                label="Notes (for future-you)"
                value={draft.notes}
                onChangeText={(t) => setDraft({ ...draft, notes: t.slice(0, 2000) })}
                placeholder="Parking, gate codes, permit info, gotchas — anything future-you would want to know."
                multiline
                numberOfLines={4}
                maxLength={2000}
                textAlignVertical="top"
                style={{ minHeight: 110, paddingTop: 12 }}
                testID="add-notes"
              />
              <Text style={{ color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: -8, textAlign: 'right' }}>
                {(draft.notes || '').length}/2000
              </Text>
            </View>
          )}

          {step === 4 && (
            <View style={{ gap: space.lg }}>
              {/* FIX(2026-04): [1.1] removed duplicate 'Privacy & sharing' heading
                  (top bar already shows 'Privacy'). Subtitle expanded for context. */}
              <Text style={styles.sub}>
                Choose who can see this spot. Public spots go into community review — private and followers-only spots post instantly.
              </Text>
              {PRIVACY_MODES.map((p) => {
                const isPremiumOption = p.key === 'premium';
                const canPickPremium = user?.plan === 'elite';
                const locked = isPremiumOption && !canPickPremium;
                const active = draft.privacy_mode === p.key;
                return (
                  <TouchableOpacity
                    key={p.key}
                    onPress={() => {
                      if (locked) {
                        Alert.alert(
                          'Elite plan required',
                          'Premium spots are only available to Elite creators. Upgrade to list paid or subscription-only spots.',
                          [
                            { text: 'Not now', style: 'cancel' },
                            { text: 'See plans', onPress: () => router.push('/paywall') },
                          ]
                        );
                        return;
                      }
                      setDraft({ ...draft, privacy_mode: p.key });
                    }}
                    style={[styles.privCard, active && styles.privCardActive, locked && { opacity: 0.6 }]}
                    testID={`privacy-${p.key}`}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ color: colors.text, fontFamily: font.bodySemibold, fontSize: 15 }}>{p.label}</Text>
                        {isPremiumOption && (
                          <View style={styles.elitePill}>
                            <Text style={styles.elitePillTxt}>ELITE</Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 4 }}>{p.help}</Text>
                    </View>
                    {active && <Check size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}

              {draft.privacy_mode === 'premium' && user?.plan !== 'elite' && (
                <View style={styles.upgradeInline}>
                  <Crown size={18} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.upgradeInlineTitle}>Unlock Premium spots</Text>
                    <Text style={styles.upgradeInlineBody}>Sell access or require subscribers. Available on the Elite plan.</Text>
                  </View>
                  <TouchableOpacity style={styles.upgradeBtn} onPress={() => router.push('/paywall')}>
                    <Text style={styles.upgradeBtnTxt}>Upgrade</Text>
                  </TouchableOpacity>
                </View>
              )}

              <Text style={styles.subSectionLabel}>Coordinate display</Text>
              <View style={styles.chipRow}>
                {[
                  { k: 'exact', l: 'Exact' },
                  { k: 'approximate', l: 'Approximate (~1km)' },
                  { k: 'hidden', l: 'Hidden' },
                ].map((m) => (
                  <Chip
                    key={m.k}
                    label={m.l}
                    active={draft.location_display_mode === m.k}
                    onPress={() => setDraft({ ...draft, location_display_mode: m.k })}
                  />
                ))}
              </View>
              <Text style={styles.helper}>
                Hidden & Approximate modes still show the city and state so other photographers
                can plan trips — only the exact pin is redacted. Use Approximate for fragile
                environments (bluebonnet fields, nesting grounds, fragile overlooks).
              </Text>
            </View>
          )}

          {step === 5 && (() => {
            const photosOk = draft.images.length >= 1 || draft.privacy_mode === 'private';
            const titleOk = draft.title.trim().length >= 3;
            const locationOk = draft.latitude != null && draft.longitude != null;
            const cityOk = draft.city.trim().length >= 2;
            const shootTypesOk = draft.shoot_types.length > 0;
            const descOk = draft.description.trim().length >= 20;
            const lightRated = draft.sunrise_rating + draft.sunset_rating + draft.morning_golden_hour_rating + draft.evening_golden_hour_rating > 4;
            const logisticsRated = draft.parking_rating > 0 && draft.walk_rating > 0;
            const cover = draft.images.find((i) => i.is_cover) || draft.images[0];
            const allOk = photosOk && titleOk && locationOk && cityOk && shootTypesOk;
            return (
              <View style={{ gap: space.lg }}>
                <Text style={styles.heading}>Review & submit</Text>
                <Text style={styles.sub}>One last look before we {draft.privacy_mode === 'private' ? 'publish privately' : 'send to review'}.</Text>

                {/* Preview card */}
                <View style={styles.reviewCard}>
                  {cover?.image_url
                    ? <Image source={{ uri: cover.image_url }} style={styles.reviewCover} />
                    : <View style={[styles.reviewCover, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }]}><ImageIcon size={28} color={colors.textTertiary} /></View>}
                  <View style={{ padding: space.md }}>
                    <Text style={styles.reviewCardTitle}>{draft.title || 'Untitled spot'}</Text>
                    <Text style={styles.reviewCardCity}>
                      {[draft.city, draft.state].filter(Boolean).join(', ') || '—'}
                      {draft.landmark ? ` · ${draft.landmark}` : ''}
                    </Text>
                    {draft.shoot_types.length > 0 && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                        {draft.shoot_types.map((st) => (
                          <View key={st} style={styles.chipMini}>
                            <Text style={styles.chipMiniTxt}>{st}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                </View>

                {/* Validation checklist */}
                <View style={styles.checklist}>
                  <Text style={styles.subSectionLabel}>Complete these to publish:</Text>
                  <CheckRow ok={photosOk} label={draft.privacy_mode === 'private' ? 'Photos (optional for private)' : `Photos attached (${draft.images.length})`} />
                  <CheckRow ok={titleOk} label="Spot name (3+ characters)" />
                  <CheckRow ok={cityOk} label="City filled in (not county)" />
                  <CheckRow ok={locationOk} label="Map coordinates" />
                  <CheckRow ok={shootTypesOk} label={`Shoot types (${draft.shoot_types.length})`} />
                  <CheckRow ok={descOk} label="Description (20+ chars)" soft />
                  <CheckRow ok={lightRated} label="Light ratings added" soft />
                  <CheckRow ok={logisticsRated} label="Parking & walking rated" soft />
                </View>

                {/* What happens next */}
                <View style={styles.nextBox}>
                  <Text style={styles.nextTitle}>What happens next</Text>
                  {draft.privacy_mode === 'private' ? (
                    <Text style={styles.nextBody}>
                      <Text style={{ color: colors.primary, fontFamily: font.bodyBold }}>Instant publish.</Text>{' '}
                      Private spots appear in your Saved tab right away. Only you can see the exact location.
                    </Text>
                  ) : draft.privacy_mode === 'followers' ? (
                    <Text style={styles.nextBody}>
                      Goes live to your followers after a quick review (usually under 2 hours). You'll get a push when approved.
                    </Text>
                  ) : (
                    <Text style={styles.nextBody}>
                      Goes through community review — typically approved within 24h. We check for accuracy, safety, and duplicate spots. You'll get a push when approved.
                    </Text>
                  )}
                  <Text style={styles.nextBody}>You can edit anything later from the spot detail page.</Text>
                </View>
                {/* FIX(Commit 6a): removed the red "Fix required items" warning
                    box — the disabled Publish button already signals blockers
                    via the checklist above. */}
              </View>
            );
          })()}
        </ScrollView>

        <View style={styles.footer}>
          {step < STEPS.length - 1 ? (
            <Button
              title="Continue"
              onPress={next}
              disabled={!canProceed()}
              icon={<ChevronRight size={18} color={colors.textInverse} />}
              testID="add-next"
            />
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                onPress={saveAsDraft}
                disabled={submitting}
                style={styles.draftBtn}
                testID="add-save-draft"
              >
                <FileText size={16} color={colors.text} />
                <Text style={styles.draftBtnTxt}>Save draft</Text>
              </TouchableOpacity>
              <View style={{ flex: 1.4 }}>
                {/* FIX(Commit 6a): Publish gated on all REQUIRED items passing
                    (photos/title/city/coords/shoot_types). Soft items remain
                    "recommended" and don't block. */}
                <Button title="Publish spot" onPress={submit} loading={submitting} disabled={!canPublishFromReview} testID="add-submit" />
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      <LocationSearchSheet
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPick={applySearchedPlace}
        onManualEntry={() => setManualOpen(true)}
      />
      <MapPickerSheet
        visible={mapOpen}
        onClose={() => setMapOpen(false)}
        onConfirm={applyDroppedPin}
        initial={draft.latitude != null && draft.longitude != null ? { latitude: draft.latitude, longitude: draft.longitude } : null}
      />
      <ManualLocationSheet
        visible={manualOpen}
        onClose={() => setManualOpen(false)}
        onConfirm={applyManualEntry}
        initial={{
          title: draft.title,
          city: draft.city,
          state: draft.state,
          address_line1: draft.addressLine1,
          postal_code: draft.postalCode,
          landmark_notes: draft.landmarkNotes,
          latitude: draft.latitude,
          longitude: draft.longitude,
        }}
      />
    </SafeAreaView>
  );
}

function CheckRow({ ok, label, soft }: { ok: boolean; label: string; soft?: boolean }) {
  // FIX(Commit 6a / 2026-04): softened visuals. Incomplete items now render a
  // neutral grey ring (not a red X), so the checklist reads as "steps to complete"
  // not "errors you made". Required items stay bold when incomplete so users can
  // see at a glance what's actually blocking Publish; soft (recommended) items
  // stay regular weight with the "(recommended)" suffix.
  const iconColor = ok ? colors.success : colors.textTertiary;
  const textColor = ok ? colors.text : (soft ? colors.textTertiary : colors.textSecondary);
  const required = !soft;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
      {ok
        ? <Check size={14} color={iconColor} />
        : <Circle size={14} color={iconColor} />}
      <Text
        style={{
          color: textColor,
          fontFamily: (required && !ok) ? font.bodyBold : font.bodyMedium,
          fontSize: 13,
        }}
      >
        {label}{!ok && soft ? '  (recommended)' : ''}
      </Text>
    </View>
  );
}


function MethodCard({
  icon, title, body, onPress, testID, featured,
}: {
  icon: React.ReactNode; title: string; body: string; onPress: () => void; testID?: string; featured?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.methodCard, featured && styles.methodCardFeatured]}
      onPress={onPress}
      testID={testID}
    >
      <View style={[styles.methodIcon, featured && { backgroundColor: 'rgba(245,166,35,0.18)' }]}>{icon}</View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={styles.methodTitle}>{title}</Text>
          {featured && (
            <View style={styles.recommendedBadge}><Text style={styles.recommendedBadgeTxt}>RECOMMENDED</Text></View>
          )}
        </View>
        <Text style={styles.methodBody}>{body}</Text>
      </View>
      <ChevronRight size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  );
}

function Rating({ label, value, onChange, showHint }: { label: string; value: number; onChange: (v: number) => void; showHint?: boolean }) {
  // FIX(2026-04): [1.2] single-select pills — only the chosen value is amber-filled.
  return (
    <View>
      <Text style={styles.subSectionLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[1, 2, 3, 4, 5].map((v) => {
          const selected = value === v;
          return (
            <TouchableOpacity
              key={v}
              onPress={() => onChange(selected ? 0 : v)}
              style={[styles.ratingDot, selected && { backgroundColor: colors.primary, borderColor: colors.primary }]}
            >
              <Text style={{ color: selected ? colors.textInverse : colors.textSecondary, fontFamily: font.bodyBold }}>{v}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {showHint && (
        <Text style={{ color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 4 }}>
          Tap to rate — tap again to clear.
        </Text>
      )}
    </View>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ color: colors.text, fontFamily: font.bodyMedium, fontSize: 15 }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: colors.surface3 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  aiAssistBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: -4, marginBottom: space.xs,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: 'rgba(32,130,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(32,130,255,0.35)',
    borderRadius: radii.md, alignSelf: 'flex-start',
  },
  aiAssistTxt: { color: colors.primary, fontFamily: font.bodySemibold, fontSize: 12.5 },
  aiAssistErr: { color: colors.secondary, fontFamily: font.body, fontSize: 12, marginTop: 4, marginBottom: space.xs },
  aiTipsBox: {
    marginTop: 4, marginBottom: space.md,
    padding: 10, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  aiTipsLabel: {
    color: colors.primary, fontFamily: font.bodyBold, fontSize: 11,
    letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4,
  },
  aiTipsItem: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12.5, lineHeight: 18 },
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: space.xl, paddingVertical: space.md,
  },
  headerTitle: { color: colors.text, fontFamily: font.display, fontSize: 22 },
  headerStep: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  progress: {
    height: 3, backgroundColor: colors.surface2, marginHorizontal: space.xl, borderRadius: 2,
  },
  progressFill: { height: 3, backgroundColor: colors.primary, borderRadius: 2 },
  heading: { color: colors.text, fontFamily: font.display, fontSize: 28, letterSpacing: -0.5 },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, lineHeight: 20 },
  subSectionLabel: {
    color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginTop: 6,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagPillText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  tagPillClose: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  coordsCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: space.md, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.md,
  },
  dupCard: {
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderColor: colors.warning, borderWidth: 1,
    padding: space.md, borderRadius: radii.md,
    gap: 4,
  },
  dupTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  dupBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17 },
  dupRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 8, borderRadius: radii.sm,
    backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1,
  },
  dupThumb: { width: 44, height: 44, borderRadius: radii.sm },
  methodCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: space.md, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
  },
  methodIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  methodTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 15 },
  methodBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2, lineHeight: 16 },
  methodCardFeatured: { borderColor: colors.primary, backgroundColor: 'rgba(245,166,35,0.04)' },
  recommendedBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.primary },
  recommendedBadgeTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.4 },
  helper: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, lineHeight: 15, marginTop: -4, marginBottom: 4 },
  groupCard: { backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, padding: space.md, gap: 10 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  groupLabel: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13, letterSpacing: 0.3, textTransform: 'uppercase' },
  reviewCard: { backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, overflow: 'hidden' },
  reviewCover: { width: '100%', aspectRatio: 16 / 9 },
  reviewCardTitle: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.3 },
  reviewCardCity: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, marginTop: 4 },
  chipMini: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill, backgroundColor: colors.surface2 },
  chipMiniTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  checklist: { backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, padding: space.md, gap: 2 },
  nextBox: { backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, padding: space.md, gap: 8 },
  nextTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase' },
  nextBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 20 },
  selectedCard: {
    backgroundColor: 'rgba(245,166,35,0.06)', borderColor: colors.primary, borderWidth: 1,
    padding: space.md, borderRadius: radii.md, gap: 4, position: 'relative',
  },
  selectedKicker: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase' },
  selectedLabel: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14, lineHeight: 19, marginTop: 4 },
  selectedCoords: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  changeBtn: { position: 'absolute', top: space.md, right: space.md, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  changeBtnTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  recentWrap: { gap: 6 },
  recentLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase' },
  recentChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, maxWidth: 180,
  },
  recentChipName: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 12 },
  recentChipSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 10 },
  draftBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  draftBtnTxt: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  quickSave: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: space.md, borderWidth: 1, borderColor: colors.primary,
    backgroundColor: 'rgba(245,166,35,0.08)', borderRadius: radii.md,
  },
  quickSaveTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  quickSaveSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2, lineHeight: 16 },
  uploadCard: {
    alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: space.xxxl, paddingHorizontal: space.xl,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
    borderRadius: radii.lg, backgroundColor: colors.surface1,
  },
  uploadText: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 15, marginTop: 6 },
  uploadHint: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },
  imgGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  imgWrap: { width: '31%', aspectRatio: 1, position: 'relative' },
  imgThumb: { width: '100%', height: '100%', borderRadius: radii.md },
  coverBadge: {
    position: 'absolute', bottom: 6, left: 6,
    backgroundColor: colors.primary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.sm,
  },
  coverTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.4 },
  imgRemove: {
    position: 'absolute', top: 6, right: 6,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center',
  },
  privCard: {
    flexDirection: 'row', alignItems: 'center',
    padding: space.lg, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    gap: space.md,
  },
  privCardActive: { borderColor: colors.primary, backgroundColor: 'rgba(245,166,35,0.08)' },
  elitePill: {
    backgroundColor: colors.primary, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radii.sm,
  },
  elitePillTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.5 },
  upgradeInline: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: space.md, borderRadius: radii.md,
    borderColor: colors.primary, borderWidth: 1, backgroundColor: 'rgba(245,166,35,0.06)',
  },
  upgradeInlineTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  upgradeInlineBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
  upgradeBtn: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  upgradeBtnTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 12 },
  ratingDot: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  reviewRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle,
  },
  reviewK: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13 },
  reviewV: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14, maxWidth: '60%', textAlign: 'right' },
  footer: {
    padding: space.xl, borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
});
