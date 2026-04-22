import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Send } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import VerifiedBadge from '../../src/components/VerifiedBadge';

export default function Thread() {
  const { id, user: userQ } = useLocalSearchParams<{ id?: string; user?: string }>();
  const { user: me } = useAuth();
  const [convoId, setConvoId] = useState<string | null>(id === 'new' ? null : (id || null));
  const [other, setOther] = useState<any | null>(null);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">(null);

  // If we arrived with ?user=<id>, ensure a conversation exists (idempotent).
  useEffect(() => {
    (async () => {
      try {
        if (id === 'new' && userQ) {
          const c = await api.post('/conversations', { participant_user_id: userQ });
          setConvoId(c.conversation_id);
        }
      } catch (e) { Alert.alert('Could not open chat', formatApiError(e)); router.back(); }
    })();
  }, [id, userQ]);

  const load = useCallback(async () => {
    if (!convoId) return;
    try {
      const m = await api.get(`/conversations/${convoId}/messages`);
      setMsgs(m || []);
      // Fetch inbox to get 'other' summary cheaply
      const list = await api.get('/me/conversations');
      const row = (list || []).find((c: any) => c.conversation_id === convoId);
      if (row) setOther(row.other);
    } finally { setLoading(false); }
  }, [convoId]);

  useEffect(() => {
    load();
    // Simple polling for near-realtime feel.
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (msgs.length > 0) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
  }, [msgs.length]);

  const send = async () => {
    if (!draft.trim() || !convoId) return;
    setSending(true);
    const body = draft.trim();
    setDraft('');
    try {
      const m = await api.post(`/conversations/${convoId}/messages`, { body });
      setMsgs((prev) => [...prev, m]);
    } catch (e) { Alert.alert('Could not send', formatApiError(e)); }
    finally { setSending(false); }
  };

  if (loading && !convoId) return <ActivityIndicator color={colors.primary} style={{ flex: 1 }} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.head}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ChevronLeft size={22} color={colors.text} /></TouchableOpacity>
          <TouchableOpacity
            style={styles.recipient}
            onPress={() => other?.user_id && router.push(`/user/${other.user_id}` as any)}
          >
            {other?.avatar_url
              ? <Image source={{ uri: other.avatar_url }} style={styles.avatar} />
              : <View style={[styles.avatar, { backgroundColor: colors.surface2 }]} />}
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={styles.name}>{other?.name || 'Chat'}</Text>
                <VerifiedBadge status={other?.verification_status} variant="inline" size={12} />
              </View>
              <Text style={styles.meta}>@{other?.username || ''}</Text>
            </View>
          </TouchableOpacity>
        </View>

        <ScrollView ref={scrollRef} contentContainerStyle={{ padding: space.md, gap: 6, paddingBottom: space.xl }}>
          {msgs.length === 0 && !loading && (
            <Text style={styles.empty}>Say hi. Photographers help photographers — start with a clear ask or intro.</Text>
          )}
          {msgs.map((m) => {
            const mine = m.sender_user_id === me?.user_id;
            return (
              <View key={m.message_id} style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                <Text style={[styles.bubbleTxt, mine && { color: colors.textInverse }]}>{m.body}</Text>
                <Text style={[styles.bubbleTime, mine && { color: 'rgba(255,255,255,0.7)' }]}>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Type a message…"
            placeholderTextColor={colors.textTertiary}
            style={styles.composerInput}
            multiline
            testID="thread-input"
          />
          <TouchableOpacity
            onPress={send}
            disabled={!draft.trim() || sending}
            style={[styles.sendBtn, (!draft.trim() || sending) && { opacity: 0.4 }]}
            testID="thread-send"
          >
            {sending ? <ActivityIndicator size="small" color={colors.textInverse} /> : <Send size={16} color={colors.textInverse} />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingVertical: space.sm, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  recipient: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  name: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  meta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  empty: { color: colors.textTertiary, fontFamily: font.body, fontSize: 13, textAlign: 'center', paddingHorizontal: space.xl, marginTop: 40 },
  bubble: { maxWidth: '78%', paddingHorizontal: 12, paddingVertical: 9, borderRadius: radii.lg, gap: 2 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderBottomLeftRadius: 4 },
  bubbleTxt: { color: colors.text, fontFamily: font.body, fontSize: 14, lineHeight: 19 },
  bubbleTime: { color: colors.textTertiary, fontFamily: font.body, fontSize: 9, alignSelf: 'flex-end' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: space.md, backgroundColor: colors.surface1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  composerInput: { flex: 1, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontFamily: font.body, fontSize: 14, maxHeight: 100 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
