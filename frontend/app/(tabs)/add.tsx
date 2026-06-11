import React, { useEffect, useRef, useState } from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { ChevronLeft, ChevronRight, MapPin, Image as ImageIcon, Plus, Check, X, Zap, Crown, AlertTriangle, Search, Map as MapIcon, Edit3, FileText, Sun, Eye, EyeOff, Sparkles, Circle, Camera, Layers } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { uploadImageAsset, uploadImageAssetWithProgress } from '../../src/utils/upload-image';
import { resolveImageUrl } from '../../src/utils/image-url';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii, SHOOT_TYPES, BEST_TIMES, PRIVACY_MODES } from '../../src/theme';
// Phase 2 — Add Location Optimization (Jun 2026)
import { computeDataQuality } from '../../src/utils/data-quality';
import {
  accuracyTier as gpsAccuracyTier,
  accuracyLabel as gpsAccuracyLabel,
  accuracyColorKey as gpsAccuracyColorKey,
  formatAccuracy as gpsFormatAccuracy,
  shouldShowImperial as gpsShouldShowImperial,
} from '../../src/utils/gps-accuracy';
import { effectiveTier } from '../../src/utils/entitlements';
import { LandAccessSelector } from '../../src/components/LandAccessSelector';
import { Button } from '../../src/components/Button';
import LocationSearchSheet, { PlaceResult } from '../../src/components/LocationSearchSheet';
import MapPickerSheet from '../../src/components/MapPickerSheet';
import ManualLocationSheet, { ManualLocation } from '../../src/components/ManualLocationSheet';
import MapPreviewCard from '../../src/components/MapPreviewCard';
import { Input, Chip } from '../../src/components/ui';
import ScoutAICard from '../../src/components/ScoutAICard';
import { useKeyboardHeight } from '../../src/hooks/useKeyboardHeight';
import ParkPickerSheet, { ParkSummary } from '../../src/components/ParkPickerSheet';
import PostSaveSpotSheet from '../../src/components/PostSaveSpotSheet';
import { saveDraft as saveLocalDraft } from '../../src/utils/park-drafts';
import { useDraftSync } from '../../src/hooks/useDraftSync';
import {
  primeAndRequestCamera,
  primeAndRequestLocation,
  primeAndRequestMediaLibrary,
} from '../../src/lib/permissions';

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
  // FIX(2026-05): on-site camera-capture provenance for "On-Site Verified" badge.
  sourceType?: 'camera_capture' | 'gallery_upload' | 'manual_entry';
  capturedAt?: string;          // ISO datetime when the shutter fired
  gpsAccuracy?: number;         // meters
  gpsHeading?: number;          // degrees (if available)
  gpsAltitude?: number;         // meters (if available)
  landmark: string;  // Step 3 user-entered "Park / landmark / area" (surfaced separately)
  images: { image_url: string; caption?: string; is_cover: boolean }[];
  title: string;
  city: string;
  state: string;
  description: string;
  shoot_types: string[];
  style_tags: string[];
  best_time_of_day?: string;
  best_light_notes?: string;
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
  // FIX(2026-04 / Item #1): Land access disclosure
  land_access?: 'public' | 'private' | 'unsure';
  access_notes?: string;
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
  land_access: undefined,
  access_notes: '',
};

import ScreenErrorBoundary from '../../src/components/ScreenErrorBoundary';

export default function AddSpot() {
  return (
    <ScreenErrorBoundary label="Add spot">
      <AddSpotImpl />
    </ScreenErrorBoundary>
  );
}

