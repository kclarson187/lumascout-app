import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, TextInput, Alert, ActivityIndicator, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ImagePlus, X, Camera } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../../../src/api';
import { uploadImageAssets } from '../../../src/utils/upload-image';
import { resolveImageUrl } from '../../../src/utils/image-url';
import { colors, font, space, radii } from '../../../src/theme';
import { CONDITION_TAGS } from '../../../src/components/FreshnessBits';
import KeyboardSafe from '../../../src/components/KeyboardSafe';

export default function UploadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const spotId = String(id || '');
  const [photos, setPhotos] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<'public' | 'followers'>('public');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const pickPhotos = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access to share photos of this spot.');
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      // CRITICAL (Apr 2026): base64=false — we now upload the picked
      // file via multipart to /api/uploads/image and store only the
      // short hosted URL in Mongo. This single change shrinks spot
      // documents by ~3-5 MB per image and unblocks the cover editor
      // which was timing out on base64-heavy payloads.
      base64: false,
      quality: 0.85,
      selectionLimit: Math.max(1, 12 - photos.length),
    });
    if (r.canceled || !r.assets?.length) return;
    setUploading(true);
    try {
      const uploaded = await uploadImageAssets(
        r.assets.map((a) => ({ uri: a.uri, mimeType: a.mimeType, fileName: a.fileName })),
      );
      const urls = uploaded.map((u) => u.image_url);
      setPhotos((prev) => [...prev, ...urls].slice(0, 12));
    } catch (e: any) {
      // Map upload-image.ts error categories to specific user-facing
      // titles + bodies. The previous "Upload failed / Upload failed"
      // duplicate alert is replaced with category-aware messaging that
      // tells the user WHAT went wrong and HOW to fix it.
      const name = e?.name || '';
      const body = e?.message || 'Could not upload one or more photos. Please try again.';
      let title = 'Photo upload issue';
      if (name === 'TimeoutError') title = 'Upload timed out';
      else if (name === 'NetworkError') title = 'No connection';
      else if (name === 'AuthError') title = 'Session expired';
      else if (name === 'PayloadTooLargeError') title = 'Photo too large';
      else if (name === 'UnsupportedMediaError') title = 'Format not supported';
      else if (name === 'RateLimitError') title = 'Slow down a moment';
      else if (name === 'ServerError') title = 'Server hiccup';
      Alert.alert(title, body);
    } finally {
      setUploading(false);
    }
  };

  const toggleTag = (k: string) => {
    setTags((prev) => {
      if (prev.includes(k)) return prev.filter((t) => t !== k);
      if (prev.length >= 6) return prev; // cap matches backend
      return [...prev, k];
    });
  };

  const removePhoto = (idx: number) => setPhotos((prev) => prev.filter((_, i) => i !== idx));

  const canSubmit = photos.length > 0 && !submitting && !uploading;

  // Tap-spam guard — multiple rapid Post-photos taps share a single
  // in-flight POST so we never insert duplicate batches.
  const submitInflightRef = useRef<Promise<any> | null>(null);

  const submit = async () => {
    if (!canSubmit) return;
    if (submitInflightRef.current) {
      try { await submitInflightRef.current; } catch {}
      return;
    }
    setSubmitting(true);
    const promise = api.post(`/spots/${spotId}/uploads`, {
      images: photos.map((u) => ({ image_url: u, caption: null })),
      caption: caption.trim() || null,
      condition_tags: tags,
      visibility,
    }, { timeout: 25000 });
    submitInflightRef.current = promise;
    try {
      const res = await promise;
      // Invalidate Explore list cache so freshness ranking re-fetches
      // on next visit (this spot just got fresh photos which may bump
      // its score / position).
      try {
        const { invalidateCachePrefix } = await import('../../../src/utils/swrCache');
        await invalidateCachePrefix('explore.list:v1');
      } catch {}
      Alert.alert(
        res?.auto_approved ? 'Posted!' : 'Submitted for review',
        res?.message || 'Thanks for contributing — your photos help keep this spot alive.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (e: any) {
      // Categorize submission errors. Per spec, do NOT log the user
      // out for upload timeout/failure/4xx/5xx — only confirmed 401/403
      // (which the api.ts axios interceptor already owns) clears auth.
      const status = Number(e?.response?.status || e?.status || 0);
      const isTimeout = e?.code === 'ECONNABORTED' || /timeout/i.test(e?.message || '');
      let title = 'Couldn\'t post photos';
      let body = e?.response?.data?.detail || e?.message || 'Please try again.';
      if (isTimeout) {
        title = 'Taking longer than usual';
        body = 'Photo post timed out. Please try again.';
      } else if (status === 401 || status === 403) {
        title = 'Session expired';
        body = 'Please log in again to post photos.';
      } else if (status === 404) {
        title = 'Spot no longer available';
        body = 'This location has been removed and can\'t accept new photos.';
      } else if (status === 410) {
        title = 'Spot deleted';
        body = 'This location no longer exists.';
      } else if (status === 413) {
        title = 'Too many or too large';
        body = 'Try fewer photos or smaller images.';
      } else if (status >= 500) {
        title = 'Server hiccup';
        body = 'Something on our end is being slow. Tap Post again — it usually works.';
      }
      // Structured client log for production grep.
      try {
        // eslint-disable-next-line no-console
        console.warn('[spot-upload]', { status, name: e?.name, message: e?.message });
      } catch {}
      Alert.alert(title, body);
    } finally {
      submitInflightRef.current = null;
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="upload-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Add Recent Photos</Text>
          <Text style={styles.title}>Keep this spot alive</Text>
        </View>
      </View>
      <KeyboardSafe style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: space.xxxl + 40, paddingHorizontal: space.xl, gap: space.lg }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Photo picker */}
          <View style={{ gap: space.sm }}>
            <Text style={styles.sectionTitle}>Photos <Text style={styles.req}>·  up to 12</Text></Text>
            <View style={styles.gridWrap}>
              {photos.map((uri, i) => (
                <View key={uri + i} style={styles.tileWrap}>
                  <Image source={{ uri: resolveImageUrl(uri) }} style={styles.tileImg} />
                  <TouchableOpacity onPress={() => removePhoto(i)} style={styles.tileClose} testID={`remove-photo-${i}`}>
                    <X size={14} color={colors.textInverse} />
                  </TouchableOpacity>
                </View>
              ))}
              {photos.length < 12 ? (
                <TouchableOpacity onPress={pickPhotos} disabled={uploading} style={[styles.tileAdd, uploading && { opacity: 0.6 }]} testID="pick-photos">
                  {uploading ? <ActivityIndicator color={colors.primary} /> : <ImagePlus size={22} color={colors.primary} />}
                  <Text style={styles.tileAddTxt}>
                    {uploading ? 'Uploading…' : (photos.length === 0 ? 'Select photos' : 'Add more')}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {/* Caption */}
          <View style={{ gap: space.sm }}>
            <Text style={styles.sectionTitle}>Caption <Text style={styles.optional}>(optional)</Text></Text>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder="Bluebonnets still blooming today, light was soft at 7pm…"
              placeholderTextColor={colors.textTertiary}
              multiline
              style={styles.captionInput}
              maxLength={500}
              testID="upload-caption"
            />
          </View>

          {/* Condition tags */}
          <View style={{ gap: space.sm }}>
            <Text style={styles.sectionTitle}>Conditions <Text style={styles.optional}>(tap up to 6)</Text></Text>
            <View style={styles.tagsGrid}>
              {CONDITION_TAGS.map((t) => {
                const selected = tags.includes(t.key);
                const Icon = t.Icon;
                return (
                  <Pressable
                    key={t.key}
                    onPress={() => toggleTag(t.key)}
                    style={[
                      styles.tagChip,
                      selected && { backgroundColor: t.color + '22', borderColor: t.color },
                    ]}
                    testID={`tag-${t.key}`}
                  >
                    <Icon size={13} color={selected ? t.color : colors.textSecondary} />
                    <Text style={[styles.tagChipTxt, selected && { color: t.color, fontFamily: font.bodySemibold }]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={{ gap: space.sm }}>
            <Text style={styles.sectionTitle}>Who can see this?</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={() => setVisibility('public')}
                style={[styles.visOpt, visibility === 'public' && styles.visOptActive]}
                testID="vis-public"
              >
                <Text style={[styles.visTitle, visibility === 'public' && { color: colors.primary }]}>🌎 Public</Text>
                <Text style={styles.visSub}>Shows on the spot for everyone.</Text>
              </Pressable>
              <Pressable
                onPress={() => setVisibility('followers')}
                style={[styles.visOpt, visibility === 'followers' && styles.visOptActive]}
                testID="vis-followers"
              >
                <Text style={[styles.visTitle, visibility === 'followers' && { color: colors.primary }]}>👥 Followers</Text>
                <Text style={styles.visSub}>Only people who follow you can see this.</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>

        <View style={styles.submitBar}>
          <TouchableOpacity
            disabled={!canSubmit}
            onPress={submit}
            style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
            testID="upload-submit"
          >
            {submitting ? <ActivityIndicator color={colors.textInverse} /> : (
              <>
                <Camera size={16} color={colors.textInverse} />
                <Text style={styles.submitBtnTxt}>Post {photos.length > 0 ? `${photos.length} photo${photos.length > 1 ? 's' : ''}` : 'photos'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardSafe>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  kicker: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 20 },
  sectionTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  req: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  optional: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  gridWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tileWrap: { width: 92, height: 92, borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.surface1, position: 'relative' },
  tileImg: { width: '100%', height: '100%' },
  tileClose: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  tileAdd: { width: 92, height: 92, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary, backgroundColor: 'rgba(245,166,35,0.06)' },
  tileAddTxt: { color: colors.primary, fontFamily: font.bodyMedium, fontSize: 10, textAlign: 'center', paddingHorizontal: 4 },
  captionInput: { minHeight: 80, padding: 12, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, color: colors.text, fontFamily: font.body, fontSize: 14, textAlignVertical: 'top' },
  tagsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  tagChipTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  // Visibility toggle (Phase 2) — lightweight public/followers split.
  visOpt: { flex: 1, padding: 12, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, gap: 4 },
  visOptActive: { backgroundColor: 'rgba(245,166,35,0.10)', borderColor: colors.primary },
  visTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  visSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  submitBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, paddingBottom: Platform.OS === 'ios' ? space.xl : space.lg, backgroundColor: colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: radii.md, backgroundColor: colors.primary },
  submitBtnDisabled: { backgroundColor: colors.surface2 },
  submitBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },
});
