/**
 * Owner Edit Request form.
 * Route: /spot/[id]/request-edit
 *
 * Allows the uploader of a spot to propose field-level changes that an
 * Admin / Super Admin must approve before going live. Admins see a
 * different button on Spot Detail — they use direct-edit instead.
 *
 * Fields mirror ALLOWED_EDIT_FIELDS in backend/routes/edit_requests.py
 * so the server-side whitelist stays the source of truth.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  Alert, ActivityIndicator, Platform, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { ChevronLeft, Check, Image as ImgIcon } from 'lucide-react-native';
import { api, formatApiError } from '../../../src/api';
import { useAuth } from '../../../src/auth';
import { colors, font, space, radii } from '../../../src/theme';
import KeyboardSafe from '../../../src/components/KeyboardSafe';

export default function RequestEditScreen() {
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const spotId = String(id || '');
  const [spot, setSpot] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reasonNote, setReasonNote] = useState('');

  // Draft values — pre-filled from current spot so the diff is clean.
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [shootTypes, setShootTypes] = useState('');   // comma-separated
  const [bestLightNotes, setBestLightNotes] = useState('');
  const [parkingNotes, setParkingNotes] = useState('');
  const [accessNotes, setAccessNotes] = useState('');
  const [safetyNotes, setSafetyNotes] = useState('');
  const [tips, setTips] = useState('');
  const [featuredImageUrl, setFeaturedImageUrl] = useState<string | null>(null);
  const [photoOrder, setPhotoOrder] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const s = await api.get(`/spots/${spotId}`);
      setSpot(s);
      setTitle(s.title || '');
      setDescription(s.description || '');
      setShootTypes((s.shoot_types || []).join(', '));
      setBestLightNotes(s.best_light_notes || '');
      setParkingNotes(s.parking_notes || '');
      setAccessNotes(s.access_notes || '');
      setSafetyNotes(s.safety_notes || '');
      setTips(s.tips || '');
      setFeaturedImageUrl(s.hero_cover_image_url || (s.images?.[0]?.image_url) || null);
      setPhotoOrder((s.images || []).map((i: any) => i.image_url).filter(Boolean));
    } catch (e: any) {
      Alert.alert('Could not load spot', formatApiError(e), [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } finally { setLoading(false); }
  }, [spotId]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (submitting || !spot) return;
    const changes: Record<string, any> = {};
    if (title.trim() !== (spot.title || '')) changes.title = title.trim();
    if (description.trim() !== (spot.description || '')) changes.description = description.trim();
    const newTags = shootTypes.split(',').map((s) => s.trim()).filter(Boolean);
    if (JSON.stringify(newTags) !== JSON.stringify(spot.shoot_types || [])) changes.shoot_types = newTags;
    if (bestLightNotes.trim() !== (spot.best_light_notes || '')) changes.best_light_notes = bestLightNotes.trim();
    if (parkingNotes.trim() !== (spot.parking_notes || '')) changes.parking_notes = parkingNotes.trim();
    if (accessNotes.trim() !== (spot.access_notes || '')) changes.access_notes = accessNotes.trim();
    if (safetyNotes.trim() !== (spot.safety_notes || '')) changes.safety_notes = safetyNotes.trim();
    if (tips.trim() !== (spot.tips || '')) changes.tips = tips.trim();
    const currentFeatured = spot.hero_cover_image_url || (spot.images?.[0]?.image_url) || null;
    if (featuredImageUrl && featuredImageUrl !== currentFeatured) changes.featured_image_url = featuredImageUrl;
    const currentOrder = (spot.images || []).map((i: any) => i.image_url).filter(Boolean);
    if (JSON.stringify(photoOrder) !== JSON.stringify(currentOrder)) changes.photo_order = photoOrder;

    if (Object.keys(changes).length === 0) {
      Alert.alert('No changes', 'Edit at least one field before submitting.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/spots/${spotId}/edit-request`, {
        changes,
        reason_note: reasonNote.trim() || undefined,
      });
      Alert.alert(
        'Request submitted',
        "Our moderation team will review your changes. You'll get a notification when they're live.",
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e: any) {
      Alert.alert('Could not submit', formatApiError(e));
    } finally { setSubmitting(false); }
  };

  const movePhoto = (url: string, dir: -1 | 1) => {
    setPhotoOrder((prev) => {
      const idx = prev.indexOf(url);
      if (idx < 0) return prev;
      const to = Math.max(0, Math.min(prev.length - 1, idx + dir));
      if (to === idx) return prev;
      const next = [...prev];
      next.splice(idx, 1);
      next.splice(to, 0, url);
      return next;
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={s.root}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }}/>
      </SafeAreaView>
    );
  }

  const hasPending = false; // backend will 409 if duplicate pending — kept simple

  return (
    <SafeAreaView style={s.root} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }}/>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
          <ChevronLeft size={22} color={colors.text}/>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Request edits</Text>
          <Text style={s.headerSub} numberOfLines={1}>{spot?.title || 'Loading…'}</Text>
        </View>
      </View>

      <KeyboardSafe bottomInset={140}>
        <Text style={s.kicker}>WHAT YOU'RE EDITING</Text>
        <Text style={s.help}>Propose changes. An admin will review and approve them before they go live.</Text>

        <Field label="Title" value={title} onChangeText={setTitle}/>
        <Field label="Description" value={description} onChangeText={setDescription} multiline numberOfLines={4}/>
        <Field label="Tags / shoot types (comma-separated)" value={shootTypes} onChangeText={setShootTypes}/>
        <Field label="Best light notes" value={bestLightNotes} onChangeText={setBestLightNotes} multiline numberOfLines={2}/>
        <Field label="Parking notes" value={parkingNotes} onChangeText={setParkingNotes} multiline numberOfLines={2}/>
        <Field label="Access notes" value={accessNotes} onChangeText={setAccessNotes} multiline numberOfLines={2}/>
        <Field label="Safety notes" value={safetyNotes} onChangeText={setSafetyNotes} multiline numberOfLines={2}/>
        <Field label="Tips" value={tips} onChangeText={setTips} multiline numberOfLines={3}/>

        <Text style={[s.kicker, { marginTop: 24 }]}>FEATURED / COVER PHOTO</Text>
        <Text style={s.help}>Tap a photo to request it as the cover. Drag order with ▲/▼.</Text>
        <View style={s.grid}>
          {photoOrder.map((url, i) => {
            const isFeat = url === featuredImageUrl;
            return (
              <View key={url + i} style={s.thumbWrap}>
                <Pressable onPress={() => setFeaturedImageUrl(url)} style={[s.thumb, isFeat && s.thumbFeat]}>
                  <Image source={{ uri: url }} style={s.thumbImg}/>
                  {isFeat && (
                    <View style={s.featTag}><Check size={10} color="#000"/><Text style={s.featTxt}>COVER</Text></View>
                  )}
                </Pressable>
                <View style={s.thumbActions}>
                  <Pressable onPress={() => movePhoto(url, -1)} style={s.thumbArrow}><Text style={s.thumbArrowTxt}>▲</Text></Pressable>
                  <Text style={s.thumbIdx}>{i + 1}</Text>
                  <Pressable onPress={() => movePhoto(url, 1)} style={s.thumbArrow}><Text style={s.thumbArrowTxt}>▼</Text></Pressable>
                </View>
              </View>
            );
          })}
          {photoOrder.length === 0 && (
            <View style={s.noPhotos}><ImgIcon size={18} color={colors.textTertiary}/><Text style={s.noPhotosTxt}>No photos on this spot yet.</Text></View>
          )}
        </View>

        <Field label="Why this edit? (optional)" value={reasonNote} onChangeText={setReasonNote} multiline numberOfLines={3}/>

        <Pressable onPress={submit} disabled={submitting || hasPending} style={[s.submitBtn, (submitting || hasPending) && { opacity: 0.5 }]}>
          {submitting ? <ActivityIndicator color="#000"/> : (
            <>
              <Check size={16} color="#000"/>
              <Text style={s.submitTxt}>Submit for review</Text>
            </>
          )}
        </Pressable>
      </KeyboardSafe>
    </SafeAreaView>
  );
}

function Field({ label, value, onChangeText, multiline, numberOfLines }: any) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        numberOfLines={numberOfLines}
        placeholderTextColor={colors.textTertiary}
        style={[s.input, multiline && { minHeight: 22 * (numberOfLines || 2) + 20, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontFamily: font.display, fontSize: 17 },
  headerSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },
  kicker: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.7, marginTop: 14, paddingHorizontal: space.xl },
  help: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 18, marginTop: 4, paddingHorizontal: space.xl },
  label: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12, marginBottom: 6, paddingHorizontal: space.xl },
  input: { marginHorizontal: space.xl, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontFamily: font.body, fontSize: 14 },
  grid: { paddingHorizontal: space.xl, marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumbWrap: { width: '30%', gap: 4 },
  thumb: { aspectRatio: 1, borderRadius: radii.md, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  thumbFeat: { borderColor: colors.primary },
  thumbImg: { width: '100%', height: '100%' },
  featTag: { position: 'absolute', top: 4, left: 4, backgroundColor: colors.primary, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, flexDirection: 'row', alignItems: 'center', gap: 2 },
  featTxt: { color: '#000', fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.5 },
  thumbActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  thumbArrow: { paddingHorizontal: 6, paddingVertical: 2, backgroundColor: colors.surface2, borderRadius: 4 },
  thumbArrowTxt: { color: colors.text, fontSize: 11 },
  thumbIdx: { color: colors.textTertiary, fontFamily: font.bodyBold, fontSize: 11 },
  noPhotos: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12 },
  noPhotosTxt: { color: colors.textTertiary, fontFamily: font.body, fontSize: 13 },
  submitBtn: { marginHorizontal: space.xl, marginTop: 24, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  submitTxt: { color: '#000', fontFamily: font.bodyBold, fontSize: 15 },
});
