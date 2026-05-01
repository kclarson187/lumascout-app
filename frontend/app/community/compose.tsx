import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import SafeImage from '../../src/components/SafeImage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { X, Check, Image as ImageIcon, Sparkles } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';

const CATEGORIES: { k: string; label: string; hint: string; placeholder: string }[] = [
  { k: 'win',      label: 'Win',      hint: '🎉 Celebrate a recent shoot, booking, or milestone',        placeholder: 'What made this week a win for you?' },
  { k: 'question', label: 'Question', hint: '❓ Ask the community — gear, pricing, editing, clients',    placeholder: 'What would you like the community to help with?' },
  { k: 'tip',      label: 'Tip',      hint: '💡 Share a technique, location hack, or workflow tip',      placeholder: 'Drop your photography tip here…' },
  { k: 'gear',     label: 'Gear',     hint: '📷 Gear reviews, questions, buy/sell/trade',                 placeholder: 'What gear are we talking about?' },
  { k: 'critique', label: 'Critique', hint: '🖼 Ask for feedback on a recent image (attach the photo)',  placeholder: 'Context: lighting, edits, story behind the shot…' },
  { k: 'bts',      label: 'BTS',      hint: '🎬 Behind-the-scenes moments from a recent shoot',           placeholder: 'What was the BTS story?' },
  { k: 'referral', label: 'Referral', hint: '🤝 Offer or request a client referral (booked session, overflow)', placeholder: 'Date, city, session type, budget, client requirements…' },
  { k: 'collab',   label: 'Collab',   hint: '🎨 Team up on a creative project, portfolio swap, or styled shoot', placeholder: 'What collab are you proposing?' },
  { k: 'meetup',   label: 'Meetup',   hint: '📅 Organize or join a photo walk / coffee meetup',            placeholder: 'Date, time, city, what to bring, how many can join…' },
  { k: 'intro',    label: 'Intro',    hint: '👋 New here? Introduce yourself to the community',           placeholder: 'Your name, location, style, what you are looking for here…' },
  { k: 'poll',     label: 'Poll',     hint: '📊 Ask a 2-to-6-option question and let the community vote', placeholder: 'Optional context for your poll…' },
];

