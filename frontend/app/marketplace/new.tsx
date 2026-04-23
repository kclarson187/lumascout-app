/**
 * Pack Marketplace — Create product form.
 * Path: /marketplace/new
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  Image,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ArrowLeft, ImagePlus, Trash2, DollarSign } from 'lucide-react-native';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import KeyboardSafe from '../../src/components/KeyboardSafe';

const TYPES = [
  { key: 'preset',      label: 'Lightroom Presets', emoji: '🎨' },
  { key: 'spot_pack',   label: 'Spot Pack',         emoji: '📍' },
  { key: 'city_guide',  label: 'City Guide',        emoji: '🗺️' },
  { key: 'route_pack',  label: 'Route Pack',        emoji: '🛣️' },
  { key: 'lut',         label: 'LUT',               emoji: '🎞️' },
  { key: 'template',    label: 'Template',          emoji: '📐' },
  { key: 'mentorship',  label: 'Mentorship Call',   emoji: '🎧' },
];

export default function NewProduct() {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('preset');
  const [description, setDescription] = useState('');
  const [priceDollars, setPriceDollars] = useState('');
  const [thumbUri, setThumbUri] = useState<string | null>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [contentsUrl, setContentsUrl] = useState('');
  const [tags, setTags] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function pickImage(multi = false): Promise<string[]> {
    const r = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!r.granted) { Alert.alert('Permission needed', 'Please enable photo library access.'); return []; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: multi,
      selectionLimit: multi ? 5 : 1,
      quality: 0.7,
      base64: true,
    });
    if (res.canceled) return [];
    return (res.assets || []).map((a) => `data:${a.mimeType || 'image/jpeg'};base64,${a.base64}`);
  }

  const addThumb = async () => {
    const [u] = await pickImage(false);
    if (u) setThumbUri(u);
  };
  const addPreviews = async () => {
    const urls = await pickImage(true);
    if (urls.length) setPreviews((cur) => [...cur, ...urls].slice(0, 5));
  };

  const priceCents = (() => {
    const n = Number((priceDollars || '0').replace(/[^0-9.]/g, ''));
    if (isNaN(n)) return 0;
    return Math.round(n * 100);
  })();

  const canSubmit =
    title.trim().length >= 4 &&
    description.trim().length >= 10 &&
    thumbUri &&
    priceCents >= 0 &&
    !submitting;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const body = {
        title: title.trim(),
        type,
        description: description.trim(),
        price_cents: priceCents,
        thumbnail_url: thumbUri,
        preview_urls: previews,
        contents_url: contentsUrl.trim() || null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      const p = await api.post('/marketplace/products', body);
      Alert.alert(
        'Submitted for review',
        'Our moderation team will approve your listing within 24h. You\'ll be notified.',
        [{ text: 'View my products', onPress: () => router.replace('/me/seller' as any) }],
      );
    } catch (e: any) {
      Alert.alert('Could not publish', e?.response?.data?.detail || e?.message || 'Please try again.');
    } finally { setSubmitting(false); }
  };

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.hBtn} hitSlop={10}>
          <ArrowLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>List a product</Text>
        <View style={styles.hBtn} />
      </View>

      <KeyboardSafe style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 120, gap: space.lg }} keyboardShouldPersistTaps="handled">

          {/* Thumbnail */}
          <View>
            <Text style={styles.label}>Cover image *</Text>
            <Text style={styles.hint}>1:1 or 4:3 works best. Min 1000px wide.</Text>
            {thumbUri ? (
              <View style={styles.thumbWrap}>
                <Image source={{ uri: thumbUri }} style={styles.thumb} />
                <TouchableOpacity style={styles.thumbDel} onPress={() => setThumbUri(null)}>
                  <Trash2 size={14} color={colors.text} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.imageDrop} onPress={addThumb}>
                <ImagePlus size={28} color={colors.primary} />
                <Text style={styles.imageDropTxt}>Tap to add cover image</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Title */}
          <View>
            <Text style={styles.label}>Title *</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Moody Wedding — 14 Lightroom presets"
              placeholderTextColor={colors.textTertiary}
              maxLength={140}
              style={styles.input}
            />
          </View>

          {/* Type */}
          <View>
            <Text style={styles.label}>Type *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {TYPES.map((t) => (
                <TouchableOpacity key={t.key} style={[styles.typeChip, type === t.key && styles.typeChipActive]} onPress={() => setType(t.key)}>
                  <Text style={{ fontSize: 14 }}>{t.emoji}</Text>
                  <Text style={[styles.typeChipTxt, type === t.key && styles.typeChipTxtActive]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Description */}
          <View>
            <Text style={styles.label}>Description *</Text>
            <Text style={styles.hint}>What's included, who it's for, and why buyers will love it.</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={6}
              placeholder="Tell buyers what makes your pack special…"
              placeholderTextColor={colors.textTertiary}
              maxLength={2000}
              style={[styles.input, { minHeight: 130, textAlignVertical: 'top' }]}
            />
          </View>

          {/* Price */}
          <View>
            <Text style={styles.label}>Price *</Text>
            <Text style={styles.hint}>Set to 0 to give your pack away for free.</Text>
            <View style={styles.priceInputWrap}>
              <DollarSign size={16} color={colors.primary} />
              <TextInput
                value={priceDollars}
                onChangeText={setPriceDollars}
                placeholder="29.00"
                placeholderTextColor={colors.textTertiary}
                keyboardType="decimal-pad"
                style={[styles.input, { borderWidth: 0, flex: 1, padding: 0 }]}
              />
            </View>
            <Text style={styles.payoutHint}>
              You keep <Text style={{ color: colors.primary, fontFamily: font.bodyBold }}>85%</Text> · Platform fee: 15%.
              {priceCents > 0 ? ` You’d earn ${fmt(priceCents * 0.85 / 100)}/sale.` : ''}
            </Text>
          </View>

          {/* Preview images */}
          <View>
            <Text style={styles.label}>Preview images (up to 5)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {previews.map((u, i) => (
                <View key={i} style={[styles.thumbWrap, { width: 110, height: 110 }]}>
                  <Image source={{ uri: u }} style={styles.thumb} />
                  <TouchableOpacity style={styles.thumbDel} onPress={() => setPreviews((cur) => cur.filter((_, j) => j !== i))}>
                    <Trash2 size={12} color={colors.text} />
                  </TouchableOpacity>
                </View>
              ))}
              {previews.length < 5 && (
                <TouchableOpacity style={[styles.imageDrop, { width: 110, height: 110, margin: 0 }]} onPress={addPreviews}>
                  <ImagePlus size={20} color={colors.primary} />
                  <Text style={[styles.imageDropTxt, { fontSize: 10 }]}>Add</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>

          {/* Contents URL */}
          <View>
            <Text style={styles.label}>Delivery URL (optional)</Text>
            <Text style={styles.hint}>Dropbox / Google Drive / Notion link. Only unlocked after purchase.</Text>
            <TextInput
              value={contentsUrl}
              onChangeText={setContentsUrl}
              placeholder="https://drive.google.com/…"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              style={styles.input}
            />
          </View>

          {/* Tags */}
          <View>
            <Text style={styles.label}>Tags (comma separated)</Text>
            <TextInput
              value={tags}
              onChangeText={setTags}
              placeholder="austin, portrait, golden-hour"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              style={styles.input}
            />
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, !canSubmit && { opacity: 0.4 }]}
            onPress={onSubmit}
            disabled={!canSubmit}
          >
            {submitting ? <ActivityIndicator color={colors.textInverse} /> : (
              <Text style={styles.submitTxt}>Submit for review</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.disclaimer}>By listing, you confirm you own or have rights to distribute this content.</Text>
        </ScrollView>
      </KeyboardSafe>
    </SafeAreaView>
  );
}

function fmt(n: number) { return `$${n.toFixed(2)}`; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.sm, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  hBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.text, fontFamily: font.bodyBold, fontSize: 16 },

  label: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13, marginBottom: 5 },
  hint: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginBottom: 8, lineHeight: 15 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.md,
    padding: 12, color: colors.text, fontFamily: font.body, fontSize: 14,
    backgroundColor: colors.surface1,
  },
  priceInputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12,
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.md,
    backgroundColor: colors.surface1,
  },
  payoutHint: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 6 },

  imageDrop: {
    height: 170, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.primary, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(245,166,35,0.06)',
  },
  imageDropTxt: { color: colors.primary, fontFamily: font.bodyMedium, fontSize: 13 },

  thumbWrap: {
    position: 'relative', overflow: 'hidden',
    borderRadius: radii.md, backgroundColor: colors.surface1,
    height: 180,
  },
  thumb: { width: '100%', height: '100%' },
  thumbDel: {
    position: 'absolute', top: 8, right: 8,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center',
  },

  typeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.pill,
  },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeChipTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },
  typeChipTxtActive: { color: colors.textInverse, fontFamily: font.bodyBold },

  submitBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radii.md,
    alignItems: 'center',
    marginTop: 12,
  },
  submitTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },
  disclaimer: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, textAlign: 'center', marginTop: 6 },
});
