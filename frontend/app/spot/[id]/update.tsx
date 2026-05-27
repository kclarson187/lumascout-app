import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, PenLine, Send } from 'lucide-react-native';
import { api } from '../../../src/api';
import { colors, font, space, radii } from '../../../src/theme';
import { CONDITION_TAGS } from '../../../src/components/FreshnessBits';
import KeyboardSafe from '../../../src/components/KeyboardSafe';

const SUGGESTIONS = [
  'Bluebonnets still strong today.',
  'Trail muddy near parking lot.',
  'Great sunset at 7:42 PM.',
  'Gate closed — come back another day.',
  'Uncrowded this morning.',
];

export default function UpdateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const spotId = String(id || '');
  const [text, setText] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const toggleTag = (k: string) => {
    setTags((prev) => {
      if (prev.includes(k)) return prev.filter((t) => t !== k);
      if (prev.length >= 6) return prev;
      return [...prev, k];
    });
  };

  const canSubmit = text.trim().length >= 3 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const r = await api.post(`/spots/${spotId}/updates`, {
        text: text.trim(),
        condition_tags: tags,
      });
      Alert.alert(
        r?.auto_approved ? 'Posted!' : 'Submitted for review',
        r?.auto_approved ? 'Thanks for the heads-up!' : "We'll publish it as soon as a reviewer approves.",
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (e: any) {
      Alert.alert('Could not post', e?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="update-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Add Update</Text>
          <Text style={styles.title}>Quick check-in</Text>
        </View>
      </View>
      <KeyboardSafe style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: space.xxxl + 40, paddingHorizontal: space.xl, gap: space.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: space.sm }}>
            <Text style={styles.sectionTitle}>What's it like there right now?</Text>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Bluebonnets still blooming, trail a bit muddy…"
              placeholderTextColor={colors.textTertiary}
              multiline
              style={styles.input}
              maxLength={500}
              autoFocus
              testID="update-text"
            />
            <Text style={styles.counter}>{text.length}/500</Text>
          </View>

          <View style={{ gap: space.sm }}>
            <Text style={styles.sectionTitle}>Quick pick</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {SUGGESTIONS.map((s) => (
                <Pressable key={s} onPress={() => setText(s)} style={styles.suggest}>
                  <PenLine size={11} color={colors.primary} />
                  <Text style={styles.suggestTxt}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={{ gap: space.sm }}>
            <Text style={styles.sectionTitle}>Conditions <Text style={styles.optional}>(optional)</Text></Text>
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
                    testID={`update-tag-${t.key}`}
                  >
                    <Icon size={13} color={selected ? t.color : colors.textSecondary} />
                    <Text style={[styles.tagChipTxt, selected && { color: t.color, fontFamily: font.bodySemibold }]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ScrollView>

        <View style={styles.submitBar}>
          <TouchableOpacity
            disabled={!canSubmit}
            onPress={submit}
            style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
            testID="update-submit"
          >
            {submitting ? <ActivityIndicator color={colors.textInverse} /> : (
              <>
                <Send size={16} color={colors.textInverse} />
                <Text style={styles.submitBtnTxt}>Post update</Text>
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
  kicker: { color: colors.kicker, fontFamily: font.bodyBold, fontSize: 10,},
  title: { color: colors.text, fontFamily: font.display, fontSize: 20 },
  sectionTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  optional: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  input: { minHeight: 120, padding: 12, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, color: colors.text, fontFamily: font.body, fontSize: 15, textAlignVertical: 'top' },
  counter: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, textAlign: 'right' },
  suggest: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: 'rgba(245,166,35,0.08)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.3)' },
  suggestTxt: { color: colors.primary, fontFamily: font.bodyMedium, fontSize: 11 },
  tagsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  tagChipTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  submitBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, paddingBottom: Platform.OS === 'ios' ? space.xl : space.lg, backgroundColor: colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: radii.md, backgroundColor: colors.primary },
  submitBtnDisabled: { backgroundColor: colors.surface2 },
  submitBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },
});
