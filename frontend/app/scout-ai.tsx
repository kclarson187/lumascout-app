/**
 * Scout AI — full chat screen.
 * Phase 1: stateless (no persisted chat history), single-session conversation.
 * Receives optional prefilled query (`q`), placement, and spot_id via params.
 *
 * Clearly discloses AI-generated content at three levels:
 *   - the header subtitle (“Official PhotoScout AI assistant”)
 *   - a persistent "OFFICIAL AI" badge next to every assistant message
 *   - an inline disclosure footer beneath the input
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
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

const DEFAULT_FOLLOW_UPS = [
  'Where should I shoot this weekend?',
  'Best sunset portrait spots near me',
  'Explain my Shoot Score',
];

export default function ScoutAIScreen() {
  const params = useLocalSearchParams<{ q?: string; placement?: string; spot_id?: string }>();
  const placement = params.placement || 'home';
  const spotId = params.spot_id;
  const prefill = typeof params.q === 'string' ? params.q : undefined;

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [followUps, setFollowUps] = useState<string[]>(DEFAULT_FOLLOW_UPS);
  const scrollRef = useRef<ScrollView | null>(null);
  const didAutoSend = useRef(false);

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
      // Rollback the optimistic user message so they can retry easily.
      setMessages((prev) => prev.slice(0, -1));
      setInput(content);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages, loading, spotId, placement]);

  // Auto-send the prefilled query once on mount (if supplied) so taps from
  // entry-point cards feel instant.
  useEffect(() => {
    if (!didAutoSend.current && prefill) {
      didAutoSend.current = true;
      send(prefill);
    }
  }, [prefill, send]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="scout-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerAvatar}>
          <ScoutAIAvatar size={38} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.title}>Scout AI</Text>
            <View style={styles.aiBadge}>
              <Sparkles size={9} color={colors.primary} />
              <Text style={styles.aiBadgeTxt}>OFFICIAL AI</Text>
            </View>
          </View>
          <Text style={styles.subtitle} numberOfLines={1}>Official PhotoScout AI assistant</Text>
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
        >
          {messages.length === 0 && !loading && (
            <View style={styles.intro}>
              <ScoutAIAvatar size={64} />
              <Text style={styles.introTitle}>How can I help today?</Text>
              <Text style={styles.introBody}>
                I can suggest spots, compare saved locations, help with uploads,
                and explain scores. I only use live PhotoScout data — if
                something isn't known, I'll say so.
              </Text>
            </View>
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
            <View style={[styles.msgRow]}>
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

        {/* Follow-up chips */}
        {!loading && followUps.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipRailContainer}
            contentContainerStyle={styles.chipRail}
          >
            {followUps.map((f) => (
              <TouchableOpacity key={f} onPress={() => send(f)} style={styles.chip} testID={`scout-followup-${f.slice(0,16)}`}>
                <Text style={styles.chipTxt} numberOfLines={1}>{f}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Composer */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Ask Scout AI anything…"
            placeholderTextColor={colors.textTertiary}
            value={input}
            onChangeText={setInput}
            editable={!loading}
            onSubmitEditing={() => send(input)}
            returnKeyType="send"
            multiline
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
  title: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.3 },
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

  scroll: { padding: space.xl, gap: 12, paddingBottom: 40 },
  intro: { alignItems: 'center', paddingTop: 32, gap: 10 },
  introTitle: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.3, marginTop: 10 },
  introBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center', lineHeight: 19, maxWidth: 320 },

  msgRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  msgRowUser: { justifyContent: 'flex-end' },
  msgAvatar: { width: 28, height: 28, borderRadius: 14, overflow: 'hidden' },
  bubble: { maxWidth: '82%', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14 },
  bubbleAi: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderTopLeftRadius: 4 },
  bubbleUser: { backgroundColor: colors.primary, borderTopRightRadius: 4 },
  msgTxt: { color: colors.text, fontFamily: font.body, fontSize: 14, lineHeight: 20 },

  chipRailContainer: { flexGrow: 0, maxHeight: 44 },
  chipRail: { paddingHorizontal: space.xl, gap: 6, paddingVertical: 8, alignItems: 'center' },
  chip: {
    alignSelf: 'center',
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  chipTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: space.xl, paddingTop: 6, paddingBottom: 6,
  },
  input: {
    flex: 1, color: colors.text, fontFamily: font.body, fontSize: 14,
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.lg, paddingHorizontal: 12, paddingVertical: 10,
    minHeight: 40, maxHeight: 120,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },

  disclosure: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: space.xl, paddingBottom: 10, paddingTop: 2,
  },
  disclosureTxt: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10, flex: 1 },
});
