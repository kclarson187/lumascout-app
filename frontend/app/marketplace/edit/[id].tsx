/**
 * Edit an existing marketplace product.
 * Path: /marketplace/edit/[id]
 *
 * Thin reuse of the new-product form via a shared shape. We load the product
 * first, then render the form prefilled.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput, Alert, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ArrowLeft, ImagePlus, Trash2, DollarSign, Save, Trash } from 'lucide-react-native';
import { api } from '../../../src/api';
import { colors, font, space, radii } from '../../../src/theme';
import KeyboardSafe from '../../../src/components/KeyboardSafe';

export default function EditProduct() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priceDollars, setPriceDollars] = useState('');
  const [thumbUri, setThumbUri] = useState<string | null>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [contentsUrl, setContentsUrl] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const p = await api.get(`/marketplace/products/${id}`);
        setProduct(p);
        setTitle(p.title); setDescription(p.description);
        setPriceDollars(((p.price_cents || 0) / 100).toFixed(2));
        setThumbUri(p.thumbnail_url || null);
        setPreviews(p.preview_urls || []);
        setContentsUrl(p.contents_url || '');
        setTags((p.tags || []).join(', '));
      } catch (e: any) {
        Alert.alert('Error', e?.response?.data?.detail || 'Could not load.');
        router.back();
      } finally { setLoading(false); }
    })();
  }, [id]);

  async function pickImage(multi = false): Promise<string[]> {
    const r = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!r.granted) { Alert.alert('Permission needed'); return []; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: multi, selectionLimit: multi ? 5 : 1,
      quality: 0.7, base64: true,
    });
    if (res.canceled) return [];
    return (res.assets || []).map((a) => `data:${a.mimeType || 'image/jpeg'};base64,${a.base64}`);
  }

  const priceCents = Math.round(Number((priceDollars || '0').replace(/[^0-9.]/g, '')) * 100) || 0;

  const save = async () => {
    setSaving(true);
    try {
      const body: any = {
        title: title.trim(),
        description: description.trim(),
        price_cents: priceCents,
        preview_urls: previews,
        contents_url: contentsUrl.trim() || null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      if (thumbUri && thumbUri.startsWith('data:')) body.thumbnail_url = thumbUri;
      const r = await api.patch(`/marketplace/products/${id}`, body);
      Alert.alert(r.status === 'pending' ? 'Sent for re-review' : 'Saved', 'Changes saved.');
      router.replace('/me/seller' as any);
    } catch (e: any) {
      Alert.alert('Could not save', e?.response?.data?.detail || e?.message || 'Please try again.');
    } finally { setSaving(false); }
  };

  const del = async () => {
    Alert.alert('Delete product?', 'This removes the listing. Past purchases are preserved.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await api.delete(`/marketplace/products/${id}`);
          router.replace('/me/seller' as any);
        } catch (e: any) {
          Alert.alert('Error', e?.response?.data?.detail || 'Failed.');
        }
      } },
    ]);
  };

  if (loading || !product) {
    return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.hBtn}><ArrowLeft size={22} color={colors.text} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Edit product</Text>
        <TouchableOpacity onPress={del} style={styles.hBtn}><Trash size={20} color={colors.secondary} /></TouchableOpacity>
      </View>
      <KeyboardSafe style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 100, gap: space.lg }} keyboardShouldPersistTaps="handled">

          <View>
            <Text style={styles.label}>Cover image</Text>
            {thumbUri ? (
              <View style={styles.thumbWrap}>
                <Image source={{ uri: thumbUri }} style={styles.thumb} />
                <TouchableOpacity style={styles.thumbDel} onPress={async () => {
                  const [u] = await pickImage(false);
                  if (u) setThumbUri(u);
                }}><ImagePlus size={14} color={colors.text} /></TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.imageDrop} onPress={async () => { const [u] = await pickImage(false); if (u) setThumbUri(u); }}>
                <ImagePlus size={28} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>

          <View><Text style={styles.label}>Title</Text><TextInput value={title} onChangeText={setTitle} style={styles.input} /></View>
          <View><Text style={styles.label}>Description</Text><TextInput value={description} onChangeText={setDescription} multiline style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]} /></View>
          <View>
            <Text style={styles.label}>Price (USD)</Text>
            <Text style={styles.hint}>Changes price → listing returns to pending review.</Text>
            <View style={styles.priceInputWrap}>
              <DollarSign size={16} color={colors.primary} />
              <TextInput value={priceDollars} onChangeText={setPriceDollars} keyboardType="decimal-pad" style={[styles.input, { flex: 1, borderWidth: 0, padding: 0 }]} />
            </View>
          </View>
          <View><Text style={styles.label}>Delivery URL</Text><TextInput value={contentsUrl} onChangeText={setContentsUrl} autoCapitalize="none" style={styles.input} /></View>
          <View><Text style={styles.label}>Tags</Text><TextInput value={tags} onChangeText={setTags} style={styles.input} /></View>

          <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color={colors.textInverse} /> : <><Save size={14} color={colors.textInverse} /><Text style={styles.saveTxt}>Save changes</Text></>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardSafe>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  hBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.text, fontFamily: font.bodyBold, fontSize: 16 },
  label: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13, marginBottom: 5 },
  hint: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: 12, color: colors.text, fontFamily: font.body, fontSize: 14, backgroundColor: colors.surface1 },
  priceInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface1 },
  imageDrop: { height: 180, borderRadius: radii.md, borderWidth: 1, borderColor: colors.primary, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  thumbWrap: { position: 'relative', overflow: 'hidden', borderRadius: radii.md, height: 180 },
  thumb: { width: '100%', height: '100%' },
  thumbDel: { position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  saveBtn: { flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center', paddingVertical: 14, borderRadius: radii.md, backgroundColor: colors.primary, marginTop: 10 },
  saveTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },
});