function AddSpotImpl() {
  const { user } = useAuth();
  const kbHeight = useKeyboardHeight();
  // Phase 1 Fast Add (Jun 2026):
  //   step = -1 → Fast Mode (default) — one-screen quick submit
  //   step =  0..5 → existing detailed multi-step flow
  // Field-bound photographers can submit a useful spot in <60s on Fast
  // Mode. Tapping "Add More Details" promotes them into the existing
  // step=0 flow without losing any state already collected.
  const [step, setStep] = useState(-1);
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

  // ─── Park-Based Multi-Spot Workflow (Phase 2) ────────────────────
  // Tracks whether this spot belongs to a parent park and the active
  // 24h session so users can keep adding child spots through app
  // restarts.
  const [locationType, setLocationType] = useState<'standalone' | 'park_child'>('standalone');
  const [selectedPark, setSelectedPark] = useState<ParkSummary | null>(null);
  const [parkPickerOpen, setParkPickerOpen] = useState(false);
  const [activeSession, setActiveSession] = useState<{
    active_park_id: string;
    active_park_name: string;
    last_added_spot_id?: string | null;
  } | null>(null);
  const [sessionPark, setSessionPark] = useState<ParkSummary | null>(null);
  const [postSaveOpen, setPostSaveOpen] = useState(false);
  const [lastSubmittedSpot, setLastSubmittedSpot] = useState<{
    spot_id: string;
    park_id?: string | null;
    park_name?: string | null;
    // Phase 2 — used by the upgraded PostSaveSpotSheet preview card.
    title?: string;
    city?: string;
    state?: string;
    cover_url?: string | null;
    visibility_status?: string | null;
  } | null>(null);

  // ────────────────────────────────────────────────────────────────
  // Phase 1 Fast Add — local-only AsyncStorage autosave (Jun 2026)
  // ────────────────────────────────────────────────────────────────
  // Persist the in-progress draft to AsyncStorage so a photographer
  // in the field who switches apps, loses signal, or has the OS kill
  // the process doesn't lose their work. Restore on mount; clear on
  // successful submission OR explicit "Discard draft" tap.
  //
  // We DO NOT sync drafts to the backend (per Phase 1 scope) — the
  // existing `useDraftSync` queues only at the network-failure point.
  const DRAFT_AUTOSAVE_KEY = 'addspot.autosave.v1';
  const draftRestoredRef = useRef(false);
  const [draftHydrated, setDraftHydrated] = useState(false);

  // Restore on mount (once).
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DRAFT_AUTOSAVE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          // Sanity check — minimum shape match so old/incompatible drafts
          // don't crash the form. We accept partial drafts and merge over
          // the initial state.
          if (saved && typeof saved === 'object' && Array.isArray(saved.images)) {
            setDraft({ ...initialDraft, ...saved });
            draftRestoredRef.current = true;
          }
        }
      } catch { /* corrupt blob — fall back to initial */ }
      setDraftHydrated(true);
    })();
  }, []);

  // Debounced autosave on every change. Skip until hydration so we
  // don't immediately overwrite the restored draft with the initial.
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!draftHydrated) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      AsyncStorage.setItem(DRAFT_AUTOSAVE_KEY, JSON.stringify(draft)).catch(() => {});
    }, 600);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [draft, draftHydrated]);

  const clearAutosavedDraft = async () => {
    try { await AsyncStorage.removeItem(DRAFT_AUTOSAVE_KEY); } catch {}
  };
  const discardDraft = () => {
    Alert.alert(
      'Discard draft?',
      "You'll lose this in-progress spot. This cannot be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            await clearAutosavedDraft();
            setDraft(initialDraft);
            setStep(-1);
            draftRestoredRef.current = false;
          },
        },
      ],
    );
  };

  // ────────────────────────────────────────────────────────────────
  // Phase 2 — Add Location Optimization (Jun 2026)
  // Image-upload progress, retry, and double-tap guards.
  // ────────────────────────────────────────────────────────────────
  // `uploadProgress` is a 0..1 fraction broadcast to the Fast Add
  // progress banner so the user sees something is happening (was a
  // dead spinner before). `uploadPhase` tracks coarse states the
  // submit() flow walks through.
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadingCount, setUploadingCount] = useState<number>(0);
  // 'idle' | 'compressing' | 'uploading' | 'saving' | 'retrying'
  type SubmitPhase = 'idle' | 'compressing' | 'uploading' | 'saving' | 'retrying';
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>('idle');
  // Refs (non-render) so rapid taps can't double-fire the same flow.
  const pickInFlightRef = useRef(false);
  const cameraInFlightRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const gpsRefreshInFlightRef = useRef(false);

  /**
   * Upload a single processed image with up to N retry attempts on
   * transient network/server failures. Returns the absolute hosted
   * URL on success or null on hard failure (4xx client errors). The
   * caller decides how to surface the failure.
   */
  const uploadWithRetry = async (
    asset: { uri: string; mimeType: string; fileName: string },
    onProgress?: (fraction: number) => void,
    maxAttempts = 3,
  ): Promise<string | null> => {
    let lastErr: any = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const r = await uploadImageAssetWithProgress(asset, {
          onProgress,
        });
        return r.image_url;
      } catch (e: any) {
        lastErr = e;
        const name = e?.name || '';
        // Don't retry 4xx client errors — they will keep failing.
        if (
          name === 'AuthError' ||
          name === 'PayloadTooLargeError' ||
          name === 'UnsupportedMediaError' ||
          name === 'ClientError'
        ) {
          break;
        }
        if (attempt < maxAttempts) {
          // Exponential backoff with jitter: 600ms, 1400ms.
          const backoff = 400 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
          await new Promise((res) => setTimeout(res, backoff));
        }
      }
    }
    console.warn('[add] upload failed after retries', lastErr?.message);
    return null;
  };

  /**
   * Re-fetch the user's GPS pin with best-for-navigation accuracy.
   * Surface a friendly error if permission denied. Idempotent — a
   * second tap while one is in flight is ignored.
   */
  const refreshGpsPin = async () => {
    if (gpsRefreshInFlightRef.current) return;
    gpsRefreshInFlightRef.current = true;
    try {
      const granted = await primeAndRequestLocation();
      if (!granted) {
        // User declined — they can still tap "Pick on map" instead.
        // Don't dead-end: just exit silently. The prime sheet (or
        // settings flow) already explained why we asked.
        return;
      }
      const loc = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 7000)),
      ]);
      if (!loc) {
        Alert.alert(
          'Could not get a fix',
          "Your phone couldn't lock onto satellites. Step outside or pick the spot on the map.",
        );
        return;
      }
      let city: string | undefined;
      let state: string | undefined;
      try {
        const places = await Location.reverseGeocodeAsync({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
        if (places && places[0]) {
          city = places[0].city || places[0].subregion || undefined;
          state = places[0].region || undefined;
        }
      } catch {}
      setDraft((prev) => ({
        ...prev,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        locationLabel: [city, state].filter(Boolean).join(', ')
          || `${loc.coords.latitude.toFixed(4)}, ${loc.coords.longitude.toFixed(4)}`,
        locationSource: 'gps',
        gpsAccuracy: loc.coords.accuracy ?? undefined,
        gpsHeading: loc.coords.heading ?? undefined,
        gpsAltitude: loc.coords.altitude ?? undefined,
        city: city || prev.city,
        state: state || prev.state,
        geocodeStatus: city ? 'success' : 'skipped',
      }));
    } catch (e) {
      Alert.alert('Could not refresh pin', String(e));
    } finally {
      gpsRefreshInFlightRef.current = false;
    }
  };

  // Load active park session on mount so we can offer the
  // "Continue adding spots to <park>?" pickup banner.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get('/me/park-session');
        if (!cancelled && r?.session) {
          setActiveSession(r.session);
          if (r.park) setSessionPark(r.park as ParkSummary);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  // Phase 6 — Offline draft queue. The hook auto-syncs on mount, app
  // foreground, and NetInfo reachability flips. `count` drives the
  // "N pending" pill; `syncNow` is wired to the Retry button.
  const drafts = useDraftSync();

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
      const granted = await primeAndRequestLocation();
      if (!granted) {
        // User declined or kept it blocked — drop a gentle nudge
        // toward the alternative methods rather than dead-ending.
        Alert.alert(
          'No location yet',
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
      geocodeStatus: 'success',
      city: p.city || draft.city,
      state: (p.state || draft.state || '').slice(0, 2).toUpperCase() || draft.state,
      postalCode: (p as any).postcode || draft.postalCode,
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
  // Phase 1 Fast Add — Fast Mode (step = -1) → back exits the screen.
  // Existing detailed flow (step 0-5) → back walks the stack.
  const prev = () => {
    if (step <= 0) {
      router.replace('/(tabs)');
      return;
    }
    setStep((s) => s - 1);
  };

  const pickImages = async () => {
    // Phase 2 — prevent double-tap re-launches of the OS picker.
    if (pickInFlightRef.current) return;
    pickInFlightRef.current = true;
    try {
      const granted = await primeAndRequestMediaLibrary();
      if (!granted) {
        // Permission was either declined or blocked. The prime sheet
        // already explained why and offered Settings — no further
        // Alert needed (would dead-end the user).
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 1,
        base64: false,
        selectionLimit: 6,
      });
      if (res.canceled) return;

      // CRITICAL (Apr 2026): switched from base64-in-Mongo to hosted-URL.
      // Phase 2 (Jun 2026): added per-asset progress + auto-retry to make
      // the upload survive flaky cellular. We compress aggressively
      // before upload (1600px @ q=0.82) so a 12MP capture is ~700-900KB
      // on the wire — fits well under proxy limits.
      const processed: { image_url: string; is_cover: boolean }[] = [];
      const totalAssets = res.assets.length;
      setUploadingCount(totalAssets);
      setUploadProgress(0);
      setSubmitPhase('compressing');

      for (let i = 0; i < totalAssets; i++) {
        const a = res.assets[i];
        try {
          const manipulated = await ImageManipulator.manipulateAsync(
            a.uri,
            [{ resize: { width: 1600 } }],
            {
              compress: 0.82,
              format: ImageManipulator.SaveFormat.JPEG,
              base64: false,
            },
          );
          setSubmitPhase('uploading');
          const onProgress = (frac: number) => {
            // Combine per-asset progress with which asset we're on.
            const overall = (i + frac) / totalAssets;
            setUploadProgress(Math.min(0.99, overall));
          };
          const url = await uploadWithRetry(
            {
              uri: manipulated.uri,
              mimeType: 'image/jpeg',
              fileName: `spot_${Date.now()}_${i}.jpg`,
            },
            onProgress,
          );
          if (url) {
            processed.push({
              image_url: url,
              is_cover: draft.images.length === 0 && processed.length === 0,
            });
          }
        } catch (err) {
          console.warn('Image upload failed, skipping photo', err);
        }
      }

      setUploadProgress(0);
      setUploadingCount(0);
      setSubmitPhase('idle');

      if (processed.length === 0) {
        Alert.alert(
          'Could not upload photos',
          'Please try picking different images or check your connection. Your draft is safe.',
        );
        return;
      }
      // Surface partial failure so the user can decide to retry.
      if (processed.length < totalAssets) {
        Alert.alert(
          'Some photos didn\u2019t upload',
          `${totalAssets - processed.length} of ${totalAssets} photos failed. You can tap "Add" to retry the missing ones.`,
        );
      }
      setDraft({ ...draft, images: [...draft.images, ...processed].slice(0, 8) });
    } finally {
      pickInFlightRef.current = false;
      setUploadProgress(0);
      setUploadingCount(0);
      setSubmitPhase('idle');
    }
  };

  // =========================================================================
  // Take Photo Now (camera capture + auto-GPS tag + reverse geocode)
  // =========================================================================
  // Opens the device camera, runs a parallel GPS request, and on success
  // prefills the draft with coordinates + captured-at + accuracy.
  // User is auto-advanced to the Location step for confirmation. Failures
  // degrade gracefully: camera-without-GPS still captures the photo; we just
  // ask the user to finish location manually.
  const takePhotoWithGPS = async () => {
    // Phase 2 — guard against rapid double-tap of "Take photo now".
    if (cameraInFlightRef.current) return;
    cameraInFlightRef.current = true;
    try {
    // 1. Permissions — ask for camera first (essential) and location
    //    second (nice-to-have). Each goes through the priming sheet so
    //    the user sees the "why" before any native OS dialog.
    const cameraOk = await primeAndRequestCamera();
    if (!cameraOk) {
      // Camera is the hard requirement for this flow — without it we
      // can't capture. Leave gracefully; the sheet has already
      // explained "why" and offered Settings if blocked.
      return;
    }
    const locationOk = await primeAndRequestLocation();
    const locPerm = { status: locationOk ? 'granted' : 'denied' } as const;

    // Batch #9A (May 2026) — GPS accuracy fix.
    //
    // Problem reported by a photographer: "Take photo now" was
    // snapping the pin to a neighbour's address ~30-60m away. Root
    // causes:
    //   · Accuracy was `Balanced` (~100m radius) — fine for a weather
    //     app, too loose for a scouting pin.
    //   · GPS fetch fired in PARALLEL with launchCamera, so the fix
    //     we captured was often from the moment the camera opened,
    //     not the moment the shutter fired. If the user walked a
    //     few yards between tap and shutter, the pin drifts.
    //   · Reverse-geocode's `p.name` was being used as the label
    //     source of truth; on US residential streets that's the
    //     NEAREST named POI, not the current coord.
    //
    // Fix: launch camera first, THEN take a best-accuracy fix at
    // shutter time, compare to EXIF's GPS, and keep whichever has the
    // tighter accuracy circle. The user still confirms the pin in
    // step #3 (Location) before publishing — we never auto-save a
    // guess. We also drop `p.name` from the label to avoid "Target
    // Portrait Studio, San Antonio" when the user is in their backyard.

    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
      base64: false,
      exif: true,
    });
    if (res.canceled || !res.assets?.[0]?.uri) {
      return;
    }
    const asset = res.assets[0];

    // 3. Compress + upload via multipart (NOT base64 — that's an
    //    Android OOM crash trigger for high-res photos). We use the
    //    same hosted-URL pipeline as `pickImages` so the captured
    //    photo lands in Cloudflare R2 and only the public URL ends
    //    up in `draft.images`.
    //
    //    ANDROID STABILIZATION (June 2025): replaced legacy base64
    //    in-memory data-URI with `uploadImageAsset`. On Android,
    //    base64 of a 12MP capture allocated >40MB on the JS heap
    //    AND on the native side (re-decoded by RN's <Image> for the
    //    thumbnail), reliably crashing devices with <4GB RAM. The
    //    multipart upload path is bytes-only on the wire and never
    //    decodes the JPEG twice.
    let imageUrl: string | null = null;
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1280 } }],
        { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: false },
      );
      setSubmitPhase('uploading');
      setUploadingCount(1);
      imageUrl = await uploadWithRetry(
        {
          uri: manipulated.uri,
          mimeType: 'image/jpeg',
          fileName: `spot_camera_${Date.now()}.jpg`,
        },
        (frac) => setUploadProgress(frac),
      );
    } catch (e) {
      // Network or auth failure on upload — surface a friendly
      // message but don't crash the flow.
      console.warn('[add] camera upload failed', e);
    } finally {
      setUploadProgress(0);
      setUploadingCount(0);
      setSubmitPhase('idle');
    }

    if (!imageUrl) {
      Alert.alert(
        'Photo upload failed',
        'We captured the photo but couldn\u2019t upload it. Please check your connection and try again.',
      );
      return;
    }

    // 4. Fetch BEST-accuracy device GPS *after* capture — this is the
    //    value closest to where the shutter fired. BestForNavigation =
    //    ~5m radius on modern phones with clear sky. We wrap in a 7s
    //    timeout so a weak GPS signal doesn't lock up the add flow;
    //    if it times out we fall back to the cached LastKnown fix,
    //    then to EXIF GPS, then to no-pin (manual entry).
    let deviceFix: Awaited<ReturnType<typeof Location.getCurrentPositionAsync>> | null = null;
    if (locPerm.status === 'granted') {
      try {
        deviceFix = await Promise.race([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.BestForNavigation,
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 7000)),
        ]);
      } catch { deviceFix = null; }

      // May 2026 — getCurrentPositionAsync can return null on a 7s
      // timeout (cold-start, indoors, urban canyon). getLastKnown
      // returns the cached fix from the OS (typically <60s old), which
      // is far more useful than no-pin fallback. We accept it even if
      // accuracy is loose because step #3 makes the user confirm
      // before publishing.
      if (!deviceFix) {
        try {
          const last = await Location.getLastKnownPositionAsync({
            maxAge: 5 * 60 * 1000, // 5 min
            requiredAccuracy: 100, // m
          });
          if (last && last.coords) {
            deviceFix = last as any;
          }
        } catch { /* noop — keep deviceFix null */ }
      }
    }

    // Parse EXIF GPS (iOS + Android both populate GPSLatitude /
    // GPSLongitude as *decimal* numbers in SDK 54's image-picker).
    let exifLat: number | undefined;
    let exifLng: number | undefined;
    let exifAcc: number | undefined;
    if (asset.exif) {
      const ex: any = asset.exif;
      if (typeof ex.GPSLatitude === 'number' && typeof ex.GPSLongitude === 'number') {
        exifLat = ex.GPSLatitude;
        exifLng = ex.GPSLongitude;
        // Some devices record horizontal accuracy in `GPSHPositioningError`.
        exifAcc = typeof ex.GPSHPositioningError === 'number' ? ex.GPSHPositioningError : undefined;
      }
    }

    // Pick the tighter fix. If BOTH exist and EXIF's accuracy is
    // unknown, device wins (Balanced-better-than-unknown). If device
    // is null, EXIF wins. If both are null, leave the pin empty so
    // step #3 makes the user confirm manually.
    let lat: number | undefined;
    let lng: number | undefined;
    let accuracy: number | undefined;
    let heading: number | undefined;
    let altitude: number | undefined;
    const deviceAcc = deviceFix?.coords?.accuracy ?? undefined;
    if (deviceFix?.coords && (exifAcc == null || (deviceAcc != null && deviceAcc <= exifAcc))) {
      lat = deviceFix.coords.latitude;
      lng = deviceFix.coords.longitude;
      accuracy = deviceAcc;
      heading = deviceFix.coords.heading ?? undefined;
      altitude = deviceFix.coords.altitude ?? undefined;
    } else if (exifLat != null && exifLng != null) {
      lat = exifLat;
      lng = exifLng;
      accuracy = exifAcc;
    }

    // 5. Reverse-geocode. Treat the result as a LABEL, not a source
    //    of truth. We intentionally drop `p.name` (the nearest POI)
    //    so we don't mislabel a shot in a public park with a nearby
    //    business name. City+State only — the user can add detail in
    //    the Location step.
    let city: string | undefined;
    let state: string | undefined;
    let locationLabel: string | undefined;
    if (lat != null && lng != null) {
      try {
        const places = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        if (places && places[0]) {
          const p = places[0];
          city = p.city || p.subregion || undefined;
          state = p.region || undefined;
          locationLabel = [city, state].filter(Boolean).join(', ') || undefined;
        }
      } catch {}
    }

    // May 2026 — removed the legacy >30m advisory alert. It was
    // duplicative with the >100m "Approximate location" alert below,
    // and the 30m bar fired on most modern phones in any urban
    // setting (city block accuracy ≈ 30-50m), creating alert fatigue.
    // The user can still see + drag the pin on the Location step.

    // 6. Merge into draft and auto-advance to Location step for confirmation.
    const newImage = {
      image_url: imageUrl,
      is_cover: draft.images.length === 0,
      caption: undefined,
    };
    setDraft((prev) => ({
      ...prev,
      images: [...prev.images, newImage].slice(0, 8),
      latitude: lat ?? prev.latitude,
      longitude: lng ?? prev.longitude,
      locationLabel: locationLabel ?? prev.locationLabel,
      locationSource: lat != null ? 'gps' : prev.locationSource,
      city: city || prev.city,
      state: state || prev.state,
      sourceType: 'camera_capture',
      capturedAt: new Date().toISOString(),
      gpsAccuracy: accuracy,
      gpsHeading: heading,
      gpsAltitude: altitude,
      geocodeStatus: locationLabel ? 'success' : 'skipped',
      geocodeConfidence: locationLabel ? 0.85 : undefined,
    }));

    // 7. Friendly fallback messaging — NEVER block the flow.
    //
    // Per May 2026 PRD: "Take photo now no longer fails because EXIF
    // GPS is missing. Reverse geocode failure does not fully block
    // submission." We always advance the user to step #3 (Location)
    // where they can search a place, drop a pin, or type the address
    // by hand. The alerts here are advisory, not gating.
    if (lat == null) {
      // Permission denied OR getCurrentPosition + getLastKnown both
      // failed. Photo is captured; user just needs to set the pin
      // manually. Friendly copy from the PRD.
      Alert.alert(
        'Add the location manually',
        "We couldn\u2019t detect the exact photo location. You can still add this spot by using your current GPS location or entering the location manually.",
      );
    } else if (accuracy != null && accuracy > 100) {
      Alert.alert(
        'Approximate location',
        `We locked on to a rough area (${Math.round(accuracy)}m radius). Please tap "Change" on the next step to drop a pin or search for the exact spot.`,
      );
    }

    // 8. ALWAYS advance to the Location step. Even when we have no
    //    coordinates the user needs the Location step to finish their
    //    submission — keeping them on the photo step traps them with
    //    a confusing "is the upload working?" feeling. The Location
    //    step's search / map-picker / manual-entry flows handle the
    //    no-pin case cleanly.
    setStep(1);
    } finally {
      // Phase 2 — release the rapid-tap guard regardless of outcome.
      cameraInFlightRef.current = false;
    }
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

  const buildPayload = (asDraft: boolean) => {
    // Phase 2 — compute internal quality score. NOT shown publicly.
    const { score: dataQualityScore, signals: dataQualitySignals } = computeDataQuality({
      images: draft.images,
      title: draft.title,
      city: draft.city,
      latitude: draft.latitude,
      longitude: draft.longitude,
      shoot_types: draft.shoot_types,
      style_tags: draft.style_tags,
      notes: draft.notes,
      description: draft.description,
      best_time_of_day: draft.best_time_of_day,
      best_light_notes: draft.best_light_notes,
      parking_notes: draft.parking_notes,
      parking_rating: draft.parking_rating,
      walk_rating: draft.walk_rating,
      permit_required: draft.permit_required,
      safety_rating: draft.safety_rating,
      crowd_level: draft.crowd_level,
      lens_recommendations: draft.lens_recommendations,
      best_lens_range: draft.best_lens_range,
      land_access: draft.land_access,
      access_notes: draft.access_notes,
      sourceType: draft.sourceType,
      gpsAccuracy: draft.gpsAccuracy ?? null,
    });
    return ({
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
    best_light_notes: draft.best_light_notes,
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
    // FIX(2026-04 / Item #1): land access disclosure
    land_access: draft.land_access,
    access_notes: draft.access_notes || undefined,
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
    // FIX(2026-05): camera-capture provenance for "On-Site Verified" badge.
    capture_source: draft.sourceType || undefined,
    captured_at: draft.capturedAt,
    gps_accuracy_m: draft.gpsAccuracy,
    gps_heading: draft.gpsHeading,
    gps_altitude_m: draft.gpsAltitude,
    on_site_verified: draft.sourceType === 'camera_capture'
      && typeof draft.gpsAccuracy === 'number'
      && draft.gpsAccuracy <= 100,
    save_as_draft: asDraft,
    // Park-Based Multi-Spot Workflow (Phase 2)
    park_group_id: locationType === 'park_child' && selectedPark ? selectedPark.park_id : undefined,
    park_name:     locationType === 'park_child' && selectedPark ? selectedPark.name    : undefined,
    // Phase 2 — Add Location Optimization (Jun 2026): internal moderation signal.
    data_quality_score: dataQualityScore,
    data_quality_signals: dataQualitySignals,
  });
  };

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
    // Phase 2 — hard double-tap guard. The disabled prop on the button
    // helps, but Pressable can fire onPress twice if the user taps
    // during the layout shift between idle and loading.
    if (submitInFlightRef.current) return;
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
    submitInFlightRef.current = true;
    setSubmitting(true);
    setSubmitPhase('saving');
    const payload = buildPayload(false);
    const childPark = locationType === 'park_child' && selectedPark ? selectedPark : null;

    // Phase 2 — retry one time on transient failures (NetworkError /
    // 5xx) before falling through to the offline-queue fallback. The
    // photographer is often on flaky coverage and one quick auto-retry
    // saves them from a frustrating "tap-tap-tap" loop.
    const postOnce = () => api.post('/spots', payload);
    let created: any = null;
    let lastErr: any = null;
    try {
      try {
        created = await postOnce();
      } catch (e1: any) {
        const status1: number | undefined = e1?.status ?? e1?.response?.status;
        const transient1 = !status1 || status1 >= 500 || status1 === 408 || status1 === 429;
        if (transient1) {
          setSubmitPhase('retrying');
          await new Promise((r) => setTimeout(r, 900));
          created = await postOnce();
        } else {
          throw e1;
        }
      }
      setSubmitPhase('saving');
      // Explore Speed CR — Batch 4 (June 2025): clear the Explore list
      // SWR cache so the user sees their newly-submitted spot on the
      // next Explore visit instead of the previous cached set.
      try {
        const { invalidateCachePrefix } = await import('../../src/utils/swrCache');
        await invalidateCachePrefix('explore.list:v1');
      } catch {}

      // Park-Based Multi-Spot Workflow (Phase 2)
      const submittedSpotId = created?.spot_id || null;
      if (childPark) {
        try {
          await api.post('/me/park-session', {
            park_id: childPark.park_id,
            last_added_spot_id: submittedSpotId,
          });
        } catch {}
      }
      setLastSubmittedSpot({
        spot_id: submittedSpotId,
        park_id: childPark?.park_id || null,
        park_name: childPark?.name || null,
        title: draft.title,
        city: draft.city,
        state: draft.state,
        cover_url: draft.images.find((i) => i.is_cover)?.image_url
          || draft.images[0]?.image_url || null,
        visibility_status: created?.visibility_status || null,
      });
      // Phase 1 Fast Add — wipe the autosave blob so a follow-on submission
      // doesn't restore the just-published spot's data on next open.
      await clearAutosavedDraft();
      setPostSaveOpen(true);
    } catch (e: any) {
      lastErr = e;
      // Phase 6 — Offline / poor-signal fallback. We treat anything
      // that ISN'T a clear 4xx server validation as a transient
      // network failure and queue the spot to AsyncStorage so the
      // user doesn't lose their work walking around the park.
      // Phase 2 — IMPORTANT: never reset the draft here. The user
      // should still see their work even if we couldn't save it.
      const status: number | undefined = e?.status ?? e?.response?.status;
      const isNetworkFailure = !status || status >= 500;
      if (isNetworkFailure) {
        try {
          await saveLocalDraft(payload, {
            park_group_id: childPark?.park_id ?? null,
            park_name:     childPark?.name ?? null,
          });
          await drafts.refreshCount();
          Alert.alert(
            'Saved as draft',
            "You're offline or the network is unstable. We'll upload this spot the moment you're back online — your draft is safe.",
            [{ text: 'OK' }],
          );
        } catch {
          Alert.alert(
            'Could not save',
            'Network failed and the local draft store is unavailable. Your draft is still on this device — please try again in a moment.',
          );
        }
      } else {
        Alert.alert('Could not submit', formatApiError(e));
      }
    } finally {
      setSubmitting(false);
      setSubmitPhase('idle');
      submitInFlightRef.current = false;
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={prev} testID="add-back">
            <ChevronLeft color={colors.text} size={24} />
          </TouchableOpacity>
          {step < 0 ? (
            <>
              <Text style={styles.headerTitle}>Add a spot</Text>
              <Text style={styles.headerStep}>Fast</Text>
            </>
          ) : (
            <>
              <Text style={styles.headerTitle}>{STEPS[step]}</Text>
              <Text style={styles.headerStep}>{step + 1} / {STEPS.length}</Text>
            </>
          )}
        </View>

        <View style={styles.progress}>
          <View style={[styles.progressFill, { width: step < 0 ? '10%' : `${((step + 1) / STEPS.length) * 100}%` }]} />
        </View>

        {/* Phase 6 — Offline drafts pending. Shows up only when we have
            something queued; tapping Retry tries to drain immediately. */}
        {drafts.count > 0 && (
          <View style={styles.draftsBanner} testID="drafts-banner">
            <View style={styles.draftsIcon}>
              <FileText size={12} color={colors.primary} />
            </View>
            <Text style={styles.draftsTxt} numberOfLines={1}>
              {drafts.count} spot{drafts.count === 1 ? '' : 's'} waiting to upload
            </Text>
            <TouchableOpacity
              style={styles.draftsBtn}
              onPress={async () => {
                const r = await drafts.syncNow();
                if (r.uploaded > 0) {
                  Alert.alert('Synced', `Uploaded ${r.uploaded} spot${r.uploaded === 1 ? '' : 's'}.${r.remaining > 0 ? ` ${r.remaining} still queued.` : ''}`);
                } else if (r.failed > 0) {
                  Alert.alert('Still offline', `Couldn't reach the server. ${r.failed} spot${r.failed === 1 ? '' : 's'} remain queued.`);
                }
              }}
              disabled={drafts.syncing}
              testID="drafts-retry"
            >
              <Text style={styles.draftsBtnTxt}>{drafts.syncing ? 'Syncing…' : 'Retry'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* FIX(Commit 7.6 / 2026-04): keyboardDismissMode lets users swipe
            the form to dismiss the keyboard — iOS interactive tracking,
            Android drag-to-dismiss. Combined with keyboardShouldPersistTaps
            means taps on buttons/labels still work while the keyboard is up. */}
        <ScrollView
          contentContainerStyle={{ padding: space.xl, paddingBottom: 120 + (Platform.OS === 'android' ? kbHeight : 0) }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        >
          {/* ──────────────────────────────────────────────────────────────
              Phase 1 Fast Add Mode (Jun 2026) — single-screen quick submit.
              Default entry point so a field photographer can publish a
              useful spot in <60s with: photo + name + pin + category + tip.
              "Add More Details" promotes the user into the existing
              multi-step flow without losing collected state.
              ────────────────────────────────────────────────────────────── */}
          {step === -1 && (
            <View style={{ gap: space.lg }}>
              {/* Phase 3 (Jun 2026) — tier-aware soft nudge for Free users
                  approaching the upload cap. Hard block (5/5) still raises
                  a 402 from POST /spots and the GlobalUpgradeGate covers
                  that path automatically. */}
              {effectiveTier(user as any) === 'free' && typeof (user as any)?.usage?.uploads === 'number'
                && typeof (user as any)?.limits?.max_uploads === 'number'
                && (user as any).limits.max_uploads < 10_000 && (
                <TouchableOpacity
                  onPress={() => router.push('/paywall?reason=uploads' as any)}
                  style={styles.fastUpgradeNudge}
                  testID="fast-uploads-nudge"
                >
                  <Crown size={14} color={colors.primary} />
                  <Text style={styles.fastUpgradeNudgeTxt} numberOfLines={2}>
                    {(user as any).usage.uploads}/{(user as any).limits.max_uploads} Free uploads used.{' '}
                    <Text style={{ color: colors.primary, fontFamily: font.bodyBold }}>Go Pro</Text> for unlimited.
                  </Text>
                </TouchableOpacity>
              )}
              {/* Draft-restored banner */}
              {draftRestoredRef.current && (draft.title || draft.images.length > 0) && (
                <View style={styles.draftRestoredBanner}>
                  <View style={styles.draftsIcon}>
                    <FileText size={12} color={colors.primary} />
                  </View>
                  <Text style={styles.draftRestoredTxt} numberOfLines={2}>
                    We picked up where you left off.
                  </Text>
                  <TouchableOpacity onPress={discardDraft} hitSlop={10} testID="fast-discard-draft">
                    <Text style={styles.draftRestoredDiscard}>Discard</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Hero copy */}
              <View>
                <Text style={styles.fastHero}>Drop a spot</Text>
                <Text style={styles.fastSub}>
                  Snap, name, and pin in under a minute. You can add the polish later.
                </Text>
              </View>

              {/* ── Photo capture ── */}
              <View style={styles.fastSection}>
                <Text style={styles.fastLabel}>1. Add a photo</Text>
                {draft.images.length === 0 ? (
                  <View style={{ gap: 8 }}>
                    <TouchableOpacity style={styles.fastPhotoBtn} onPress={takePhotoWithGPS} testID="fast-take-photo">
                      <Camera size={20} color={colors.textInverse} />
                      <Text style={styles.fastPhotoBtnTxt}>Take photo now</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.fastPhotoBtnSecondary} onPress={pickImages} testID="fast-pick-library">
                      <ImageIcon size={16} color={colors.text} />
                      <Text style={styles.fastPhotoBtnSecondaryTxt}>Choose from library</Text>
                    </TouchableOpacity>
                    <Text style={styles.fastHelp}>
                      Taking a photo here auto-tags the GPS pin for you.
                    </Text>
                  </View>
                ) : (
                  <View style={{ gap: 8 }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      {draft.images.map((img, i) => (
                        <View key={i} style={styles.fastThumb}>
                          <Image source={{ uri: resolveImageUrl(img.image_url) }} style={styles.fastThumbImg} />
                          <TouchableOpacity
                            style={styles.fastThumbRemove}
                            onPress={() => removeImg(i)}
                            hitSlop={10}
                            testID={`fast-remove-image-${i}`}
                          >
                            <X size={12} color={colors.textInverse} />
                          </TouchableOpacity>
                        </View>
                      ))}
                      {draft.images.length < 4 && (
                        <TouchableOpacity style={styles.fastThumbAdd} onPress={pickImages} testID="fast-add-more">
                          <Plus size={20} color={colors.textSecondary} />
                          <Text style={styles.fastThumbAddTxt}>Add</Text>
                        </TouchableOpacity>
                      )}
                    </ScrollView>
                    <Text style={styles.fastHelp}>{draft.images.length} of 8 photos · tap the × to remove</Text>
                  </View>
                )}
              </View>

              {/* ── Location name ── */}
              <View style={styles.fastSection}>
                <Text style={styles.fastLabel}>2. Spot name</Text>
                <Input
                  value={draft.title}
                  onChangeText={(t) => setDraft({ ...draft, title: t })}
                  placeholder="e.g. Mt. Bonnell overlook"
                  testID="fast-title"
                />
                {draft.title.trim().length > 0 && draft.title.trim().length < 3 && (
                  <Text style={styles.fastError}>Give it at least 3 characters.</Text>
                )}
              </View>

              {/* ── Pin ── */}
              <View style={styles.fastSection}>
                <Text style={styles.fastLabel}>3. Confirm the pin</Text>
                {(() => {
                  // Phase 2 — Smart Pin Capture (Jun 2026).
                  // Color-coded accuracy badge driven by the GPS fix
                  // accuracy radius. Adds a "Refresh" affordance so a
                  // field photographer who walked 20m can re-snap the
                  // pin without leaving the Fast screen.
                  const tier = gpsAccuracyTier(draft.gpsAccuracy ?? undefined);
                  const tierLabel = gpsAccuracyLabel(tier);
                  const colorKey = gpsAccuracyColorKey(tier);
                  const badgeColor = colors[colorKey] as string;
                  const imperial = gpsShouldShowImperial(draft.state);
                  const radiusText = gpsFormatAccuracy(
                    draft.gpsAccuracy ?? undefined,
                    { showImperial: imperial },
                  );
                  const hasPin = draft.latitude != null && draft.longitude != null;

                  if (!hasPin) {
                    return (
                      <View style={{ gap: 8 }}>
                        <TouchableOpacity
                          style={styles.fastPinBtnPrimary}
                          onPress={refreshGpsPin}
                          testID="fast-use-gps"
                        >
                          <MapPin size={16} color={colors.textInverse} />
                          <Text style={styles.fastPinBtnPrimaryTxt}>Use my current location</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.fastPinBtn} onPress={() => setMapOpen(true)} testID="fast-open-map">
                          <MapIcon size={16} color={colors.text} />
                          <Text style={styles.fastPinBtnTxt}>Pick on map</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.fastPinBtn} onPress={() => setSearchOpen(true)} testID="fast-search-place">
                          <Search size={16} color={colors.text} />
                          <Text style={styles.fastPinBtnTxt}>Search a place</Text>
                        </TouchableOpacity>
                        <Text style={styles.fastHelp}>
                          If location access is denied, pick on map or search instead — the spot still gets saved.
                        </Text>
                      </View>
                    );
                  }
                  return (
                    <View style={{ gap: 8 }}>
                      <View style={styles.fastPinCard}>
                        <View style={styles.fastPinIconWrap}>
                          <MapPin size={18} color={colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.fastPinPrimary} numberOfLines={1}>
                            {draft.locationLabel || `${draft.latitude!.toFixed(4)}, ${draft.longitude!.toFixed(4)}`}
                          </Text>
                          {radiusText ? (
                            <View style={styles.fastPinAccuracyRow}>
                              <View style={[styles.fastAccBadge, { borderColor: badgeColor }]}>
                                <View style={[styles.fastAccDot, { backgroundColor: badgeColor }]} />
                                <Text style={[styles.fastAccBadgeTxt, { color: badgeColor }]}>{tierLabel}</Text>
                              </View>
                              <Text style={styles.fastPinMeta}>{radiusText}</Text>
                            </View>
                          ) : null}
                          {tier === 'poor' && (
                            <Text style={styles.fastPinWarn}>
                              Low GPS accuracy — consider stepping outside or picking on the map.
                            </Text>
                          )}
                        </View>
                        <TouchableOpacity onPress={() => setMapOpen(true)} hitSlop={10} testID="fast-edit-pin">
                          <Edit3 size={16} color={colors.textSecondary} />
                        </TouchableOpacity>
                      </View>
                      <View style={styles.fastPinActionsRow}>
                        <TouchableOpacity
                          style={styles.fastPinChip}
                          onPress={refreshGpsPin}
                          testID="fast-refresh-pin"
                        >
                          <MapPin size={12} color={colors.text} />
                          <Text style={styles.fastPinChipTxt}>Refresh GPS</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.fastPinChip}
                          onPress={() => setMapOpen(true)}
                          testID="fast-change-pin"
                        >
                          <MapIcon size={12} color={colors.text} />
                          <Text style={styles.fastPinChipTxt}>Pick on map</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.fastPinChip}
                          onPress={() => setSearchOpen(true)}
                          testID="fast-search-pin"
                        >
                          <Search size={12} color={colors.text} />
                          <Text style={styles.fastPinChipTxt}>Search</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })()}
              </View>

              {/* ── Category ── */}
              <View style={styles.fastSection}>
                <Text style={styles.fastLabel}>4. What kind of shoot?</Text>
                <View style={styles.fastChipRow}>
                  {SHOOT_TYPES.slice(0, 8).map((opt) => {
                    const active = draft.shoot_types.includes(opt);
                    return (
                      <Chip
                        key={opt}
                        label={opt}
                        active={active}
                        onPress={() => {
                          const next = active
                            ? draft.shoot_types.filter((s) => s !== opt)
                            : [...draft.shoot_types, opt];
                          setDraft({ ...draft, shoot_types: next });
                        }}
                        testID={`fast-shoot-${opt}`}
                      />
                    );
                  })}
                </View>
              </View>

              {/* ── Short tip ── */}
              <View style={styles.fastSection}>
                <Text style={styles.fastLabel}>5. Quick tip <Text style={styles.fastLabelOptional}>(optional but helpful)</Text></Text>
                <Input
                  value={draft.notes}
                  onChangeText={(t) => setDraft({ ...draft, notes: t })}
                  placeholder="e.g. Best at golden hour from the western ridge. Bring a wide lens."
                  multiline
                  numberOfLines={3}
                  testID="fast-tip"
                />
              </View>

              {/* ── Submission progress states ── (Phase 2: phase-aware copy + bar) */}
              {(submitting || uploadingCount > 0) && (
                <View style={styles.fastProgressCard} testID="fast-progress">
                  <ActivityIndicator color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fastProgressTxt}>
                      {submitPhase === 'compressing' && 'Preparing your photo…'}
                      {submitPhase === 'uploading' &&
                        (uploadingCount > 1
                          ? `Uploading photos… (${Math.round(uploadProgress * 100)}%)`
                          : `Uploading photo… ${Math.round(uploadProgress * 100)}%`)}
                      {submitPhase === 'saving' && 'Saving spot…'}
                      {submitPhase === 'retrying' && 'Network hiccup — retrying…'}
                      {submitPhase === 'idle' && 'Submitting for review…'}
                    </Text>
                    {submitPhase === 'uploading' && (
                      <View style={styles.fastProgressBar}>
                        <View
                          style={[
                            styles.fastProgressBarFill,
                            { width: `${Math.round(uploadProgress * 100)}%` },
                          ]}
                        />
                      </View>
                    )}
                  </View>
                </View>
              )}

              {/* ── Inline validation summary ── */}
              {!submitting && (
                <View style={{ gap: 4 }}>
                  <CheckRow ok={draft.images.length >= 1} label="At least 1 photo" />
                  <CheckRow ok={draft.title.trim().length >= 3} label="Spot name (3+ characters)" />
                  <CheckRow ok={draft.latitude != null && draft.longitude != null} label="Pin confirmed" />
                  <CheckRow ok={draft.shoot_types.length >= 1} label="At least 1 shoot type" soft />
                </View>
              )}

              {/* ── Primary CTAs ── */}
              <View style={{ gap: 8, marginTop: space.md }}>
                <Button
                  title="Submit for Review"
                  onPress={submit}
                  loading={submitting}
                  disabled={
                    submitting ||
                    draft.images.length < 1 ||
                    draft.title.trim().length < 3 ||
                    draft.latitude == null ||
                    draft.longitude == null
                  }
                  testID="fast-submit"
                />
                <TouchableOpacity
                  style={styles.fastDetailsBtn}
                  onPress={() => setStep(0)}
                  disabled={submitting}
                  testID="fast-add-details"
                >
                  <Text style={styles.fastDetailsBtnTxt}>Add More Details</Text>
                  <ChevronRight size={16} color={colors.textSecondary} />
                </TouchableOpacity>
                {draft.title || draft.images.length > 0 ? (
                  <TouchableOpacity onPress={discardDraft} disabled={submitting} testID="fast-discard">
                    <Text style={styles.fastDiscardTxt}>Discard draft</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          )}

          {step === 0 && (
            <View style={{ gap: space.lg }}>
              {/* Park session pickup banner — shown when an active 24h session
                  exists from a prior add. Lets the user continue, switch, or
                  go standalone without losing their state. */}
              {activeSession && sessionPark && locationType === 'standalone' && !selectedPark && (
                <View style={styles.sessionBanner} testID="park-session-banner">
                  <View style={styles.sessionIcon}>
                    <Layers size={16} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sessionTitle}>
                      Continue adding spots to {activeSession.active_park_name}?
                    </Text>
                    <Text style={styles.sessionSub}>
                      You were adding spots here recently. Pick up where you left off.
                    </Text>
                    <View style={styles.sessionBtnRow}>
                      <TouchableOpacity
                        style={styles.sessionPrimary}
                        onPress={() => {
                          setSelectedPark(sessionPark);
                          setLocationType('park_child');
                        }}
                        testID="park-session-continue"
                      >
                        <Text style={styles.sessionPrimaryTxt}>Continue</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.sessionGhost}
                        onPress={() => setParkPickerOpen(true)}
                        testID="park-session-different"
                      >
                        <Text style={styles.sessionGhostTxt}>Different park</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.sessionGhost}
                        onPress={async () => {
                          try { await api.delete('/me/park-session'); } catch {}
                          setActiveSession(null);
                          setSessionPark(null);
                        }}
                        testID="park-session-end"
                      >
                        <Text style={styles.sessionGhostTxt}>End</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}

              <Text style={styles.heading}>Add photos</Text>
              <Text style={styles.sub}>Start with your shots. You'll assign a location next. Public spots need at least one photo — tap an image to make it the cover.</Text>
              {/* Take Photo Now — captures GPS in parallel with the shutter */}
              <TouchableOpacity style={styles.takePhotoCard} onPress={takePhotoWithGPS} testID="add-take-photo">
                <View style={styles.takePhotoIconWrap}>
                  <Camera size={22} color={colors.textInverse} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.takePhotoTitle}>Take photo now</Text>
                  <Text style={styles.takePhotoSub}>
                    On-site? We'll auto-tag GPS + suggest a location.
                  </Text>
                </View>
                <View style={styles.onSitePill}>
                  <Text style={styles.onSitePillTxt}>📍 On-Site Verified</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.uploadCard} onPress={pickImages} testID="add-pick-images">
                <ImageIcon size={28} color={colors.primary} />
                <Text style={styles.uploadText}>Upload from camera roll</Text>
                <Text style={styles.uploadHint}>Up to 8 images</Text>
              </TouchableOpacity>
              {draft.sourceType === 'camera_capture' && draft.gpsAccuracy != null ? (
                <View style={styles.gpsChip}>
                  <MapPin size={12} color={colors.primary} />
                  <Text style={styles.gpsChipTxt}>
                    GPS locked · ±{Math.round(draft.gpsAccuracy)}m
                    {draft.locationLabel ? ` · ${draft.locationLabel}` : ''}
                  </Text>
                </View>
              ) : null}
              <View style={styles.imgGrid}>
                {draft.images.map((img, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.imgWrap, img.is_cover && styles.imgWrapFeatured]}
                    onPress={() => setCover(i)}
                    onLongPress={() => removeImg(i)}
                    testID={`add-photo-thumb-${i}`}
                  >
                    <Image source={{ uri: resolveImageUrl(img.image_url) }} style={styles.imgThumb} />
                    {img.is_cover ? (
                      <View style={styles.coverBadge}>
                        <Text style={styles.coverTxt}>FEATURED</Text>
                      </View>
                    ) : (
                      <View style={styles.tapToFeatureHint} pointerEvents="none">
                        <Text style={styles.tapToFeatureTxt}>Tap to feature</Text>
                      </View>
                    )}
                    <TouchableOpacity style={styles.imgRemove} onPress={() => removeImg(i)}>
                      <X size={14} color="#fff" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
              {draft.images.length > 0 ? (
                <Text style={styles.galleryHint}>
                  Tap any photo to make it the featured cover · Long-press or × to remove
                </Text>
              ) : null}
            </View>
          )}

          {step === 1 && (
            <View style={{ gap: space.lg }}>
              {/* Location Type chooser — Standalone vs. Spot inside a park.
                  Lets a photographer group multiple shootable areas under
                  one parent park (e.g., Eisenhower Park → Sunset Ridge,
                  Shaded Oak, Rocky Stairs). Optional — defaults to
                  standalone so existing flow is preserved. */}
              <View style={styles.typeRow}>
                <TouchableOpacity
                  style={[styles.typeCard, locationType === 'standalone' && styles.typeCardOn]}
                  onPress={() => { setLocationType('standalone'); setSelectedPark(null); }}
                  testID="loc-type-standalone"
                >
                  <MapPin size={16} color={locationType === 'standalone' ? colors.primary : colors.textSecondary} />
                  <Text style={[styles.typeTitle, locationType === 'standalone' && { color: colors.primary }]}>Standalone spot</Text>
                  <Text style={styles.typeSub}>A single location.</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeCard, locationType === 'park_child' && styles.typeCardOn]}
                  onPress={() => {
                    setLocationType('park_child');
                    if (!selectedPark) setParkPickerOpen(true);
                  }}
                  testID="loc-type-park-child"
                >
                  <Layers size={16} color={locationType === 'park_child' ? colors.primary : colors.textSecondary} />
                  <Text style={[styles.typeTitle, locationType === 'park_child' && { color: colors.primary }]}>Inside a park / area</Text>
                  <Text style={styles.typeSub}>Group under a parent.</Text>
                </TouchableOpacity>
              </View>

              {locationType === 'park_child' && (
                <View style={styles.parkPickedCard}>
                  {selectedPark ? (
                    <>
                      <View style={styles.parkPickedIcon}>
                        <Layers size={16} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.parkPickedLabel}>Parent park</Text>
                        <Text style={styles.parkPickedName} numberOfLines={1}>{selectedPark.name}</Text>
                        {selectedPark.city ? (
                          <Text style={styles.parkPickedMeta} numberOfLines={1}>
                            {selectedPark.city}{selectedPark.state ? `, ${selectedPark.state}` : ''}
                          </Text>
                        ) : null}
                      </View>
                      <TouchableOpacity onPress={() => setParkPickerOpen(true)} testID="loc-park-change">
                        <Text style={styles.parkPickedChange}>Change</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                      onPress={() => setParkPickerOpen(true)}
                      testID="loc-park-pick"
                    >
                      <View style={styles.parkPickedIcon}>
                        <Search size={14} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.parkPickedName}>Pick or create a parent park</Text>
                        <Text style={styles.parkPickedMeta}>Search existing or add a new one.</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              <Text style={styles.heading}>Where was this shot?</Text>
              <Text style={styles.sub}>
                You don't need to be there. Search a place, drop a pin, or type the details by hand — perfect for past sessions.
              </Text>

              {/* Currently selected */}
              {draft.locationLabel ? (
                <View style={styles.selectedCard}>
                  {/* Header row — pin icon + kicker label + verified
                      chip, all inline. `paddingRight: 84` reserves a
                      hard no-go zone for the absolutely-positioned
                      `changeBtn` (top/right) so the chip can never
                      slide under it on narrow screens. The chip uses
                      its natural width — no marginLeft:auto so it
                      stays right beside the label, not pushed to the
                      Change button's edge. */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 84 }}>
                    <MapPin size={16} color={colors.primary} />
                    <Text style={styles.selectedKicker} numberOfLines={1}>
                      {draft.locationSource === 'gps' ? 'Current location' :
                       draft.locationSource === 'searched_place' ? 'Searched place' :
                       draft.locationSource === 'dropped_pin' ? 'Dropped pin' :
                       draft.locationSource === 'manual_entry' ? 'Manual entry' : 'Location'}
                    </Text>
                    {draft.geocodeConfidence != null && draft.geocodeStatus === 'success' && (
                      <View style={styles.confChip}>
                        <Check size={10} color={colors.success} />
                        <Text style={styles.confChipTxt}>
                          {draft.geocodeConfidence >= 0.8 ? 'Verified' :
                           draft.geocodeConfidence >= 0.5 ? 'Matched' : 'Approximate'}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.selectedLabel} numberOfLines={2}>{draft.locationLabel}</Text>
                  {draft.latitude != null && draft.longitude != null && (
                    <MapPreviewCard
                      latitude={draft.latitude}
                      longitude={draft.longitude}
                      label={draft.locationLabel}
                      height={160}
                      testID="add-map-preview"
                    />
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

              {/* Land access moved to Step 3 (Access & Rules) — all access
                  disclosures live in one place per Apr 2026 simplification. */}

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
              <Text style={styles.heading}>Access & Rules</Text>
              <Text style={styles.sub}>Help future photographers prepare and respect the location.</Text>

              {/* (FIX UX cleanup #2) "Best time of day" multi-select removed.
                  Replaced with an optional free-text "Best Light Notes" field
                  for higher-quality data with less form friction. The legacy
                  draft.best_time_of_day field still exists in the schema but
                  is no longer collected via UI; back-end parses best_light_notes
                  passed alongside. */}
              <Input
                label="Best light notes (optional)"
                value={draft.best_light_notes || ''}
                onChangeText={(t) => setDraft({ ...draft, best_light_notes: t.slice(0, 240) })}
                placeholder="e.g. Best 30 min before sunset · Morning side light · Golden hour through trees · Blue hour city lights"
                multiline
                numberOfLines={2}
                testID="add-best-light-notes"
              />

              {/* ---- Land access (REQUIRED) ---- */}
              <View style={{ marginTop: 6 }}>
                <LandAccessSelector
                  value={draft.land_access}
                  accessNotes={undefined /* moved to dedicated 'Best access' field below */}
                  onChange={(v) => setDraft({ ...draft, land_access: v })}
                  onAccessNotesChange={() => {}}
                />
              </View>

              {/* ---- Parking notes ---- */}
              <Input
                label="Parking notes"
                value={draft.parking_notes}
                onChangeText={(t) => setDraft({ ...draft, parking_notes: t.slice(0, 500) })}
                placeholder="Where to park, gate codes, capacity, etc."
                multiline
                numberOfLines={2}
                maxLength={500}
                textAlignVertical="top"
                style={{ minHeight: 70, paddingTop: 12 }}
                testID="add-parking-notes"
              />

              {/* ---- Permit + Fee toggles ---- */}
              <View style={{ gap: space.md }}>
                <Toggle label="Permit needed?" value={draft.permit_required} onChange={(v) => setDraft({ ...draft, permit_required: v })} />
                <Toggle label="Entry fee?" value={draft.fee_required} onChange={(v) => setDraft({ ...draft, fee_required: v })} />
              </View>

              {/* ---- Best access instructions ---- */}
              <Input
                label="Best access instructions"
                value={draft.access_notes}
                onChangeText={(t) => setDraft({ ...draft, access_notes: (t || '').slice(0, 1000) })}
                placeholder="Trail name, gate, recommended approach, what to avoid…"
                multiline
                numberOfLines={3}
                maxLength={1000}
                textAlignVertical="top"
                style={{ minHeight: 90, paddingTop: 12 }}
                testID="add-access-notes"
              />

              {/* ---- Notes for Future You (free-form) ---- */}
              <Input
                label="Notes for Future You"
                value={draft.notes}
                onChangeText={(t) => setDraft({ ...draft, notes: t.slice(0, 2000) })}
                placeholder="Anything you'd want to remember later…"
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
                const active = draft.privacy_mode === p.key;
                return (
                  <TouchableOpacity
                    key={p.key}
                    onPress={() => setDraft({ ...draft, privacy_mode: p.key })}
                    style={[styles.privCard, active && styles.privCardActive]}
                    testID={`privacy-${p.key}`}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontFamily: font.bodySemibold, fontSize: 15 }}>{p.label}</Text>
                      <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 4 }}>{p.help}</Text>
                    </View>
                    {active && <Check size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}

              {/* (Apr 2026) Premium privacy mode + upgrade banner removed —
                  paid content lives in the Marketplace tab. */}

              <Text style={styles.subSectionLabel}>Coordinate display</Text>
              <View style={styles.chipRow}>
                {[
                  { k: 'exact', l: 'Exact' },
                  { k: 'approximate', l: 'Approximate (~1km)' },
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
                Approximate mode still shows the city and state so other photographers can plan
                trips — only the exact pin is fuzzed by ~1km. Use it for fragile environments
                (bluebonnet fields, nesting grounds, fragile overlooks).
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
      {/* Park-Based Multi-Spot Workflow (Phase 2) */}
      <ParkPickerSheet
        visible={parkPickerOpen}
        onClose={() => setParkPickerOpen(false)}
        onPick={(park) => {
          setSelectedPark(park);
          setLocationType('park_child');
        }}
        nearLat={draft.latitude ?? null}
        nearLng={draft.longitude ?? null}
        defaultCity={draft.city}
        defaultState={draft.state}
        defaultCountryCode={undefined}
        initialQuery={draft.landmark || ''}
      />
      <PostSaveSpotSheet
        visible={postSaveOpen}
        parkName={lastSubmittedSpot?.park_name || null}
        parkId={lastSubmittedSpot?.park_id || null}
        newSpotId={lastSubmittedSpot?.spot_id || null}
        // Phase 2 — preview card + tier-aware upgrade nudge
        spotTitle={lastSubmittedSpot?.title || null}
        spotCity={lastSubmittedSpot?.city || null}
        spotState={lastSubmittedSpot?.state || null}
        coverImageUrl={
          lastSubmittedSpot?.cover_url
            ? resolveImageUrl(lastSubmittedSpot.cover_url)
            : null
        }
        visibilityStatus={lastSubmittedSpot?.visibility_status || null}
        userTier={effectiveTier(user as any)}
        onViewMyUploads={() => {
          setPostSaveOpen(false);
          router.push('/(tabs)/profile' as any);
        }}
        onUpgradePress={() => {
          setPostSaveOpen(false);
          router.push('/paywall?reason=uploads' as any);
        }}
        onClose={() => setPostSaveOpen(false)}
        onAddAnother={() => {
          // Phase 2 — drop the user back into Fast Add for a tight loop.
          setPostSaveOpen(false);
          setDraft({ ...initialDraft });
          setStep(-1);
        }}
        onViewPark={() => {
          setPostSaveOpen(false);
          if (lastSubmittedSpot?.park_id) {
            router.push(`/park/${lastSubmittedSpot.park_id}` as any);
          }
        }}
        onViewSpot={() => {
          setPostSaveOpen(false);
          if (lastSubmittedSpot?.spot_id) {
            router.push(`/spot/${lastSubmittedSpot.spot_id}` as any);
          }
        }}
        onSaveAndClose={() => {
          setPostSaveOpen(false);
          setDraft(initialDraft);
          setStep(-1);
          setSelectedPark(null);
          setLocationType('standalone');
          router.replace('/(tabs)');
        }}
        onEndSession={async () => {
          try { await api.delete('/me/park-session'); } catch {}
          setActiveSession(null);
          setSessionPark(null);
          setSelectedPark(null);
          setLocationType('standalone');
          setPostSaveOpen(false);
          setDraft(initialDraft);
          setStep(-1);
          router.replace('/(tabs)');
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
  // May 2026 — removed `marginLeft: 'auto'` so the confidence chip
  // sits NEXT to the "Current location" kicker on the left side of
  // the row. Previously the chip was pushed to the far right, where
  // the absolutely-positioned `changeBtn` (top/right) overlaps and
  // visually collided with it on the Location step (mobile capture).
  // The kicker row already uses `gap: 8` so the chip naturally
  // breathes from the kicker without any extra spacing.
  confChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: 'rgba(34,197,94,0.12)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)' },
  confChipTxt: { color: colors.success, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.3, textTransform: 'uppercase' },
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

  // "Take photo now" — on-site capture card
  takePhotoCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.45)',
    borderRadius: radii.lg,
  },
  takePhotoIconWrap: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  takePhotoTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  takePhotoSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 2, lineHeight: 15 },
  onSitePill: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: colors.primary,
  },
  onSitePillTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.3 },
  gpsChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderRadius: radii.pill,
    borderWidth: 1, borderColor: 'rgba(34,197,94,0.4)',
  },
  gpsChipTxt: { color: '#16a34a', fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.2 },

  imgGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  imgWrap: { width: '31%', aspectRatio: 1, position: 'relative', borderRadius: radii.md, overflow: 'hidden' },
  // Apr 2026 — featured-photo polish: 2px gold border + soft shadow on the
  // chosen cover thumbnail so creators can see the selection at a glance.
  imgWrapFeatured: {
    borderWidth: 2,
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
  },
  imgThumb: { width: '100%', height: '100%', borderRadius: radii.md },
  coverBadge: {
    position: 'absolute', bottom: 6, left: 6,
    backgroundColor: colors.primary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.sm,
  },
  coverTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.4 },
  // Subtle "Tap to feature" hint on non-featured thumbnails. Disappears
  // the moment the user taps another image — instant gold-border swap.
  tapToFeatureHint: {
    position: 'absolute', bottom: 6, left: 6, right: 6,
    paddingHorizontal: 6, paddingVertical: 3,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radii.sm,
    alignItems: 'center',
  },
  tapToFeatureTxt: {
    color: 'rgba(255,255,255,0.85)',
    fontFamily: font.bodyMedium,
    fontSize: 9,
    letterSpacing: 0.3,
  },
  galleryHint: {
    color: colors.textTertiary,
    fontFamily: font.body,
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
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
  // ─── Park-Based Multi-Spot Workflow (Phase 2) ──────────────────────
  sessionBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 12, borderRadius: radii.md,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.45)',
  },
  sessionIcon: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(245,166,35,0.20)',
    alignItems: 'center', justifyContent: 'center',
  },
  sessionTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  sessionSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
  sessionBtnRow: { flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  sessionPrimary: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  sessionPrimaryTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 12 },
  sessionGhost: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill,
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  sessionGhostTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },

  typeRow: { flexDirection: 'row', gap: 8 },
  typeCard: {
    flex: 1, gap: 4, padding: 12, borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
  },
  typeCardOn: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(245,166,35,0.08)',
  },
  typeTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13, marginTop: 2 },
  typeSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },

  parkPickedCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  parkPickedIcon: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(245,166,35,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  parkPickedLabel: { color: colors.textTertiary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase' },
  parkPickedName: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  parkPickedMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },
  parkPickedChange: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 12 },

  // Phase 6 — pending offline drafts banner
  draftsBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: space.lg, marginTop: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.md,
    backgroundColor: 'rgba(245,166,35,0.10)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(245,166,35,0.40)',
  },
  draftsIcon: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(245,166,35,0.20)',
    alignItems: 'center', justifyContent: 'center',
  },
  draftsTxt: { flex: 1, color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },
  draftsBtn: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  draftsBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 11 },

  // ──────────────────────────────────────────────────────────────
  // Phase 1 Fast Add — single-screen quick-submit styles (Jun 2026)
  // Scoped under `fast*` so they never collide with the existing
  // detailed-flow styles above.
  // ──────────────────────────────────────────────────────────────
  fastHero: { color: colors.text, fontFamily: font.display, fontSize: 28, letterSpacing: -0.5 },
  fastSub:  { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, marginTop: 4, lineHeight: 19 },
  fastSection: { gap: 8 },
  fastLabel: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13, letterSpacing: 0.2 },
  fastLabelOptional: { color: colors.textTertiary, fontFamily: font.body, fontSize: 12 },
  fastHelp: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  fastError: { color: colors.secondary, fontFamily: font.body, fontSize: 12 },
  fastPhotoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, borderRadius: radii.md,
    backgroundColor: colors.primary,
    minHeight: 48,
  },
  fastPhotoBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },
  fastPhotoBtnSecondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    minHeight: 44,
  },
  fastPhotoBtnSecondaryTxt: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  fastThumb: { width: 100, height: 100, borderRadius: 12, overflow: 'hidden', position: 'relative' },
  fastThumbImg: { width: '100%', height: '100%' },
  fastThumbRemove: {
    position: 'absolute', top: 6, right: 6,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center',
  },
  fastThumbAdd: {
    width: 100, height: 100, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  fastThumbAddTxt: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  fastPinCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  fastPinIconWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  fastPinPrimary: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 13 },
  fastPinMeta: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  fastPinBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    minHeight: 44,
  },
  fastPinBtnTxt: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  // Phase 2 — Smart Pin styles (Jun 2026)
  fastPinBtnPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: radii.md,
    backgroundColor: colors.primary,
    minHeight: 48,
  },
  fastPinBtnPrimaryTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },
  fastPinAccuracyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  fastAccBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.pill,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  fastAccDot: { width: 6, height: 6, borderRadius: 3 },
  fastAccBadgeTxt: { fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.4 },
  fastPinWarn: { color: colors.warning, fontFamily: font.body, fontSize: 11, marginTop: 4 },
  fastPinActionsRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  fastPinChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill,
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  fastPinChipTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 11 },
  fastProgressBar: {
    marginTop: 6, height: 4, borderRadius: 2, overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  fastProgressBarFill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
  fastChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fastProgressCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: radii.md,
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.30)',
  },
  fastProgressTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 13 },
  fastDetailsBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 12, borderRadius: radii.md,
    backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    minHeight: 44,
  },
  fastDetailsBtnTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13 },
  fastDiscardTxt: { color: colors.secondary, fontFamily: font.bodyMedium, fontSize: 12, textAlign: 'center', paddingVertical: 8 },
  draftRestoredBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 10, borderRadius: radii.md,
    backgroundColor: 'rgba(245,166,35,0.08)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.25)',
  },
  draftRestoredTxt: { flex: 1, color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },
  draftRestoredDiscard: { color: colors.secondary, fontFamily: font.bodyBold, fontSize: 12 },
  // Phase 3 (Jun 2026) — Free-tier upload-count nudge on Fast Add.
  fastUpgradeNudge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, paddingHorizontal: 10, borderRadius: radii.md,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.40)',
  },
  fastUpgradeNudgeTxt: { flex: 1, color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },
});
