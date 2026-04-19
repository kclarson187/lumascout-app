import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { X, Check, Image as ImageIcon, Sparkles } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';

const CATEGORIES = [
  { k: 'win',       label: 'Win' },
  { k: 'question',  label: 'Question' },
  { k: 'tip',       label: 'Tip' },
  { k: 'gear',      label: 'Gear' },
  { k: 'critique',  label: 'Critique' },
  { k: 'bts',       label: 'BTS' },
  { k: 'referral',  label: 'Referral' },
  { k: 'collab',    label: 'Collab' },
  { k: 'meetup',    label: 'Meetup' },
  { k: 'intro',     label: 'Intro' },
];

export default function Compose() {
  const { user } = useAuth();
  const [category, setCategory] = useState('win');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pickImage = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7, base64: true, allowsEditing: true, aspect: [16, 10],
    });
    if (!r.canceled && r.assets[0]?.base64) {
      setImageUri(`data:image/jpeg;base64,${r.assets[0].base64}`);
    }
  };

  const submit = async () => {
    if (!title.trim()) { Alert.alert('Title required', 'Give your post a title so others can find it.'); return; }
    setSubmitting(true);
    try {
      await api.post('/posts', {
        category, title: title.trim(), body: body.trim(), image_url: imageUri,
        city: user?.city, state: user?.state,
      });
      Alert.alert('Posted!', 'Your post is live in the community.', [
        { text: 'OK', onPress: () => router.replace('/community') },
      ]);
    } catch (e) { Alert.alert('Could not post', formatApiError(e)); }
    finally { setSubmitting(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.head}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}><X size={22} color={colors.text} /></TouchableOpacity>
          <Text style={styles.title}>New post</Text>
          <TouchableOpacity
            onPress={submit}
            disabled={!title.trim() || submitting}
            style={[styles.postBtn, (!title.trim() || submitting) && { opacity: 0.4 }]}
            testID="compose-submit"
          >
            {submitting ? <ActivityIndicator size="small" color={colors.textInverse} /> : (
              <><Check size={14} color={colors.textInverse} /><Text style={styles.postBtnTxt}>Post</Text></>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: 80 }}>
          <View style={styles.tipCard}>
            <Sparkles size={14} color={colors.primary} />
            <Text style={styles.tipTxt}>Be specific. “Need family photog in Austin May 20 — 2hr session” beats “need referral.”</Text>
          </View>

          <Text style={styles.label}>Category</Text>
          <View style={styles.catGrid}>
            {CATEGORIES.map((c) => (
              <TouchableOpacity
                key={c.k}
                onPress={() => setCategory(c.k)}
                style={[styles.catChip, category === c.k && styles.catChipActive]}
                testID={`cat-${c.k}`}
              >
                <Text style={[styles.catTxt, category === c.k && styles.catTxtActive]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="One clear line…"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            maxLength={140}
            testID="compose-title"
          />

          <Text style={styles.label}>Details (optional)</Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Context, photos, prices, dates…"
            placeholderTextColor={colors.textTertiary}
            multiline
            style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]}
            maxLength={2000}
            testID="compose-body"
          />

          <Text style={styles.label}>Photo (optional)</Text>
          {imageUri ? (
            <View>
              <Image source={{ uri: imageUri }} style={styles.preview} />
              <TouchableOpacity onPress={() => setImageUri(null)} style={styles.removeImgBtn}>
                <X size={14} color={colors.textInverse} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={pickImage} style={styles.imgPickBtn} testID="compose-pick-image">
              <ImageIcon size={18} color={colors.primary} />
              <Text style={styles.imgPickTxt}>Add a photo</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl, paddingVertical: space.md, gap: 12 },
  title: { flex: 1, color: colors.text, fontFamily: font.display, fontSize: 22, textAlign: 'center' },
  postBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.primary },
  postBtnTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 13 },
  tipCard: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: space.md, borderRadius: radii.md, backgroundColor: 'rgba(245,166,35,0.08)', borderColor: colors.primary, borderWidth: 1 },
  tipTxt: { flex: 1, color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17 },
  label: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase' },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  catChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  catChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  catTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  catTxtActive: { color: colors.textInverse, fontFamily: font.bodySemibold },
  input: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: space.md, paddingVertical: 12, color: colors.text, fontFamily: font.body, fontSize: 15 },
  imgPickBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: space.lg, borderRadius: radii.md, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderStyle: 'dashed' },
  imgPickTxt: { color: colors.primary, fontFamily: font.bodySemibold, fontSize: 14 },
  preview: { width: '100%', aspectRatio: 16 / 10, borderRadius: radii.md },
  removeImgBtn: { position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
});
