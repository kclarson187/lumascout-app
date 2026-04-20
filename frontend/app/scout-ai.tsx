/**
 * Scout AI — full chat screen.
 *
 * UX rule (per product spec): the primary interaction is an OPEN TEXT INPUT.
 * Suggested chips are secondary helpers below the input. Do NOT auto-send
 * prefilled queries — instead seed them into the input so the user can edit
 * or send with one tap.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { ChevronLeft, Send, Sparkles, Info } from 'lucide-react-native';
import { api, formatApiError } from '../src/api';
import { colors, font, space, radii } from '../src/theme';
import ScoutAIAvatar from '../src/components/ScoutAIAvatar';

type Msg = { role: 'user' | 'assistant'; content: string };

type PlacementCopy = { helper: string; chips: string[] };
const PLACEMENT_COPY: Record<string, PlacementCopy> = {
  home: {
    helper: 'Ask about spots, saved locations, uploads, or planning.',
    chips: [
      'Where should I shoot this weekend?',
      'Best sunset spots near me',
      'Hidden gems nearby',
      'Help me plan a shoot',
    ],
  },
  explore: {
    helper: 'Ask about nearby spots, filters, or what fits your shoot.',
    chips: [
      'Find low-crowd places',
      'Best family spots nearby',
      'Hidden gems',
      'Sunset spots with easy parking',
    ],
  },
  saved: {
    helper: 'Ask which saved spot fits your next shoot.',
    chips: [
      "Which saved spot is best for tonight?",
      'Compare my saved spots',
      'Best saved location for family photos',
      'Help me organize collections',
    ],
  },
  upload: {
    helper: 'Ask for help with your submission.',
    chips: [
      'Help me write the description',
      'What notes should I include?',
      'Public or Private?',
      'Final review check',
    ],
  },
  spot_detail: {
    helper: 'Ask if this spot fits your shoot.',
    chips: [
      'Is this good for family sessions?',
      'Best time to shoot here',
      'Compare with nearby spots',
      'Is this worth saving?',
    ],
  },
  community: {
    helper: 'Ask for help replying, posting, or finding relevant spots.',
    chips: [
      'Help me reply',
      'Write a better question',
      'Suggest a poll',
      'Find related spots',
    ],
  },
};

const DEFAULT_PLACEHOLDER = 'Ask about spots, saved locations, uploads, or planning';

export default function ScoutAIScreen() {
  const params = useLocalSearchParams<{ q?: string; placement?: string; spot_id?: string }>();
  const placement = (typeof params.placement === 'string' ? params.placement : 'home');
  const spotId = typeof params.spot_id === 'string' ? params.spot_id : undefined;
  const seed = typeof params.q === 'string' ? params.q : undefined;

  const copy = PLACEMENT_COPY[placement] || PLACEMENT_COPY.home;
  const [messages, setMessages] = useState<Msg[]>([]);
  // Seed the input with the prefilled query (if any) so the user can edit/send —
  // NEVER auto-send. Text input is the primary interaction per product spec.
  const [input, setInput] = useState<string>(seed || '');
  const [loading, setLoading] = useState(false);
  const [followUps, setFollowUps] = useState<string[]>(copy.chips);
  const scrollRef = useRef<ScrollView | null>(null);
  const inputRef = useRef<TextInput | null>(null);

  // Autofocus when the user opens Scout AI with an empty field. If a seed was
  // provided we still focus so they can edit immediately.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 240);
    return () => clearTimeout(t);
  }, []);

  const send = useCallback(async (text: string) => {
    const content = (text || '').trim();
    if (!content || loading) return;
    const next: Msg[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const r = await api.post('/ai/chat', {
        messages: next,
        spot_id: spotId,
        placement,
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: r?.reply || '…' }]);
      if (Array.isArray(r?.follow_ups) && r.follow_ups.length) {
        setFollowUps(r.follow_ups);
      }
    } catch (e) {
      Alert.alert('Scout AI', formatApiError(e));
      setMessages((prev) => prev.slice(0, -1));
      setInput(content);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages, loading, spotId, placement]);

  const isFirstScreen = messages.length === 0 && !loading;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="scout-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerAvatar}>
          <ScoutAIAvatar size={34} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.title}>Scout AI</Text>
            <View style={styles.aiBadge}>
              <Sparkles size={9} color={colors.primary} />
              <Text style={styles.aiBadgeTxt}>OFFICIAL AI</Text>
            </View>
          </View>
          <Text style={styles.subtitle} numberOfLines={1}>Official PhotoScout assistant</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={8}
      >
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Tight helper line — no big empty-state hero anymore. Text input
              sits right below. Prevents "canned menu" feeling. */}
          {isFirstScreen && (
            <Text style={styles.helperLine}>{copy.helper}</Text>
          )}

          {messages.map((m, i) => (
            <View key={i} style={[styles.msgRow, m.role === 'user' && styles.msgRowUser]}>
              {m.role === 'assistant' && (
                <View style={styles.msgAvatar}>
                  <ScoutAIAvatar size={28} />
                </View>
              )}
              <View style={[
                styles.bubble,
                m.role === 'user' ? styles.bubbleUser : styles.bubbleAi,
              ]}>
                {m.role === 'assistant' && (
                  <View style={styles.aiBadgeSm}>
                    <Sparkles size={8} color={colors.primary} />
                    <Text style={styles.aiBadgeSmTxt}>AI</Text>
                  </View>
                )}
                <Text style={[
                  styles.msgTxt,
                  m.role === 'user' && { color: colors.textInverse },
                ]}>
                  {m.content}
                </Text>
              </View>
            </View>
          ))}

          {loading && (
            <View style={styles.msgRow}>
              <View style={styles.msgAvatar}>
                <ScoutAIAvatar size={28} />
              </View>
              <View style={[styles.bubble, styles.bubbleAi, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.msgTxt, { color: colors.textSecondary }]}>Scout AI is thinking…</Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Composer — PRIMARY surface. Always visible, always focused first. */}
        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder={DEFAULT_PLACEHOLDER}
            placeholderTextColor={colors.textTertiary}
            value={input}
            onChangeText={setInput}
            editable={!loading}
            onSubmitEditing={() => send(input)}
            returnKeyType="send"
            multiline
            blurOnSubmit
            testID="scout-input"
          />
          <TouchableOpacity
            onPress={() => send(input)}
            disabled={!input.trim() || loading}
            style={[styles.sendBtn, (!input.trim() || loading) && { opacity: 0.45 }]}
            testID="scout-send"
          >
            <Send size={16} color={colors.textInverse} />
          </TouchableOpacity>
        </View>

        {/* Suggestion chips — SECONDARY, below the input. Never louder than it. */}
        {!loading && followUps.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipRailContainer}
            contentContainerStyle={styles.chipRail}
            keyboardShouldPersistTaps="handled"
          >
            {followUps.map((f) => (
              <TouchableOpacity
                key={f}
                onPress={() => {
                  // Put the suggestion in the input so the user can tweak it
                  // OR send straight through — both feel natural. We auto-send
                  // because chips below the input are understood as shortcuts.
                  send(f);
                }}
                style={styles.chip}
                testID={`scout-followup-${f.slice(0, 16)}`}
              >
                <Text style={styles.chipTxt} numberOfLines={1}>{f}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Persistent AI disclosure */}
        <View style={styles.disclosure}>
          <Info size={10} color={colors.textTertiary} />
          <Text style={styles.disclosureTxt} numberOfLines={2}>
            Replies are AI-generated. Verify time-sensitive details like permits, weather, and crowds.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: space.xl, paddingVertical: space.md,
    borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerAvatar: { borderRadius: 999, overflow: 'hidden' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 20, letterSpacing: -0.3 },
  subtitle: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 1 },

  aiBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 5, paddingVertical: 1, borderRadius: radii.pill,
    backgroundColor: 'rgba(245,166,35,0.14)', borderWidth: 1, borderColor: colors.primary,
  },
  aiBadgeTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 8, letterSpacing: 0.6 },
  aiBadgeSm: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: 4, paddingVertical: 1, borderRadius: radii.pill,
    backgroundColor: 'rgba(245,166,35,0.14)', borderWidth: 1, borderColor: colors.primary,
    alignSelf: 'flex-start', marginBottom: 4,
  },
  aiBadgeSmTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 7.5, letterSpacing: 0.6 },

  scroll: { padding: space.xl, gap: 10, paddingBottom: 8 },

  helperLine: {
    color: colors.textSecondary, fontFamily: font.body, fontSize: 13,
    lineHeight: 18, paddingVertical: 4,
  },

  msgRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  msgRowUser: { justifyContent: 'flex-end' },
  msgAvatar: { width: 28, height: 28, borderRadius: 14, overflow: 'hidden' },
  bubble: { maxWidth: '82%', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14 },
  bubbleAi: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderTopLeftRadius: 4 },
  bubbleUser: { backgroundColor: colors.primary, borderTopRightRadius: 4 },
  msgTxt: { color: colors.text, fontFamily: font.body, fontSize: 14, lineHeight: 20 },

  // Composer — primary surface
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: space.xl, paddingTop: 10, paddingBottom: 6,
    borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1, color: colors.text, fontFamily: font.body, fontSize: 14,
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.lg, paddingHorizontal: 14, paddingVertical: 12,
    minHeight: 48, maxHeight: 120,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },

  // Suggestions — secondary, below the composer, visually softer
  chipRailContainer: { flexGrow: 0, maxHeight: 44 },
  chipRail: { paddingHorizontal: space.xl, gap: 6, paddingVertical: 6, alignItems: 'center' },
  chip: {
    alignSelf: 'center',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  chipTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },

  disclosure: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: space.xl, paddingBottom: 10, paddingTop: 2,
  },
  disclosureTxt: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10, flex: 1 },
});