export default function Compose() {
  const { user } = useAuth();
  const params = useLocalSearchParams<{ group_id?: string }>();
  const groupId = params.group_id ? String(params.group_id) : null;
  const [category, setCategory] = useState('win');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);

  const pickImage = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7, base64: true, allowsEditing: true, aspect: [16, 10],
    });
    if (!r.canceled && r.assets[0]?.base64) {
      setImageUri(`data:image/jpeg;base64,${r.assets[0].base64}`);
    }
  };

  const submit = async () => {
    if (!title.trim()) { Alert.alert('Title required', 'Give your post a title so others can find it.'); return; }
    if (category === 'poll') {
      const opts = pollOptions.map((o) => o.trim()).filter(Boolean);
      if (opts.length < 2) { Alert.alert('Poll needs options', 'Add at least 2 options.'); return; }
      if (opts.length > 6) { Alert.alert('Too many options', 'Max 6 poll options.'); return; }
    }
    setSubmitting(true);
    try {
      const payload: any = {
        category, title: title.trim(), body: body.trim(), image_url: imageUri,
        city: user?.city, state: user?.state,
      };
      if (category === 'poll') {
        payload.poll_options = pollOptions.map((o) => o.trim()).filter(Boolean);
      }
      if (groupId) payload.group_id = groupId;
      await api.post('/posts', payload);
      Alert.alert('Posted!', 'Your post is live in the community.', [
        { text: 'OK', onPress: () => router.replace('/community') },
      ]);
    } catch (e) { Alert.alert('Could not post', formatApiError(e)); }
    finally { setSubmitting(false); }
  };

  // FIX(Commit 6c / 2026-04): Post-button gate. Mirrors the Add-Spot Publish
  // gating pattern from Commit 6a. A post is "valid" when:
  //   - Title is 3+ chars (trimmed), AND
  //   - Either body is 1+ char (trimmed), OR a photo is attached,
  //     OR it's a Poll with 2+ non-empty options.
  // This prevents empty-content posts from hitting the API and matches the
  // "3-char min" threshold we already use for spot titles.
  const trimmedTitleLen = title.trim().length;
  const validPollOpts = pollOptions.map((o) => o.trim()).filter(Boolean).length;
  const hasContent =
    body.trim().length >= 1 ||
    !!imageUri ||
    (category === 'poll' && validPollOpts >= 2);
  const canPost = trimmedTitleLen >= 3 && hasContent;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.head}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}><X size={22} color={colors.text} /></TouchableOpacity>
          <Text style={styles.title}>New post</Text>
          <TouchableOpacity
            onPress={submit}
            disabled={!canPost || submitting}
            style={[styles.postBtn, (!canPost || submitting) && { opacity: 0.4 }]}
            testID="compose-submit"
          >
            {submitting ? <ActivityIndicator size="small" color={colors.textInverse} /> : (
              <><Check size={14} color={colors.textInverse} /><Text style={styles.postBtnTxt}>Post</Text></>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag" contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: 80 }}>
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
          {!!CATEGORIES.find((c) => c.k === category) && (
            <View style={styles.catHintCard}>
              <Text style={styles.catHint}>{CATEGORIES.find((c) => c.k === category)!.hint}</Text>
            </View>
          )}

          <Text style={styles.label}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="One clear line…"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            maxLength={100}
            testID="compose-title"
          />
          {/* FIX(Commit 6c): counter surfaces at 80+ chars (same threshold
              pattern as the spot Notes counter from Commit 3). */}
          {title.length >= 80 && (
            <Text style={styles.counter} testID="compose-title-counter">
              {title.length}/100
            </Text>
          )}

          <Text style={styles.label}>Details (optional)</Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder={CATEGORIES.find((c) => c.k === category)?.placeholder || 'Context, photos, prices, dates…'}
            placeholderTextColor={colors.textTertiary}
            multiline
            style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]}
            maxLength={2000}
            testID="compose-body"
          />
          {body.length >= 1500 && (
            <Text style={styles.counter} testID="compose-body-counter">
              {body.length}/2000
            </Text>
          )}

          {category === 'poll' && (
            <View style={{ marginTop: space.md }}>
              <Text style={styles.label}>Poll options (2–6)</Text>
              {pollOptions.map((opt, idx) => (
                <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <TextInput
                    value={opt}
                    onChangeText={(t) => {
                      const next = [...pollOptions]; next[idx] = t; setPollOptions(next);
                    }}
                    placeholder={`Option ${idx + 1}`}
                    placeholderTextColor={colors.textTertiary}
                    style={[styles.input, { flex: 1, marginTop: 0 }]}
                    maxLength={120}
                    testID={`compose-poll-opt-${idx}`}
                  />
                  {pollOptions.length > 2 && (
                    <TouchableOpacity
                      onPress={() => setPollOptions(pollOptions.filter((_, i) => i !== idx))}
                      style={styles.removeOptBtn}
                      testID={`compose-poll-del-${idx}`}
                    >
                      <X size={14} color={colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {pollOptions.length < 6 && (
                <TouchableOpacity
                  onPress={() => setPollOptions([...pollOptions, ''])}
                  style={styles.addOptBtn}
                  testID="compose-poll-add"
                >
                  <Text style={styles.addOptTxt}>+ Add option</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <Text style={styles.label}>Photo (optional)</Text>
          {imageUri ? (
            <View>
              <SafeImage source={{ uri: imageUri }} style={styles.preview} />
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
  catHintCard: {
    padding: space.md, borderRadius: radii.md,
    backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1, marginTop: -4,
  },
  catHint: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 13, lineHeight: 19 },
  catTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  catTxtActive: { color: colors.textInverse, fontFamily: font.bodySemibold },
  input: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: space.md, paddingVertical: 12, color: colors.text, fontFamily: font.body, fontSize: 15 },
  imgPickBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: space.lg, borderRadius: radii.md, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderStyle: 'dashed' },
  imgPickTxt: { color: colors.primary, fontFamily: font.bodySemibold, fontSize: 14 },
  preview: { width: '100%', aspectRatio: 16 / 10, borderRadius: radii.md },
  removeImgBtn: { position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  removeOptBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  addOptBtn: { padding: 10, borderRadius: radii.md, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', marginTop: 4 },
  addOptTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 13 },
  // FIX(Commit 6c): char-counter line — matches spot Notes counter style.
  counter: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: -8, textAlign: 'right' },
});
