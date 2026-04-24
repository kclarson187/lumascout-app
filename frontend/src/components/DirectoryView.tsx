/**
 * DirectoryView — Photographer Directory inside the Network tab.
 *
 * Hits GET /api/directory with sort/filter/specialty params and renders
 * a fast-scrolling list of cards. Sticky search bar at top, filter pills
 * (All / Nearby / Verified / Elite / New / Popular / Available), sort
 * segmented pill, then specialty chips, then list with cursor pagination.
 *
 * Premium soft-boost is server-side: ELITE > PRO > FREE within identical
 * sort keys. The card displays the right badge so users see why an
 * Elite member showed up first.
 *
 * June 2026 — Photographer Directory PRD.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  Image,
  ActivityIndicator,
  ScrollView,
  FlatList,
} from 'react-native';
import { router } from 'expo-router';
import {
  Search,
  X,
  ShieldCheck,
  Star,
  MapPin,
  MessageCircle,
  UserPlus,
  Check,
  Sparkles,
} from 'lucide-react-native';
import { api, formatApiError } from '../api';
import { useAuth } from '../auth';
import { colors, font, space, radii } from '../theme';

// Filter pills (single-row scroll)
const FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'nearby', label: 'Nearby' },
  { key: 'verified', label: 'Verified' },
  { key: 'elite', label: 'Elite' },
  { key: 'pro', label: 'Pro' },
  { key: 'new', label: 'New' },
  { key: 'popular', label: 'Popular' },
  { key: 'available', label: 'Available' },
];

// Sort segmented pill
const SORTS: Array<{ key: string; label: string }> = [
  { key: 'popular', label: 'Popular' },
  { key: 'nearby', label: 'Nearby' },
  { key: 'recent', label: 'Active' },
  { key: 'new', label: 'New' },
  { key: 'name', label: 'A–Z' },
];

// Specialty chips — keep aligned with the same niche taxonomy used elsewhere.
const SPECIALTIES = [
  'Wedding', 'Portrait', 'Family', 'Pet', 'Maternity',
  'Newborn', 'Real Estate', 'Landscape', 'Drone', 'Events',
  'Brand', 'Fashion', 'Food', 'Sports', 'Automotive',
  'Content Creator',
];

type DirItem = {
  user_id: string;
  name?: string;
  username?: string;
  avatar_url?: string;
  city?: string;
  state?: string;
  specialties?: string[];
  verification_status?: string;
  plan?: string;
  follower_count?: number;
  bio?: string;
  is_following?: boolean;
};

function PlanBadge({ u }: { u: DirItem }) {
  if (u.plan === 'elite') {
    return (
      <View style={[s.badge, s.badgeElite]} testID="badge-elite">
        <Star size={9} color="#1a1300" fill="#1a1300" strokeWidth={0} />
        <Text style={[s.badgeTxt, { color: '#1a1300' }]}>ELITE</Text>
      </View>
    );
  }
  if (u.plan === 'pro') {
    return (
      <View style={[s.badge, s.badgePro]}>
        <Star size={9} color={colors.primary} />
        <Text style={[s.badgeTxt, { color: colors.primary }]}>PRO</Text>
      </View>
    );
  }
  return null;
}

function DirectoryCard({
  u,
  onFollow,
  onMessage,
  busyFollow,
}: {
  u: DirItem;
  onFollow: (u: DirItem) => void;
  onMessage: (u: DirItem) => void;
  busyFollow: boolean;
}) {
  const elite = u.plan === 'elite';
  return (
    <Pressable
      style={[s.card, elite && s.cardElite]}
      onPress={() => router.push(`/user/${u.user_id}` as any)}
      testID={`directory-card-${u.user_id}`}
    >
      <View style={s.cardTop}>
        <View style={s.avatarWrap}>
          {u.avatar_url ? (
            <Image source={{ uri: u.avatar_url }} style={s.avatar} />
          ) : (
            <View style={[s.avatar, s.avatarPh]}>
              <Text style={s.avatarPhTxt}>
                {(u.name || u.username || '?').slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
          {elite ? (
            <View style={s.eliteRing} pointerEvents="none" />
          ) : null}
        </View>
        <View style={{ flex: 1 }}>
          <View style={s.nameRow}>
            <Text style={s.name} numberOfLines={1}>
              {u.name || `@${u.username || 'user'}`}
            </Text>
            {u.verification_status === 'verified' ? (
              <ShieldCheck size={13} color="#3b82f6" />
            ) : null}
            <PlanBadge u={u} />
          </View>
          {u.username ? <Text style={s.handle}>@{u.username}</Text> : null}
          {(u.city || u.state) ? (
            <View style={s.locRow}>
              <MapPin size={10} color={colors.textTertiary} />
              <Text style={s.loc}>
                {u.city}{u.state ? (u.city ? `, ${u.state}` : u.state) : ''}
              </Text>
              {typeof u.follower_count === 'number' ? (
                <Text style={s.dot}> · </Text>
              ) : null}
              {typeof u.follower_count === 'number' ? (
                <Text style={s.followers}>
                  {u.follower_count.toLocaleString()} follower{u.follower_count === 1 ? '' : 's'}
                </Text>
              ) : null}
            </View>
          ) : typeof u.follower_count === 'number' ? (
            <Text style={s.followers}>
              {u.follower_count.toLocaleString()} follower{u.follower_count === 1 ? '' : 's'}
            </Text>
          ) : null}
        </View>
      </View>
      {u.specialties && u.specialties.length > 0 ? (
        <View style={s.specRow}>
          {u.specialties.slice(0, 4).map((sp) => (
            <View key={sp} style={s.specChip}>
              <Text style={s.specTxt}>{sp}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={s.actions}>
        <Pressable
          onPress={() => onFollow(u)}
          disabled={busyFollow}
          style={[s.actionBtn, u.is_following ? s.actionFollowing : s.actionFollow]}
          testID={`directory-follow-${u.user_id}`}
        >
          {u.is_following ? (
            <>
              <Check size={13} color={colors.text} />
              <Text style={[s.actionTxt, { color: colors.text }]}>Following</Text>
            </>
          ) : (
            <>
              <UserPlus size={13} color={colors.textInverse} />
              <Text style={[s.actionTxt, { color: colors.textInverse }]}>Follow</Text>
            </>
          )}
        </Pressable>
        <Pressable
          onPress={() => onMessage(u)}
          style={[s.actionBtn, s.actionMessage]}
          testID={`directory-message-${u.user_id}`}
        >
          <MessageCircle size={13} color={colors.text} />
          <Text style={[s.actionTxt, { color: colors.text }]}>Message</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

export default function DirectoryView() {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('popular');
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [items, setItems] = useState<DirItem[]>([]);
  const [suggested, setSuggested] = useState<DirItem[]>([]);
  const [cursor, setCursor] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [paging, setPaging] = useState(false);
  const [busyFollow, setBusyFollow] = useState<string | null>(null);
  const debounceRef = useRef<any>(null);

  // Initial mount + filter / sort / specialty change → reset list
  const load = useCallback(async (resetCursor = true) => {
    if (resetCursor) {
      setLoading(true);
      setCursor(0);
    } else if (cursor === null) {
      return; // no more pages
    } else {
      setPaging(true);
    }
    try {
      const r = await api.get('/directory', {
        q: q || undefined,
        sort,
        filter,
        specialty: specialty || undefined,
        cursor: resetCursor ? 0 : cursor,
        limit: 20,
      });
      if (resetCursor) {
        setItems(r.items || []);
      } else {
        setItems((prev) => [...prev, ...(r.items || [])]);
      }
      setCursor(r.next_cursor);
    } catch {
      // Silent — leave previous items in place.
    } finally {
      setLoading(false);
      setPaging(false);
    }
  }, [q, sort, filter, specialty, cursor]);

  // Debounce search query so we don't spam the API on every keystroke.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      load(true);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // Disable exhaustive deps — `load` would re-create on every char.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, filter, specialty]);

  // Suggested ("People you may know") — load once.
  useEffect(() => {
    if (!user) return;
    api.get('/directory/suggested', { limit: 8 })
      .then((r) => setSuggested(r.items || []))
      .catch(() => setSuggested([]));
  }, [user]);

  const handleFollow = useCallback(async (u: DirItem) => {
    if (busyFollow) return;
    setBusyFollow(u.user_id);
    // Optimistic toggle
    setItems((prev) => prev.map((x) => x.user_id === u.user_id ? { ...x, is_following: !x.is_following } : x));
    try {
      if (u.is_following) {
        await api.delete(`/users/${u.user_id}/follow`);
      } else {
        await api.post(`/users/${u.user_id}/follow`, {});
      }
    } catch (e: any) {
      // Rollback on failure
      setItems((prev) => prev.map((x) => x.user_id === u.user_id ? { ...x, is_following: u.is_following } : x));
    } finally {
      setBusyFollow(null);
    }
  }, [busyFollow]);

  const handleMessage = useCallback(async (u: DirItem) => {
    try {
      const r = await api.post('/dm/threads/start', { participant_user_id: u.user_id });
      if (r?.thread_id) router.push(`/inbox/${r.thread_id}` as any);
      else router.push('/inbox');
    } catch (e: any) {
      // If it requires acceptance, the API still returns a thread_id we can land on.
      router.push('/inbox');
    }
  }, []);

  const headerNote = useMemo(() => {
    if (q) return null;
    const parts: string[] = [];
    if (filter !== 'all') parts.push(FILTERS.find((f) => f.key === filter)?.label || '');
    if (specialty) parts.push(specialty);
    return parts.length ? parts.join(' · ') : null;
  }, [q, filter, specialty]);

  return (
    <View style={s.root}>
      {/* Sticky search bar */}
      <View style={s.searchWrap}>
        <Search size={16} color={colors.textTertiary} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search photographers, city, specialty"
          placeholderTextColor={colors.textTertiary}
          style={s.searchInput}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          testID="directory-search"
        />
        {q.length > 0 ? (
          <Pressable onPress={() => setQ('')} style={s.searchClear} testID="directory-search-clear">
            <X size={14} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {/* Filter pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.pillRow}
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[s.pill, filter === f.key && s.pillActive]}
            testID={`directory-filter-${f.key}`}
          >
            <Text style={[s.pillTxt, filter === f.key && s.pillTxtActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Sort segmented */}
      <View style={s.sortRow}>
        <Text style={s.sortLabel}>Sort</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {SORTS.map((srt) => (
            <Pressable
              key={srt.key}
              onPress={() => setSort(srt.key)}
              style={[s.sortPill, sort === srt.key && s.sortPillActive]}
              testID={`directory-sort-${srt.key}`}
            >
              <Text style={[s.sortPillTxt, sort === srt.key && s.sortPillTxtActive]}>
                {srt.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Specialty chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.specChipRow}
      >
        <Pressable
          onPress={() => setSpecialty(null)}
          style={[s.specChipFilter, !specialty && s.specChipFilterActive]}
          testID="directory-specialty-all"
        >
          <Text style={[s.specChipFilterTxt, !specialty && s.specChipFilterTxtActive]}>All</Text>
        </Pressable>
        {SPECIALTIES.map((sp) => (
          <Pressable
            key={sp}
            onPress={() => setSpecialty(sp === specialty ? null : sp)}
            style={[s.specChipFilter, specialty === sp && s.specChipFilterActive]}
            testID={`directory-specialty-${sp}`}
          >
            <Text style={[s.specChipFilterTxt, specialty === sp && s.specChipFilterTxtActive]}>
              {sp}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Results */}
      {loading ? (
        <View style={{ padding: space.xl, alignItems: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={s.emptyWrap}>
          <Text style={s.emptyTitle}>No matches</Text>
          <Text style={s.emptySub}>
            {q ? `Nothing found for "${q}".` : 'No photographers match these filters.'}
            {'\n'}Try widening your search or clearing filters.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(u: DirItem) => u.user_id}
          contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: 80 }}
          ListHeaderComponent={
            <>
              {headerNote ? (
                <Text style={s.headerNote}>{headerNote}</Text>
              ) : null}
              {/* Suggested rail — only shows when not searching/filtering */}
              {!q && filter === 'all' && !specialty && suggested.length > 0 ? (
                <View style={s.sugWrap}>
                  <View style={s.sugHead}>
                    <Sparkles size={13} color={colors.primary} />
                    <Text style={s.sugTitle}>People you may know</Text>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {suggested.map((u) => (
                      <Pressable
                        key={u.user_id}
                        onPress={() => router.push(`/user/${u.user_id}` as any)}
                        style={s.sugCard}
                        testID={`directory-suggested-${u.user_id}`}
                      >
                        {u.avatar_url ? (
                          <Image source={{ uri: u.avatar_url }} style={s.sugAvatar} />
                        ) : (
                          <View style={[s.sugAvatar, s.avatarPh]}>
                            <Text style={s.avatarPhTxt}>{(u.name || '?').slice(0, 1).toUpperCase()}</Text>
                          </View>
                        )}
                        <Text style={s.sugName} numberOfLines={1}>
                          {u.name || `@${u.username}`}
                        </Text>
                        {u.city ? <Text style={s.sugLoc} numberOfLines={1}>{u.city}</Text> : null}
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </>
          }
          renderItem={({ item }) => (
            <DirectoryCard
              u={item}
              onFollow={handleFollow}
              onMessage={handleMessage}
              busyFollow={busyFollow === item.user_id}
            />
          )}
          onEndReached={() => {
            if (!paging && cursor !== null) load(false);
          }}
          onEndReachedThreshold={0.6}
          ListFooterComponent={paging ? (
            <ActivityIndicator color={colors.primary} style={{ paddingVertical: 16 }} />
          ) : null}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: space.xl,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontFamily: font.body,
    fontSize: 13,
    paddingVertical: 0,
  },
  searchClear: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: space.xl,
    paddingVertical: 10,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: {
    backgroundColor: 'rgba(245,166,35,0.16)',
    borderColor: colors.primary,
  },
  pillTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  pillTxtActive: { color: colors.primary, fontFamily: font.bodySemibold },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: space.xl,
    paddingBottom: 6,
  },
  sortLabel: { color: colors.textTertiary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.6 },
  sortPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.sm,
    backgroundColor: colors.surface2,
  },
  sortPillActive: {
    backgroundColor: colors.text,
  },
  sortPillTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  sortPillTxtActive: { color: colors.bg, fontFamily: font.bodyBold },
  specChipRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: space.xl,
    paddingVertical: 8,
  },
  specChipFilter: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  specChipFilterActive: {
    backgroundColor: 'rgba(245,166,35,0.10)',
    borderColor: colors.primary,
  },
  specChipFilterTxt: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  specChipFilterTxtActive: { color: colors.primary, fontFamily: font.bodySemibold },
  emptyWrap: { padding: space.xxl, alignItems: 'center' },
  emptyTitle: { color: colors.text, fontFamily: font.display, fontSize: 18 },
  emptySub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, textAlign: 'center', marginTop: 6, lineHeight: 18 },
  headerNote: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11, paddingVertical: 6 },
  // Suggested rail
  sugWrap: { paddingVertical: 8, marginBottom: 6 },
  sugHead: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  sugTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 12, letterSpacing: 0.3 },
  sugCard: {
    width: 96,
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sugAvatar: { width: 50, height: 50, borderRadius: 25, marginBottom: 6 },
  sugName: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 11, textAlign: 'center' },
  sugLoc: { color: colors.textTertiary, fontFamily: font.body, fontSize: 9, marginTop: 2, textAlign: 'center' },
  // Card
  card: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 12,
    marginBottom: 10,
  },
  // Premium soft-glow on Elite cards — subtle gold tint, not loud.
  cardElite: {
    borderColor: 'rgba(245,166,35,0.35)',
    backgroundColor: 'rgba(245,166,35,0.04)',
  },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  avatarWrap: { position: 'relative' },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  eliteRing: {
    position: 'absolute',
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: '#f5a623',
  },
  avatarPh: {
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarPhTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 16 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14, flexShrink: 1 },
  handle: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 1 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  loc: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  dot: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  followers: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeElite: {
    backgroundColor: '#f5a623',
    borderColor: '#f5a623',
  },
  badgePro: {
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderColor: 'rgba(245,166,35,0.4)',
  },
  badgeTxt: { fontFamily: font.bodyBold, fontSize: 8, letterSpacing: 0.6 },
  specRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  specChip: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: colors.surface2,
  },
  specTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 10 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 9,
    borderRadius: radii.md,
  },
  actionFollow: { backgroundColor: colors.primary },
  actionFollowing: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  actionMessage: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  actionTxt: { fontFamily: font.bodyBold, fontSize: 12 },
});

// suppress 'formatApiError' unused import lint if not referenced
void formatApiError;
