import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, ActivityIndicator, Alert, Platform, Keyboard, KeyboardAvoidingView } from 'react-native';
import SafeImage from '../../src/components/SafeImage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Send, ImagePlus, MapPin, User as UserIcon, ShieldCheck } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import ReadReceipt from '../../src/components/ReadReceipt';
import UserBadge from '../../src/components/UserBadge';
import { formatMessageTime, isPaidPlan, isElitePlan } from '../../src/utils/messageTime';

const QUICK_STARTERS = [
  'Love your work.',
  'Interested in collaborating?',
  'Are you available for a referral?',
  'Question about one of your locations.',
  'Need a second shooter?',
  'What lens did you use there?',
];

import ScreenErrorBoundary from '../../src/components/ScreenErrorBoundary';

export default function ThreadScreen() {
  return (
    <ScreenErrorBoundary label="Messages">
      <ThreadScreenImpl />
    </ScreenErrorBoundary>
  );
}

function ThreadScreenImpl() {
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const threadId = String(id || '');
  const [thread, setThread] = useState<any>(null);
  const [other, setOther] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<any> | null>(null);

  // FIX(Batch-1 messaging spacing): the composer previously stacked
  // SafeAreaView bottom inset + space.xl hardcoded padding + KAV's
  // padding behavior — visible as a ~80pt dead zone between input bar
  // and the iOS keyboard. Track keyboard state so when it's up we drop
  // the bottom inset entirely (KAV already lifts us past it), and when
  // it's down we honour the home-indicator safe area.
  const insets = useSafeAreaInsets();
  const [kbShown, setKbShown] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s1 = Keyboard.addListener(showEvt, () => setKbShown(true));
    const s2 = Keyboard.addListener(hideEvt, () => setKbShown(false));
    return () => { s1.remove(); s2.remove(); };
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/dm/threads/${threadId}`);
      setThread(r.thread);
      setOther(r.other);
      setMessages(r.messages || []);
      await api.post(`/dm/threads/${threadId}/mark-read`, {});
    } catch (e: any) {
      Alert.alert('Thread unavailable', e?.message || 'Please try again');
      router.back();
    } finally { setLoading(false); }
  }, [threadId]);

  useEffect(() => { load(); }, [load]);

  const send = async (payload: any) => {
    if (sending) return;
    setSending(true);
    try {
      const m = await api.post(`/dm/threads/${threadId}/messages`, payload);
      setMessages((p) => [...p, m]);
      setText('');
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e: any) {
      Alert.alert('Could not send', e?.message || 'Try again shortly');
    } finally { setSending(false); }
  };

  const sendText = () => {
    const t = text.trim();
    if (!t) return;
    send({ type: 'text', body: t });
  };

  const sendImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') return;
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true, quality: 0.7,
    });
    if (r.canceled || !r.assets?.[0]?.base64) return;
    send({ type: 'image', attachment_url: `data:image/jpeg;base64,${r.assets[0].base64}` });
  };

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn} testID="thread-back">
          <ChevronLeft size={22} color={colors.text}/>
        </Pressable>
        <Pressable onPress={() => other?.user_id && router.push(`/user/${other.user_id}` as any)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          {other?.avatar_url ? <SafeImage source={{ uri: other.avatar_url }} style={s.hAvatar}/> : <View style={[s.hAvatar,{backgroundColor:colors.surface2,alignItems:'center',justifyContent:'center'}]}><Text style={{color:colors.textSecondary,fontFamily:font.bodyBold,fontSize:12}}>{other?.name?.[0]?.toUpperCase() || '?'}</Text></View>}
          <View style={{ flex: 1 }}>
            <Text style={s.hName} numberOfLines={1}>{other?.name || '@'+(other?.username || '')} {other?.verification_status === 'verified' ? <ShieldCheck size={13} color="#3b82f6"/> : null}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <UserBadge user={other} variant="compact" />
              <Text style={s.hMeta} numberOfLines={1}>{other?.city ? `${other.city}${other.state ? `, ${other.state}` : ''}` : 'Photographer'}</Text>
            </View>
          </View>
        </Pressable>
      </View>

      {/* FIX(Batch-1 v2 messaging flush): scrapped KeyboardSafeDocked
          wrapper (it applied its own offset that fought ours). Moved
          header + content + composer INSIDE a single KeyboardAvoidingView
          with keyboardVerticalOffset=0 — the KAV now represents the full
          screen so RN's internal layout can position the composer
          flush against the keyboard top. This is the pattern Apple's
          own Messages.app effectively uses and the one that eliminates
          the last of the double-counted padding. */}
      <View style={{ flex: 1 }}>
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={colors.primary}/>
          </View>
        ) : (
          <>
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(m) => m.message_id}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
              contentContainerStyle={{ padding: space.md, gap: 8, paddingBottom: 90 }}
              ListEmptyComponent={
                <View style={s.emptyWrap}>
                  <Text style={s.emptyTitle}>Say hi 👋</Text>
                  <Text style={s.emptySub}>Pick a quick-starter below or type a message.</Text>
                  <View style={s.starters}>
                    {QUICK_STARTERS.map((q) => (
                      <Pressable key={q} onPress={() => send({ type: 'text', body: q })} style={s.starter} testID={`starter-${q.slice(0,10)}`}>
                        <Text style={s.starterTxt}>{q}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              }
              renderItem={({ item, index }) => {
                const mine = item.sender_user_id === user?.user_id;
                // Show the read-receipt line on the LAST outbound message only
                // (Instagram/iMessage convention). Earlier messages keep a
                // plain timestamp for a clean bubble stack.
                let isLastMine = false;
                if (mine) {
                  isLastMine = true;
                  for (let j = index + 1; j < messages.length; j++) {
                    if (messages[j]?.sender_user_id === user?.user_id) {
                      isLastMine = false;
                      break;
                    }
                  }
                }
                return (
                  <View style={[s.row, mine ? s.rowMine : s.rowTheirs]}>
                    <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleTheirs]}>
                      {item.type === 'text' ? (
                        <Text style={[s.msgText, mine && { color: colors.textInverse }]}>{item.body}</Text>
                      ) : null}
                      {item.type === 'image' && item.attachment_url ? (
                        <SafeImage source={{ uri: item.attachment_url }} style={s.msgImg} />
                      ) : null}
                      {item.type === 'spot_share' && item.spot_ref ? (
                        <Pressable onPress={() => router.push(`/spot/${item.spot_ref.spot_id}` as any)} style={s.refCard}>
                          {item.spot_ref.cover_image_url ? <SafeImage source={{ uri: item.spot_ref.cover_image_url }} style={s.refCover}/> : <View style={[s.refCover,{backgroundColor:colors.surface2,alignItems:'center',justifyContent:'center'}]}><MapPin size={18} color={colors.textTertiary}/></View>}
                          <View style={{ padding: 8 }}>
                            <Text style={s.refKicker}>SPOT</Text>
                            <Text style={s.refTitle} numberOfLines={1}>{item.spot_ref.title}</Text>
                            {item.spot_ref.city ? <Text style={s.refMeta}>{item.spot_ref.city}{item.spot_ref.state ? `, ${item.spot_ref.state}` : ''}</Text> : null}
                          </View>
                        </Pressable>
                      ) : null}
                      {item.type === 'profile_share' && item.user_ref ? (
                        <Pressable onPress={() => router.push(`/user/${item.user_ref.user_id}` as any)} style={s.refCard}>
                          <View style={[s.refCover,{backgroundColor:colors.surface2,alignItems:'center',justifyContent:'center',aspectRatio:1}]}>
                            {item.user_ref.avatar_url ? <SafeImage source={{ uri: item.user_ref.avatar_url }} style={{ width: 64, height: 64, borderRadius: 32 }}/> : <UserIcon size={28} color={colors.textTertiary}/>}
                          </View>
                          <View style={{ padding: 8 }}>
                            <Text style={s.refKicker}>PHOTOGRAPHER</Text>
                            <Text style={s.refTitle} numberOfLines={1}>{item.user_ref.name || '@'+item.user_ref.username}</Text>
                            {item.user_ref.city ? <Text style={s.refMeta}>{item.user_ref.city}</Text> : null}
                          </View>
                        </Pressable>
                      ) : null}
                      <Text style={[s.ts, mine && { color: 'rgba(255,255,255,0.7)' }]}>
                        {/* Free: no timestamps. Pro/Elite: accurate
                            local-timezone clock. (Batch #9A) */}
                        {isPaidPlan(user?.plan)
                          ? formatMessageTime(item.created_at, user?.plan, 'clock')
                          : ''}
                      </Text>
                      {/* Elite-only read receipts on sent messages (Batch #9A).
                          Backend already stamps seen_at on recipient open;
                          we only render it for Elite senders. */}
                      {isLastMine && isElitePlan(user?.plan) ? (
                        <ReadReceipt
                          deliveredAt={item.delivered_at}
                          seenAt={item.seen_at}
                          mine
                        />
                      ) : null}
                    </View>
                  </View>
                );
              }}
            />
            <View style={[s.composer, { paddingBottom: kbShown ? 10 : Math.max(insets.bottom, 10) }]}>
              <Pressable onPress={sendImage} style={s.attachBtn} testID="thread-image"><ImagePlus size={20} color={colors.text}/></Pressable>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Type a message…"
                placeholderTextColor={colors.textTertiary}
                style={s.composerInp}
                multiline
                testID="thread-input"
              />
              <Pressable onPress={sendText} disabled={sending || !text.trim()} style={[s.sendBtn, (!text.trim() || sending) && { opacity: 0.45 }]} testID="thread-send">
                {sending ? <ActivityIndicator color={colors.textInverse}/> : <Send size={18} color={colors.textInverse}/>}
              </Pressable>
            </View>
          </>
        )}
      </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  hAvatar: { width: 36, height: 36, borderRadius: 18 },
  hName: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  hMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  row: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', padding: 10, borderRadius: radii.md, gap: 4 },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 2 },
  bubbleTheirs: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 2 },
  msgText: { color: colors.text, fontFamily: font.body, fontSize: 14 },
  msgImg: { width: 220, height: 180, borderRadius: radii.sm },
  ts: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10, marginTop: 2 },
  refCard: { width: 220, backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: radii.sm, overflow: 'hidden' },
  refCover: { width: '100%', aspectRatio: 16 / 10 },
  refKicker: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.5 },
  refTitle: { color: '#fff', fontFamily: font.bodySemibold, fontSize: 13, marginTop: 2 },
  refMeta: { color: 'rgba(255,255,255,0.75)', fontFamily: font.body, fontSize: 11 },
  emptyWrap: { alignItems: 'center', padding: space.xl, gap: 6 },
  emptyTitle: { color: colors.text, fontFamily: font.display, fontSize: 18 },
  emptySub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13 },
  starters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 12 },
  starter: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: 'rgba(245,166,35,0.10)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)' },
  starterTxt: { color: colors.primary, fontFamily: font.bodyMedium, fontSize: 11 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.bg },
  attachBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  composerInp: { flex: 1, minHeight: 40, maxHeight: 120, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, color: colors.text, fontFamily: font.body, fontSize: 14 },
  sendBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.primary },
});
