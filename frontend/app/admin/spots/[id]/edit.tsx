/**
 * /admin/spots/[id]/edit — Phase admin overhaul follow-up (Jun 2025).
 *
 * Premium "Edit Location" screen for Admin / Super Admin. Saves all
 * narrative + metadata fields in a single PATCH /admin/spots/<id>/info
 * round-trip. Per-field audit logging happens server-side.
 *
 * Surgical by design:
 *   • Title, descriptions, narrative notes, best-time enum, two 1-5
 *     ratings, permit flag + notes — that's it.
 *   • Images, gallery order, coords, owner, status, slug, save count
 *     are NOT editable here (use the existing /cover endpoint or
 *     dedicated screens).
 *   • Save button is disabled until at least one field is dirty.
 *   • On save: green confirmation + router.back().
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable,
  ActivityIndicator, Alert, Switch, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Save, AlertTriangle, Check } from 'lucide-react-native';
import { Layers } from 'lucide-react-native';
import { api, formatApiError } from '../../../../src/api';
import { colors, font, space, radii } from '../../../../src/theme';
import { FormField } from '../../../../src/components/FormField';
import { useKeyboardHeight } from '../../../../src/hooks/useKeyboardHeight';
import ParkPickerSheet, { ParkSummary } from '../../../../src/components/ParkPickerSheet';

const BEST_TIMES: { key: string; label: string }[] = [
  { key: 'sunrise',     label: 'Sunrise' },
  { key: 'morning',     label: 'Morning' },
  { key: 'midday',      label: 'Midday' },
  { key: 'afternoon',   label: 'Afternoon' },
  { key: 'golden_hour', label: 'Golden Hour' },
  { key: 'sunset',      label: 'Sunset' },
  { key: 'blue_hour',   label: 'Blue Hour' },
  { key: 'evening',     label: 'Evening' },
  { key: 'night',       label: 'Night' },
];

const CAP_TITLE       = 120;
const CAP_SHORT       = 280;
const CAP_DESCRIPTION = 4000;
const CAP_NOTE_SHORT  = 800;
const CAP_TIPS        = 1500;

type SpotShape = {
  spot_id?: string;
  title?: string | null;
  description?: string | null;
  short_description?: string | null;
  best_time_of_day?: string | null;
  parking_notes?: string | null;
  access_notes?: string | null;
  safety_notes?: string | null;
  crowd_notes?: string | null;
  creator_tips?: string | null;
  permit_required?: boolean;
  permit_notes?: string | null;
  crowd_level?: number | null;
  safety_rating?: number | null;
  city?: string | null;
};

export default function AdminSpotEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const spotId = String(id || '');
  const kbHeight = useKeyboardHeight();

  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [topErr,  setTopErr]  = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const [initial, setInitial] = useState<SpotShape | null>(null);

  // Local form state (strings + null/bool/number)
  const [title,    setTitle]    = useState('');
  const [shortD,   setShortD]   = useState('');
  const [desc,     setDesc]     = useState('');
  const [creatorTips, setCreatorTips] = useState('');
  const [bestTime, setBestTime] = useState<string | null>(null);
  const [parking,  setParking]  = useState('');
  const [access,   setAccess]   = useState('');
  const [safety,   setSafety]   = useState('');
  const [crowd,    setCrowd]    = useState('');
  const [permitReq, setPermitReq] = useState(false);
  const [permitNotes, setPermitNotes] = useState('');
  const [crowdLevel,  setCrowdLevel]  = useState<number | null>(null);
  const [safetyRating, setSafetyRating] = useState<number | null>(null);

  // Phase 5 — parent park linkage (separate flow from PATCH /info)
  const [parkGroupId, setParkGroupId] = useState<string | null>(null);
  const [parkName, setParkName] = useState<string | null>(null);
  const [parkPickerOpen, setParkPickerOpen] = useState(false);
  const [parkBusy, setParkBusy] = useState(false);
  const [parkPin, setParkPin] = useState<{ lat?: number; lng?: number }>({});

  const seed = (s: SpotShape) => {
    setInitial(s);
    setTitle(s.title || '');
    setShortD(s.short_description || '');
    setDesc(s.description || '');
    setCreatorTips(s.creator_tips || '');
    setBestTime(s.best_time_of_day || null);
    setParking(s.parking_notes || '');
    setAccess(s.access_notes || '');
    setSafety(s.safety_notes || '');
    setCrowd(s.crowd_notes || '');
    setPermitReq(!!s.permit_required);
    setPermitNotes(s.permit_notes || '');
    setCrowdLevel(typeof s.crowd_level === 'number' ? s.crowd_level : null);
    setSafetyRating(typeof s.safety_rating === 'number' ? s.safety_rating : null);
    setParkGroupId((s as any).park_group_id || null);
    setParkName((s as any).park_name || null);
    setParkPin({
      lat: typeof (s as any).latitude === 'number' ? (s as any).latitude : undefined,
      lng: typeof (s as any).longitude === 'number' ? (s as any).longitude : undefined });
  };

  // Preload spot via existing admin endpoint — returns the full doc.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get(`/admin/spots/${spotId}/cover-editor`);
        const spot: SpotShape = r?.spot || {};
        if (alive) seed(spot);
      } catch (e) {
        Alert.alert('Could not load spot', formatApiError(e));
        router.back();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [spotId]);

  // ── Dirty + payload ──────────────────────────────────────────────
  const payload = useMemo(() => {
    if (!initial) return null;
    const body: Record<string, any> = {};
    const same = (a: any, b: any) => (a ?? '') === (b ?? '');
    if (!same(title.trim(),         initial.title))             body.title             = title.trim();
    if (!same(shortD.trim(),        initial.short_description)) body.short_description = shortD.trim();
    if (!same(desc.trim(),          initial.description))       body.description       = desc.trim();
    if (!same(creatorTips.trim(),   initial.creator_tips))      body.creator_tips      = creatorTips.trim();
    if (!same(bestTime || '',       initial.best_time_of_day || '')) body.best_time_of_day = bestTime;
    if (!same(parking.trim(),       initial.parking_notes))     body.parking_notes     = parking.trim();
    if (!same(access.trim(),        initial.access_notes))      body.access_notes      = access.trim();
    if (!same(safety.trim(),        initial.safety_notes))      body.safety_notes      = safety.trim();
    if (!same(crowd.trim(),         initial.crowd_notes))       body.crowd_notes       = crowd.trim();
    if (Boolean(initial.permit_required) !== permitReq)         body.permit_required   = permitReq;
    if (!same(permitNotes.trim(),   initial.permit_notes))      body.permit_notes      = permitNotes.trim();
    if ((crowdLevel ?? null)   !== (initial.crowd_level ?? null))   body.crowd_level   = crowdLevel;
    if ((safetyRating ?? null) !== (initial.safety_rating ?? null)) body.safety_rating = safetyRating;
    return body;
  }, [initial, title, shortD, desc, creatorTips, bestTime, parking, access, safety, crowd, permitReq, permitNotes, crowdLevel, safetyRating]);

  const isDirty = !!payload && Object.keys(payload).length > 0;

  const titleErr = title.trim().length < 3 ? 'Name cannot be empty (min 3 characters).' : null;
  const titleTooLong = title.length > CAP_TITLE ? `Name must be ${CAP_TITLE} chars or fewer.` : null;

  // ── Save handler ─────────────────────────────────────────────────
  const onSave = useCallback(async () => {
    setTopErr(null);
    setSavedNote(null);
    if (!isDirty) return;
    if (titleErr || titleTooLong) { setTopErr(titleErr || titleTooLong); return; }
    setSaving(true);
    try {
      const r = await api.patch(`/admin/spots/${spotId}/info`, payload);
      const changed: string[] = r?.changed || [];
      seed(r?.spot || {});
      setSavedNote(`Saved ${changed.length} field${changed.length === 1 ? '' : 's'}.`);
      // brief confirmation then bounce back
      setTimeout(() => router.back(), 900);
    } catch (e) {
      setTopErr(formatApiError(e) || "We couldn't save the changes.");
    } finally {
      setSaving(false);
    }
  }, [isDirty, payload, spotId, titleErr, titleTooLong]);

  const onCancel = useCallback(() => {
    if (!isDirty) { router.back(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved edits to this location.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard',      style: 'destructive', onPress: () => router.back() },
      ],
    );
  }, [isDirty]);

  if (loading) {
    return (
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <View style={s.head}>
        <TouchableOpacity onPress={onCancel} style={s.backBtn} testID="edit-cancel">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>Edit location</Text>
        <TouchableOpacity
          onPress={onSave}
          disabled={!isDirty || !!titleErr || !!titleTooLong || saving}
          style={[s.saveBtn, (!isDirty || !!titleErr || !!titleTooLong || saving) && { opacity: 0.45 }]}
          testID="edit-save"
        >
          {saving ? <ActivityIndicator color={colors.textInverse} size="small" />
                  : <><Save size={13} color={colors.textInverse} /><Text style={s.saveTxt}>Save</Text></>}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[
            s.scrollBody,
            Platform.OS === 'android' && kbHeight > 0 ? { paddingBottom: kbHeight + space.xxxl } : null,
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {topErr ? (
            <View style={s.errBanner} testID="edit-err">
              <AlertTriangle size={13} color={colors.secondary} />
              <Text style={s.errBannerTxt}>{topErr}</Text>
            </View>
          ) : null}
          {savedNote ? (
            <View style={s.okBanner} testID="edit-ok">
              <Check size={13} color={colors.success} />
              <Text style={s.okBannerTxt}>{savedNote}</Text>
            </View>
          ) : null}

          {/* IDENTITY */}
          <SectionLabel>Identity</SectionLabel>
          <FormField
            label="Location name"
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. McKinney Falls — Lower Cascade"
            required
            error={titleErr || titleTooLong}
            helper={`${title.length} / ${CAP_TITLE}`}
            testID="edit-title"
          />
          <FormField
            label="Short description"
            value={shortD}
            onChangeText={setShortD}
            placeholder="One-line teaser for cards and previews."
            multiline
            numberOfLines={2}
            helper={`${shortD.length} / ${CAP_SHORT}`}
            testID="edit-short"
          />

          {/* FULL DESCRIPTION */}
          <SectionLabel>Description</SectionLabel>
          <FormField
            label="Full description"
            value={desc}
            onChangeText={setDesc}
            placeholder="Set the scene — light, vantage points, mood."
            multiline
            numberOfLines={6}
            helper={`${desc.length} / ${CAP_DESCRIPTION}`}
            testID="edit-description"
          />

          {/* CREATOR TIPS */}
          <SectionLabel>Creator tips</SectionLabel>
          <FormField
            label="Tips & notes"
            value={creatorTips}
            onChangeText={setCreatorTips}
            placeholder="Gear, settings, sequencing — what a first-time visitor should know."
            multiline
            numberOfLines={4}
            helper={`${creatorTips.length} / ${CAP_TIPS}`}
            testID="edit-tips"
          />

          {/* FIELD GUIDE */}
          <SectionLabel>Field guide</SectionLabel>

          {/* Best time of day — chip row */}
          <Text style={s.miniLabel}>Best time of day</Text>
          <View style={s.chipWrap}>
            {BEST_TIMES.map((b) => {
              const on = bestTime === b.key;
              return (
                <Pressable
                  key={b.key}
                  onPress={() => setBestTime(on ? null : b.key)}
                  style={[s.chip, on && s.chipOn]}
                  testID={`edit-best-${b.key}`}
                >
                  <Text style={[s.chipTxt, on && s.chipTxtOn]}>{b.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <FormField
            label="Parking"
            value={parking}
            onChangeText={setParking}
            placeholder="Where to park. Fees, walks, gates."
            multiline numberOfLines={3}
            helper={`${parking.length} / ${CAP_NOTE_SHORT}`}
            testID="edit-parking"
          />
          <FormField
            label="Access"
            value={access}
            onChangeText={setAccess}
            placeholder="Trail length, terrain, gear advice."
            multiline numberOfLines={3}
            helper={`${access.length} / ${CAP_NOTE_SHORT}`}
            testID="edit-access"
          />
          <FormField
            label="Safety"
            value={safety}
            onChangeText={setSafety}
            placeholder="Currents, wildlife, slippery rocks, etc."
            multiline numberOfLines={3}
            helper={`${safety.length} / ${CAP_NOTE_SHORT}`}
            testID="edit-safety"
          />
          <FormField
            label="Crowds"
            value={crowd}
            onChangeText={setCrowd}
            placeholder="Busiest days/times, how to avoid them."
            multiline numberOfLines={3}
            helper={`${crowd.length} / ${CAP_NOTE_SHORT}`}
            testID="edit-crowdnotes"
          />

          {/* Permit toggle */}
          <View style={s.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.toggleLabel}>Permit required</Text>
              <Text style={s.toggleSub}>Toggle on if visitors need a paid or applied-for permit.</Text>
            </View>
            <Switch
              value={permitReq}
              onValueChange={setPermitReq}
              trackColor={{ false: '#1f1f1f', true: colors.primary }}
              thumbColor={permitReq ? '#fff' : '#777'}
              testID="edit-permitreq"
            />
          </View>
          {permitReq ? (
            <FormField
              label="Permit notes"
              value={permitNotes}
              onChangeText={setPermitNotes}
              placeholder="Where to apply, cost, lead time."
              multiline numberOfLines={3}
              helper={`${permitNotes.length} / ${CAP_NOTE_SHORT}`}
              testID="edit-permitnotes"
            />
          ) : null}

          {/* Ratings */}
          <Text style={s.miniLabel}>Crowd level</Text>
          <RatingRow value={crowdLevel} onChange={setCrowdLevel} testIDPrefix="edit-crowd" />

          <Text style={s.miniLabel}>Safety rating</Text>
          <RatingRow value={safetyRating} onChange={setSafetyRating} testIDPrefix="edit-safety-rating" />

          {/* Phase 5 — Parent park linkage. Independent of the PATCH
              /info save flow (uses POST /admin/spots/{id}/park). */}
          <SectionLabel>Parent park</SectionLabel>
          <View style={s.parkCard}>
            <View style={s.parkIcon}>
              <Layers size={15} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              {parkGroupId && parkName ? (
                <>
                  <Text style={s.parkLabel}>Linked to</Text>
                  <Text style={s.parkName} numberOfLines={1}>{parkName}</Text>
                </>
              ) : (
                <>
                  <Text style={s.parkLabel}>Standalone</Text>
                  <Text style={s.parkHint}>Not currently part of a park.</Text>
                </>
              )}
            </View>
            <TouchableOpacity
              style={s.parkBtn}
              onPress={() => setParkPickerOpen(true)}
              disabled={parkBusy}
              testID="edit-park-change"
            >
              <Text style={s.parkBtnTxt}>{parkGroupId ? 'Move' : 'Add'}</Text>
            </TouchableOpacity>
            {parkGroupId ? (
              <TouchableOpacity
                style={[s.parkBtn, { marginLeft: 6 }]}
                onPress={async () => {
                  setParkBusy(true);
                  try {
                    await api.post(`/admin/spots/${spotId}/park`, { park_group_id: null });
                    setParkGroupId(null);
                    setParkName(null);
                  } catch (e) {
                    Alert.alert('Could not unlink', formatApiError(e));
                  } finally {
                    setParkBusy(false);
                  }
                }}
                disabled={parkBusy}
                testID="edit-park-unlink"
              >
                <Text style={s.parkBtnTxt}>Remove</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <ParkPickerSheet
        visible={parkPickerOpen}
        onClose={() => setParkPickerOpen(false)}
        onPick={async (p: ParkSummary) => {
          setParkBusy(true);
          try {
            const r = await api.post(`/admin/spots/${spotId}/park`, { park_group_id: p.park_id });
            setParkGroupId(r.park_group_id || p.park_id);
            setParkName(r.park_name || p.name);
          } catch (e) {
            Alert.alert('Could not move spot', formatApiError(e));
          } finally {
            setParkBusy(false);
          }
        }}
        nearLat={parkPin.lat ?? null}
        nearLng={parkPin.lng ?? null}
      />
    </SafeAreaView>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={s.sectionLabel}>{children}</Text>;
}

function RatingRow({
  value, onChange, testIDPrefix }: { value: number | null; onChange: (v: number | null) => void; testIDPrefix: string }) {
  return (
    <View style={s.ratingRow}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value === n;
        return (
          <Pressable
            key={n}
            onPress={() => onChange(on ? null : n)}
            style={[s.rating, on && s.ratingOn]}
            testID={`${testIDPrefix}-${n}`}
          >
            <Text style={[s.ratingTxt, on && s.ratingTxtOn]}>{n}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  head: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.lg, paddingVertical: 8, gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: colors.text, fontFamily: font.display, fontSize: 18, letterSpacing: -0.3 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.sm,
    backgroundColor: colors.primary, minHeight: 32 },
  saveTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 12 },

  scrollBody: { padding: space.lg, paddingBottom: space.xxxl, gap: 14 },

  sectionLabel: {
    marginTop: 8,
    color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11 },
  miniLabel: {
    color: colors.text, fontFamily: font.bodySemibold, fontSize: 13,
    marginTop: 2, marginBottom: 6 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    minHeight: 30, justifyContent: 'center' },
  chipOn: { backgroundColor: 'rgba(245,166,35,0.16)', borderColor: colors.primary },
  chipTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },
  chipTxtOn: { color: colors.primary, fontFamily: font.bodyBold },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: space.md, paddingVertical: 12,
    backgroundColor: colors.surface1,
    borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
  toggleLabel: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  toggleSub:   { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 2, lineHeight: 15 },

  ratingRow: { flexDirection: 'row', gap: 8 },
  rating: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: radii.sm,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border },
  ratingOn: { backgroundColor: 'rgba(245,166,35,0.18)', borderColor: colors.primary },
  ratingTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  ratingTxtOn: { color: colors.primary },

  errBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: space.md, paddingVertical: 10,
    backgroundColor: 'rgba(208,72,72,0.10)',
    borderWidth: 1, borderColor: 'rgba(208,72,72,0.35)',
    borderRadius: radii.md },
  errBannerTxt: { color: colors.secondary, fontFamily: font.bodyMedium, fontSize: 12, flex: 1 },
  okBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: space.md, paddingVertical: 10,
    backgroundColor: 'rgba(16,185,129,0.10)',
    borderWidth: 1, borderColor: 'rgba(16,185,129,0.35)',
    borderRadius: radii.md },
  okBannerTxt: { color: colors.success, fontFamily: font.bodyMedium, fontSize: 12, flex: 1 },
  // Phase 5 — parent park linkage card
  parkCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    marginTop: 6 },
  parkIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(245,166,35,0.16)',
    alignItems: 'center', justifyContent: 'center' },
  parkLabel: { color: colors.textTertiary, fontFamily: font.bodyBold, fontSize: 10 },
  parkName: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14, marginTop: 1 },
  parkHint: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 1 },
  parkBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  parkBtnTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 11 } });
