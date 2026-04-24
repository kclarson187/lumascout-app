import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Image, ActivityIndicator, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ShieldCheck, BellOff, Search, Pin, CheckCheck, X } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import { timeAgo } from '../../src/components/FreshnessBits';
import EliteBadge from '../../src/components/EliteBadge';
import ThreadActionSheet, { ThreadActionTarget } from '../../src/components/ThreadActionSheet';
import SwipeableThreadRow from '../../src/components/SwipeableThreadRow';
import { useUnreadMessages } from '../../src/hooks/useUnreadMessages';

/**
 * Tier 2 Inbox — Archive, Pin (cap 3), Search, Swipe actions, Mark-all-read.
 * Tabs: All · Archived · Requests.
 *
 * Swipe gestures (via react-native-gesture-handler Swipeable):
 *   - Swipe LEFT  → Archive (amber)
 *   - Swipe RIGHT → Pin / Unpin (gold)
 *
 * Long-press still opens the ThreadActionSheet with the full menu
 * (Pin · Archive · Mute · Block · Report · Delete Chat).
 */
type Tab = 'accepted' | 'archived' | 'requests';

export default function InboxScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>((params.tab as Tab) || 'accepted');
  const [threads, setThreads] = useState<any[]>([]);
  const [archived, setArchived] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionTarget, setActionTarget] = useState<ThreadActionTarget | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<TextInput | null>(null);
  const unread = useUnreadMessages();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, a, r] = await Promise.all([
        api.get('/dm/threads', { tab: 'accepted', limit: 50 }),
        api.get('/dm/threads', { tab: 'archived', limit: 50 }),
        api.get('/dm/threads', { tab: 'requests', limit: 50 }),
      ]);
      setThreads(t.items || []);
      setArchived(a.items || []);
      setRequests(r.items || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Focus the search input when opening it.
  useEffect(() => {
    if (searchOpen) setTimeout(() => searchRef.current?.focus(), 100);
    else setQuery('');
  }, [searchOpen]);

  const accept = async (req: any) => {
    await api.post(`/dm/requests/${req.request_id}/accept`, {});
    router.push(`/inbox/${req.thread_id}` as any);
  };
  const ignore = async (req: any) => {
    await api.post(`/dm/requests/${req.request_id}/ignore`, {});
    setRequests((p) => p.filter((x) => x.request_id !== req.request_id));
  };
  const block = async (req: any) => {
    await api.post(`/dm/requests/${req.request_id}/block`, {});
    setRequests((p) => p.filter((x) => x.request_id !== req.request_id));
  };

  // --- Client-side search (fast, no new endpoint needed) ---------------
  const visible = useMemo(() => {
    const src = tab === 'archived' ? archived : threads;
    if (!query.trim()) return src;
    const q = query.toLowerCase().trim();
    return src.filter((row) => {
      const o = row.other || {};
      const hay = `${o.name || ''} ${o.username || ''} ${row.last_message_preview || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [tab, threads, archived, query]);

  const markAllRead = async () => {
    try {
      const r = await api.post('/dm/threads/mark-all-read', {});
      // Locally zero-out unread counts so the UI feels instant.
      setThreads((prev) => prev.map((t) => ({ ...t, unread_count: 0 })));
      unread.refresh();
      if (r?.messages_updated) {
        Alert.alert('All caught up', `${r.messages_updated} message${r.messages_updated === 1 ? '' : 's'} marked as read.`);
      }
    } catch (e: any) {
      Alert.alert('Could not update', formatApiError(e));
    }
  };

  // --- Optimistic mutators for swipe + action sheet callbacks ----------
  const handleArchivedChange = (threadId: string, isArchived: boolean) => {
    if (isArchived) {
      // Move from active → archived
      const found = threads.find((t) => t.thread_id === threadId);
      setThreads((prev) => prev.filter((t) => t.thread_id !== threadId));
      if (found) setArchived((prev) => [{ ...found, is_archived: true }, ...prev]);
    } else {
      // Move from archived → active
      const found = archived.find((t) => t.thread_id === threadId);
      setArchived((prev) => prev.filter((t) => t.thread_id !== threadId));
      if (found) setThreads((prev) => [{ ...found, is_archived: false }, ...prev]);
    }
    unread.refresh();
  };

  const handlePinnedChange = (threadId: string, isPinned: boolean) => {
    setThreads((prev) => {
      const next = prev.map((t) =>
        t.thread_id === threadId
          ? { ...t, is_pinned: isPinned, pinned_at: isPinned ? new Date().toISOString() : null }
          : t,
      );
      // Re-sort: pinned first (by pinned_at desc), then rest by last_message_at desc.
      const pinned = next.filter((r) => r.is_pinned).sort((a, b) => (b.pinned_at || '').localeCompare(a.pinned_at || ''));
      const rest = next.filter((r) => !r.is_pinned);
      return [...pinned, ...rest];
    });
  };

  const quickArchive = async (row: any) => {
    try {
      if (row.is_archived) {
        await api.delete(`/dm/threads/${row.thread_id}/archive`);
        handleArchivedChange(row.thread_id, false);
      } else {
        await api.post(`/dm/threads/${row.thread_id}/archive`, {});
        handleArchivedChange(row.thread_id, true);
      }
    } catch (e: any) { Alert.alert('Could not update', formatApiError(e)); }
  };

  const quickTogglePin = async (row: any) => {
    try {
      if (row.is_pinned) {
        await api.delete(`/dm/threads/${row.thread_id}/pin`);
        handlePinnedChange(row.thread_id, false);
      } else {
        await api.post(`/dm/threads/${row.thread_id}/pin`, {});
        handlePinnedChange(row.thread_id, true);
      }
    } catch (e: any) { Alert.alert('Pin limit reached', formatApiError(e)); }
  };

  const renderThreadRow = ({ item }: { item: any }) => {
    const o = item.other || {};
    const unreadRow = item.unread_count > 0;
    const pinned = !!item.is_pinned;
    const archivedRow = tab === 'archived';
    return (
      <SwipeableThreadRow
        isPinned={pinned}
        onArchive={archivedRow ? undefined : () => quickArchive(item)}
        onTogglePin={archivedRow ? undefined : () => quickTogglePin(item)}
        testID={`swipe-${item.thread_id}`}
      >
        <Pressable
          onPress={() => router.push(`/inbox/${item.thread_id}` as any)}
          onLongPress={() => setActionTarget({
            thread_id: item.thread_id,
            other_user_id: o.user_id,
            other_name: o.name || (o.username ? `@${o.username}` : 'Conversation'),
            is_muted: !!item.is_muted,
            is_archived: !!item.is_archived,
            is_pinned: !!item.is_pinned,
          })}
          delayLongPress={350}
          style={[s.threadRow, pinned && s.threadRowPinned]}
          testID={`thread-${item.thread_id}`}
        >
          {o.avatar_url ? <Image source={{ uri: o.avatar_url }} style={s.tAvatar}/> : <View style={[s.tAvatar,{backgroundColor:colors.surface2,alignItems:'center',justifyContent:'center'}]}><Text style={{color:colors.textSecondary,fontFamily:font.bodyBold}}>{o.name?.[0]?.toUpperCase() || '?'}</Text></View>}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {pinned ? <Pin size={11} color="#f5a623" fill="#f5a623" /> : null}
              <Text style={[s.tName, unreadRow && { fontFamily: font.bodyBold }]} numberOfLines={1}>{o.name || '@'+o.username}</Text>
              {o.verification_status === 'verified' ? <ShieldCheck size={12} color="#3b82f6"/> : null}
              {o.plan === 'elite' ? <EliteBadge variant="compact" /> : null}
              {item.is_muted ? <BellOff size={11} color={colors.textTertiary}/> : null}
              <Text style={s.tTime}>{timeAgo(item.last_message_at) || timeAgo(item.created_at)}</Text>
            </View>
            <Text style={[s.tPreview, unreadRow && { color: colors.text }]} numberOfLines={1}>{item.last_message_preview || 'Start a conversation…'}</Text>
          </View>
          {unreadRow ? <View style={s.tUnreadDot}><Text style={s.tUnreadTxt}>{item.unread_count > 9 ? '9+' : item.unread_count}</Text></View> : null}
        </Pressable>
      </SwipeableThreadRow>
    );
  };

  const emptyForTab = () => {
    if (tab === 'archived') return 'No archived conversations.\nSwipe left on a thread to archive it.';
    if (tab === 'requests') return 'No message requests.';
    if (query.trim()) return `No threads match "${query.trim()}".`;
    return 'No conversations yet. Find a photographer to message in the Network tab.';
  };

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn} testID="inbox-back">
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>INBOX</Text>
          <Text style={s.title}>Messages</Text>
        </View>
        {/* Header actions: search + mark-all-read. Mark-all-read only
            when there's unread pressure on the ACTIVE inbox. */}
        <Pressable
          onPress={() => setSearchOpen((v) => !v)}
          style={s.headerBtn}
          testID="inbox-search-toggle"
        >
          {searchOpen ? <X size={18} color={colors.text}/> : <Search size={18} color={colors.text}/>}
        </Pressable>
        {tab !== 'requests' && unread.unread_messages > 0 ? (
          <Pressable onPress={markAllRead} style={s.markAllBtn} testID="inbox-mark-all-read">
            <CheckCheck size={14} color={colors.primary}/>
            <Text style={s.markAllTxt}>Mark all read</Text>
          </Pressable>
        ) : null}
      </View>

      {searchOpen ? (
        <View style={s.searchWrap}>
          <Search size={16} color={colors.textTertiary} />
          <TextInput
            ref={searchRef}
            value={query}
            onChangeText={setQuery}
            placeholder="Search conversations…"
            placeholderTextColor={colors.textTertiary}
            style={s.searchInput}
            testID="inbox-search-input"
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} style={s.searchClear} testID="inbox-search-clear">
              <X size={14} color={colors.textSecondary}/>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={s.tabs}>
        <Pressable onPress={() => setTab('accepted')} style={[s.tab, tab === 'accepted' && s.tabActive]} testID="inbox-tab-accepted">
          <Text style={[s.tabTxt, tab === 'accepted' && s.tabTxtActive]}>All</Text>
        </Pressable>
        <Pressable onPress={() => setTab('archived')} style={[s.tab, tab === 'archived' && s.tabActive]} testID="inbox-tab-archived">
          <Text style={[s.tabTxt, tab === 'archived' && s.tabTxtActive]}>Archived{archived.length > 0 ? `  ·  ${archived.length}` : ''}</Text>
        </Pressable>
        <Pressable onPress={() => setTab('requests')} style={[s.tab, tab === 'requests' && s.tabActive]} testID="inbox-tab-requests">
          <Text style={[s.tabTxt, tab === 'requests' && s.tabTxtActive]}>Requests{requests.length > 0 ? `  ·  ${requests.length}` : ''}</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : tab === 'requests' ? (
        <FlatList
          data={requests}
          keyExtractor={(r) => r.request_id}
          ListEmptyComponent={<Text style={s.empty}>{emptyForTab()}</Text>}
          contentContainerStyle={{ padding: space.md }}
          renderItem={({ item }) => {
            const se = item.sender || {};
            return (
              <View style={s.reqCard} testID={`req-${item.request_id}`}>
                <Pressable onPress={() => router.push(`/user/${se.user_id}` as any)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                  {se.avatar_url ? <Image source={{ uri: se.avatar_url }} style={s.reqAvatar}/> : <View style={[s.reqAvatar,{backgroundColor:colors.surface2, alignItems:'center', justifyContent:'center'}]}><Text style={{color:colors.textSecondary,fontFamily:font.bodyBold}}>{se.name?.[0]?.toUpperCase() || '?'}</Text></View>}
                  <View style={{ flex: 1 }}>
                    <Text style={s.reqName}>{se.name || '@'+se.username}{se.verification_status === 'verified' ? ' ' : ''}{se.verification_status === 'verified' ? <ShieldCheck size={12} color="#3b82f6"/> : null}</Text>
                    <Text style={s.reqMeta}>{se.city ? `${se.city}${se.state ? `, ${se.state}` : ''}` : 'Photographer'} · {timeAgo(item.created_at)}</Text>
                    {item.kind && item.kind !== 'message' ? <Text style={s.reqKind}>{item.kind === 'refer' ? '💌 Referral request' : item.kind === 'collab' ? '🤝 Collab invite' : ''}</Text> : null}
                  </View>
                </Pressable>
                <View style={s.reqActions}>
                  <Pressable onPress={() => accept(item)} style={[s.reqBtn, s.reqAccept]} testID={`req-accept-${item.request_id}`}>
                    <Text style={s.reqAcceptTxt}>Accept</Text>
                  </Pressable>
                  <Pressable onPress={() => ignore(item)} style={s.reqBtn} testID={`req-ignore-${item.request_id}`}>
                    <Text style={s.reqBtnTxt}>Ignore</Text>
                  </Pressable>
                  <Pressable onPress={() => block(item)} style={s.reqBtn} testID={`req-block-${item.request_id}`}>
                    <Text style={[s.reqBtnTxt,{color:colors.secondary || '#ef4444'}]}>Block</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(t) => t.thread_id}
          ListEmptyComponent={<Text style={s.empty}>{emptyForTab()}</Text>}
          renderItem={renderThreadRow}
          ItemSeparatorComponent={() => <View style={s.sep}/>}
        />
      )}
      <ThreadActionSheet
        visible={!!actionTarget}
        target={actionTarget}
        onClose={() => setActionTarget(null)}
        onDeleted={(tid) => {
          setThreads((prev) => prev.filter((t) => t.thread_id !== tid));
          setArchived((prev) => prev.filter((t) => t.thread_id !== tid));
        }}
        onMuted={(tid, isMuted) => {
          setThreads((prev) => prev.map((t) => t.thread_id === tid ? { ...t, is_muted: isMuted } : t));
          setArchived((prev) => prev.map((t) => t.thread_id === tid ? { ...t, is_muted: isMuted } : t));
        }}
        onBlocked={() => { load(); }}
        onArchived={handleArchivedChange}
        onPinned={handlePinnedChange}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  kicker: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.8 },
  title: { color: colors.text, fontFamily: font.display, fontSize: 22 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  markAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: 'rgba(245,166,35,0.12)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.5)' },
  markAllTxt: { color: colors.primary, fontFamily: font.bodySemibold, fontSize: 11 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: space.xl, marginBottom: space.sm,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontFamily: font.body,
    fontSize: 13,
    paddingVertical: 0,
  },
  searchClear: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  tabs: { flexDirection: 'row', gap: 6, paddingHorizontal: space.xl, paddingBottom: space.sm },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: 'rgba(245,166,35,0.14)', borderColor: colors.primary },
  tabTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  tabTxtActive: { color: colors.primary, fontFamily: font.bodySemibold },
  empty: { textAlign: 'center', padding: space.xl, color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 20 },
  threadRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: space.xl, paddingVertical: 12, backgroundColor: colors.bg },
  // Subtle gold tint on pinned rows so they feel elevated without shouting.
  threadRowPinned: { backgroundColor: 'rgba(245,166,35,0.05)' },
  tAvatar: { width: 46, height: 46, borderRadius: 23 },
  tName: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14, flex: 1 },
  tTime: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10 },
  tPreview: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
  tUnreadDot: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  tUnreadTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 10 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 70 },
  reqCard: { padding: 12, marginBottom: 10, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, gap: 10 },
  reqAvatar: { width: 46, height: 46, borderRadius: 23 },
  reqName: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  reqMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  reqKind: { color: colors.primary, fontFamily: font.bodyMedium, fontSize: 11, marginTop: 4 },
  reqActions: { flexDirection: 'row', gap: 6, justifyContent: 'flex-end' },
  reqBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  reqAccept: { backgroundColor: colors.primary, borderColor: colors.primary },
  reqBtnTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  reqAcceptTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 12 },
});
