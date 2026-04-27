/**
 * DirectoryView — Photographer Directory (premium rebuild, Apr 2026)
 *
 * Layout follows the founder's mockup pixel-for-pixel:
 *   1) Search bar (44px, gold focus accent)
 *   2) Three primary filter CARDS in one row: Nearby · Verified · New
 *      (no other pills — All / Elite / Pro / Popular were removed per PRD)
 *   3) Secondary controls justified-between: "Sort · <X> ▾"  on the left,
 *      "⚙ Specialties ▾" on the right (sheet-driven, never inline pills)
 *   4) Stacked premium creator cards with horizontal layout:
 *        avatar (with green online dot) | name + badges + meta | actions stack
 *
 * BUGFIXES (this revision):
 *   · Unfollow used DELETE /users/:id/follow → 404. Backend treats
 *     POST /users/:id/follow as a TOGGLE returning {following: bool}.
 *     We now always POST and trust the response.
 *   · dm/threads/start body had field `participant_user_id` → 404/422.
 *     Backend's DMStartIn expects `user_id`. Fixed.
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
  Modal,
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
  ChevronDown,
  SlidersHorizontal,
  RefreshCw,
  Users as UsersIcon,
  BadgeCheck,
} from 'lucide-react-native';
import { api } from '../api';
import { useAuth } from '../auth';
import { colors, font, space, radii } from '../theme';
import UserBadge from './UserBadge';

// Three primary filter "cards" only — per founder PRD.
const FILTERS: Array<{ key: string; label: string; sub?: string; icon: 'pin' | 'check' | 'spark' }> = [
  { key: 'nearby', label: 'Nearby', icon: 'pin' },
  { key: 'verified', label: 'Verified', icon: 'check' },
  { key: 'new', label: 'New', sub: 'Joined in last 30 days', icon: 'spark' },
];

const SORTS: Array<{ key: string; label: string }> = [
  { key: 'popular', label: 'Popular' },
  { key: 'nearby', label: 'Nearby' },
  { key: 'recent', label: 'Active' },
  { key: 'new', label: 'Newest' },
  { key: 'name', label: 'A–Z' },
];

const SPECIALTIES = [
  'Wedding', 'Portrait', 'Family', 'Pet', 'Landscape',
  'Drone', 'Real Estate', 'Events', 'Content Creator',
  'Newborn', 'Maternity', 'Brand', 'Fashion', 'Food', 'Sports', 'Automotive',
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
  role?: string;
  follower_count?: number;
  bio?: string;
  is_following?: boolean;
  last_active_at?: string;
};

function fmtFollowers(n?: number): string {
  if (typeof n !== 'number') return '';
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}

function isOnline(iso?: string): boolean {
  if (!iso) return false;
  try {
    return Date.now() - new Date(iso).getTime() < 5 * 60 * 1000; // active within 5 min
  } catch { return false; }
}

function PlanBadge({ u, size = 'md' }: { u: DirItem; size?: 'sm' | 'md' }) {
  const small = size === 'sm';
  if (u.plan === 'elite') {
    return (
      <View style={[s.badge, s.badgeElite, small && { paddingVertical: 1.5 }]}>
        <Star size={small ? 8 : 9} color="#1a1300" fill="#1a1300" strokeWidth={0} />
        <Text style={[s.badgeTxt, { color: '#1a1300', fontSize: small ? 8 : 9 }]}>ELITE</Text>
      </View>
    );
  }
  if (u.plan === 'pro') {
    return (
      <View style={[s.badge, s.badgePro, small && { paddingVertical: 1.5 }]}>
        <Star size={small ? 8 : 9} color={colors.primary} />
        <Text style={[s.badgeTxt, { color: colors.primary, fontSize: small ? 8 : 9 }]}>PRO</Text>
      </View>
    );
  }
  return null;
}

function FilterCard({
  k, label, sub, icon, active, onPress,
}: { k: string; label: string; sub?: string; icon: 'pin' | 'check' | 'spark'; active: boolean; onPress: () => void }) {
  const Icon = icon === 'pin' ? MapPin : icon === 'check' ? BadgeCheck : Sparkles;
  return (
    <Pressable
      onPress={onPress}
      style={[s.fcard, active && s.fcardActive]}
      testID={`directory-filter-${k}`}
    >
      <Icon size={15} color={active ? colors.primary : colors.textSecondary} />
      <Text style={[s.fcardLabel, active && s.fcardLabelActive]} numberOfLines={1}>{label}</Text>
      {sub ? (
        <Text style={[s.fcardSub, active && { color: colors.primary, opacity: 0.85 }]} numberOfLines={1}>{sub}</Text>
      ) : null}
    </Pressable>
  );
}

function CreatorCard({
  u, onFollow, onMessage, busyFollow,
}: { u: DirItem; onFollow: (u: DirItem) => void; onMessage: (u: DirItem) => void; busyFollow: boolean }) {
  const elite = u.plan === 'elite';
  const verified = u.verification_status === 'verified';
  const specs = (u.specialties || []).slice(0, 3);
  const online = isOnline(u.last_active_at);
  return (
    <Pressable
      onPress={() => router.push(`/user/${u.user_id}` as any)}
      style={[s.card, elite && s.cardElite]}
      testID={`directory-card-${u.user_id}`}
    >
      <View style={s.avatarWrap}>
        {u.avatar_url ? (
          <Image source={{ uri: u.avatar_url }} style={s.avatar} />
        ) : (
          <View style={[s.avatar, s.avatarPh]}>
            <Text style={s.avatarPhTxt}>{(u.name || u.username || '?').slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        {elite ? <View style={s.eliteRing} pointerEvents="none" /> : null}
        {online ? <View style={s.onlineDot} /> : null}
      </View>
      <View style={s.body}>
        <View style={s.nameRow}>
          <Text style={s.name} numberOfLines={1}>{u.name || `@${u.username || 'user'}`}</Text>
          {verified ? <ShieldCheck size={14} color="#3b82f6" fill="#3b82f6" strokeWidth={0} /> : null}
          <UserBadge user={u} variant="inline" />
        </View>
        {u.username ? (
          <Text style={s.handle} numberOfLines={1}>@{u.username}</Text>
        ) : null}
        {(u.city || u.state) ? (
          <View style={s.metaRow}>
            <MapPin size={11} color={colors.textTertiary} />
            <Text style={s.meta} numberOfLines={1}>
              {u.city}{u.state ? (u.city ? `, ${u.state}` : u.state) : ''}
            </Text>
          </View>
        ) : null}
        {specs.length > 0 ? (
          <Text style={s.specInline} numberOfLines={1}>
            {specs.join(' · ')}
          </Text>
        ) : null}
        {typeof u.follower_count === 'number' ? (
          <View style={s.metaRow}>
            <UsersIcon size={11} color={colors.textTertiary} />
            <Text style={s.meta}>{fmtFollowers(u.follower_count)} followers</Text>
          </View>
        ) : null}
      </View>
      <View style={s.actionsCol}>
        <Pressable
          onPress={(e) => { e.stopPropagation(); onFollow(u); }}
          disabled={busyFollow}
          style={[s.actionBtn, u.is_following ? s.actionFollowing : s.actionFollow]}
          testID={`directory-follow-${u.user_id}`}
        >
          {u.is_following ? (
            <>
              <Check size={12} color={colors.text} />
              <Text style={[s.actionTxt, { color: colors.text }]}>Following</Text>
            </>
          ) : (
            <>
              <UserPlus size={12} color={colors.textInverse} />
              <Text style={[s.actionTxt, { color: colors.textInverse }]}>Follow</Text>
            </>
          )}
        </Pressable>
        <Pressable
          onPress={(e) => { e.stopPropagation(); onMessage(u); }}
          style={[s.actionBtn, s.actionMessage]}
          testID={`directory-message-${u.user_id}`}
        >
          <MessageCircle size={12} color={colors.text} />
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
  const [cursor, setCursor] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [paging, setPaging] = useState(false);
  const [busyFollow, setBusyFollow] = useState<string | null>(null);
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [specSheetOpen, setSpecSheetOpen] = useState(false);
  const debounceRef = useRef<any>(null);

  const load = useCallback(async (resetCursor = true) => {
    if (resetCursor) {
      setLoading(true);
      setCursor(0);
    } else if (cursor === null) {
      return;
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
      if (resetCursor) setItems(r.items || []);
      else setItems((prev) => [...prev, ...(r.items || [])]);
      setCursor(r.next_cursor);
    } catch {
      // soft-fail; keep last state
    } finally {
      setLoading(false);
      setPaging(false);
    }
  }, [q, sort, filter, specialty, cursor]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(true), 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, filter, specialty]);

  // BUGFIX: backend POST /users/:id/follow is a TOGGLE — never DELETE.
  const handleFollow = useCallback(async (u: DirItem) => {
    if (busyFollow) return;
    setBusyFollow(u.user_id);
    setItems((prev) => prev.map((x) => x.user_id === u.user_id ? { ...x, is_following: !x.is_following } : x));
    try {
      const r = await api.post(`/users/${u.user_id}/follow`, {});
      // Reconcile with server truth (server returns {following: bool}).
      const serverFollowing = !!r?.following;
      setItems((prev) => prev.map((x) => x.user_id === u.user_id ? { ...x, is_following: serverFollowing } : x));
    } catch {
      // Roll back optimistic toggle on error.
      setItems((prev) => prev.map((x) => x.user_id === u.user_id ? { ...x, is_following: u.is_following } : x));
    } finally {
      setBusyFollow(null);
    }
  }, [busyFollow]);

  // BUGFIX: backend DMStartIn expects `user_id`, not `participant_user_id`.
  const handleMessage = useCallback(async (u: DirItem) => {
    try {
      const r = await api.post('/dm/threads/start', { user_id: u.user_id });
      if (r?.thread_id) router.push(`/inbox/${r.thread_id}` as any);
      else router.push('/inbox');
    } catch {
      router.push('/inbox');
    }
  }, []);

  const resetFilters = useCallback(() => {
    setQ(''); setFilter('all'); setSort('popular'); setSpecialty(null);
  }, []);

  const hasActiveFilters = !!(q || filter !== 'all' || specialty);
  const sortLabel = SORTS.find((srt) => srt.key === sort)?.label || 'Popular';

  return (
    <View style={s.root}>
      {/* Search bar */}
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

      {/* 3 primary filter cards — flexed equally per the mockup */}
      <View style={s.fcardRow}>
        {FILTERS.map((f) => (
          <FilterCard
            key={f.key}
            k={f.key}
            label={f.label}
            sub={f.sub}
            icon={f.icon}
            active={filter === f.key}
            onPress={() => setFilter(filter === f.key ? 'all' : f.key)}
          />
        ))}
      </View>

      {/* Secondary controls — Sort left, Specialties right */}
      <View style={s.controlRow}>
        <Pressable
          onPress={() => setSortSheetOpen(true)}
          style={s.sortPill}
          testID="directory-sort-open"
        >
          <Text style={s.sortLabel}>Sort</Text>
          <View style={s.sortValuePill}>
            <Text style={s.sortValue}>{sortLabel}</Text>
            <ChevronDown size={12} color={colors.textSecondary} />
          </View>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {hasActiveFilters ? (
            <Pressable onPress={resetFilters} style={s.resetMini} testID="directory-reset-mini">
              <RefreshCw size={11} color={colors.textSecondary} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setSpecSheetOpen(true)}
            style={[s.specPill, specialty && s.specPillActive]}
            testID="directory-specialty-open"
          >
            <SlidersHorizontal size={12} color={specialty ? colors.primary : colors.textSecondary} />
            <Text style={[s.specPillTxt, specialty && { color: colors.primary }]}>
              {specialty || 'Specialties'}
            </Text>
            <ChevronDown size={12} color={specialty ? colors.primary : colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      {/* Body */}
      {loading ? (
        <View style={{ padding: space.xl, alignItems: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={s.emptyWrap}>
          <Text style={s.emptyTitle}>No photographers found</Text>
          {q ? (
            <Text style={s.emptySub}>Nothing matched “{q}”.</Text>
          ) : (
            <Text style={s.emptySub}>No photographers match these filters.</Text>
          )}
          <View style={s.suggestList}>
            <Text style={s.suggestRow}>•  Clear filters and try again</Text>
            <Text style={s.suggestRow}>•  Search by city (e.g. “Austin”)</Text>
            <Text style={s.suggestRow}>•  Browse Nearby photographers</Text>
          </View>
          <View style={s.emptyActions}>
            <Pressable onPress={resetFilters} style={s.emptyResetBtn} testID="directory-reset-empty">
              <RefreshCw size={13} color={colors.textInverse} />
              <Text style={s.emptyResetTxt}>Reset filters</Text>
            </Pressable>
            <Pressable onPress={() => { setFilter('nearby'); setQ(''); setSpecialty(null); }} style={s.emptyAltBtn}>
              <Text style={s.emptyAltTxt}>Browse Nearby</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <FlatList
          data={items}
          // Defensive: append index to key so a transient duplicate from
          // cursor pagination overlap can never trigger a "two children
          // with the same key" warning. Order remains stable.
          keyExtractor={(u: DirItem, idx: number) => `${u.user_id}_${idx}`}
          contentContainerStyle={s.listContent}
          renderItem={({ item }) => (
            <CreatorCard
              u={item}
              onFollow={handleFollow}
              onMessage={handleMessage}
              busyFollow={busyFollow === item.user_id}
            />
          )}
          onEndReached={() => { if (!paging && cursor !== null) load(false); }}
          onEndReachedThreshold={0.6}
          ListFooterComponent={paging ? (
            <ActivityIndicator color={colors.primary} style={{ paddingVertical: 16 }} />
          ) : null}
        />
      )}

      {/* Sort sheet */}
      <Modal visible={sortSheetOpen} transparent animationType="slide" onRequestClose={() => setSortSheetOpen(false)}>
        <Pressable style={sheetS.backdrop} onPress={() => setSortSheetOpen(false)}>
          <Pressable style={sheetS.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={sheetS.grabber} />
            <Text style={sheetS.title}>Sort by</Text>
            {SORTS.map((srt) => {
              const active = sort === srt.key;
              return (
                <Pressable
                  key={srt.key}
                  onPress={() => { setSort(srt.key); setSortSheetOpen(false); }}
                  style={sheetS.row}
                  testID={`directory-sort-${srt.key}`}
                >
                  <Text style={[sheetS.rowTxt, active && sheetS.rowTxtActive]}>{srt.label}</Text>
                  {active ? <Check size={16} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Specialties sheet */}
      <Modal visible={specSheetOpen} transparent animationType="slide" onRequestClose={() => setSpecSheetOpen(false)}>
        <Pressable style={sheetS.backdrop} onPress={() => setSpecSheetOpen(false)}>
          <Pressable style={sheetS.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={sheetS.grabber} />
            <View style={sheetS.headerRow}>
              <Text style={sheetS.title}>Specialties</Text>
              {specialty ? (
                <Pressable onPress={() => { setSpecialty(null); setSpecSheetOpen(false); }} testID="directory-specialty-clear">
                  <Text style={sheetS.headerLink}>Clear</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={sheetS.specGrid}>
              <Pressable
                onPress={() => { setSpecialty(null); setSpecSheetOpen(false); }}
                style={[sheetS.specChip, !specialty && sheetS.specChipActive]}
                testID="directory-specialty-all"
              >
                <Text style={[sheetS.specChipTxt, !specialty && sheetS.specChipTxtActive]}>All</Text>
              </Pressable>
              {SPECIALTIES.map((sp) => {
                const active = specialty === sp;
                return (
                  <Pressable
                    key={sp}
                    onPress={() => { setSpecialty(sp); setSpecSheetOpen(false); }}
                    style={[sheetS.specChip, active && sheetS.specChipActive]}
                    testID={`directory-specialty-${sp}`}
                  >
                    <Text style={[sheetS.specChipTxt, active && sheetS.specChipTxtActive]}>{sp}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const CARD_AVATAR = 64;
const ACT_W = 110;

const s = StyleSheet.create({
  root: { flex: 1 },
  // Search
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    height: 44, marginHorizontal: space.xl, marginTop: 2, paddingHorizontal: 12,
    borderRadius: 22, backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 13, paddingVertical: 0 },
  searchClear: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  // 3 filter cards row
  fcardRow: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: space.xl, paddingTop: 10, paddingBottom: 4,
  },
  fcard: {
    flex: 1,
    minHeight: 56,
    paddingHorizontal: 10, paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
    gap: 3,
  },
  fcardActive: {
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderColor: 'rgba(245,166,35,0.55)',
  },
  fcardLabel: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  fcardLabelActive: { color: colors.primary, fontFamily: font.bodyBold },
  fcardSub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 9, textAlign: 'center', marginTop: 1 },
  // Sort + Specialties row
  controlRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.xl, paddingTop: 10, paddingBottom: 12,
  },
  sortPill: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sortLabel: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.4 },
  sortValuePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    height: 30, paddingHorizontal: 12, borderRadius: 15,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
  },
  sortValue: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 12 },
  specPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 30, paddingHorizontal: 12, borderRadius: 15,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
  },
  specPillActive: { borderColor: 'rgba(245,166,35,0.5)', backgroundColor: 'rgba(245,166,35,0.08)' },
  specPillTxt: { color: colors.textSecondary, fontFamily: font.bodySemibold, fontSize: 12 },
  resetMini: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
  },
  // Empty
  emptyWrap: {
    paddingHorizontal: space.xl, paddingTop: 22, paddingBottom: 24,
    alignItems: 'flex-start',
  },
  emptyTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 16 },
  emptySub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, marginTop: 4 },
  suggestList: { marginTop: 12, gap: 4 },
  suggestRow: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 20 },
  emptyActions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  emptyResetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 36, paddingHorizontal: 14, borderRadius: 18,
    backgroundColor: colors.primary,
  },
  emptyResetTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 12 },
  emptyAltBtn: {
    height: 36, paddingHorizontal: 14, borderRadius: 18,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyAltTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },
  // Card
  listContent: { paddingHorizontal: space.xl, paddingBottom: 28 },
  card: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12, paddingHorizontal: 12,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: 14,
    marginBottom: 8,
    alignItems: 'center',
  },
  cardElite: {
    borderColor: 'rgba(245,166,35,0.3)',
    backgroundColor: 'rgba(245,166,35,0.035)',
  },
  avatarWrap: { position: 'relative' },
  avatar: { width: CARD_AVATAR, height: CARD_AVATAR, borderRadius: CARD_AVATAR / 2 },
  avatarPh: {
    backgroundColor: colors.surface2,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  avatarPhTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 18 },
  eliteRing: {
    position: 'absolute', top: -2, left: -2, right: -2, bottom: -2,
    borderRadius: (CARD_AVATAR + 4) / 2,
    borderWidth: 1.5, borderColor: '#f5a623',
  },
  onlineDot: {
    position: 'absolute', right: 0, bottom: 2,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#22c55e',
    borderWidth: 2, borderColor: colors.surface1,
  },
  body: { flex: 1, gap: 3, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  name: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  handle: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  specInline: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, marginTop: 1 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: 4, borderWidth: StyleSheet.hairlineWidth,
  },
  badgeElite: { backgroundColor: '#f5a623', borderColor: '#f5a623' },
  badgePro: { backgroundColor: 'rgba(245,166,35,0.14)', borderColor: 'rgba(245,166,35,0.4)' },
  badgeTxt: { fontFamily: font.bodyBold, letterSpacing: 0.6 },
  actionsCol: { gap: 6, width: ACT_W },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, height: 32, borderRadius: 8,
  },
  actionFollow: { backgroundColor: colors.primary },
  actionFollowing: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  actionMessage: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  actionTxt: { fontFamily: font.bodyBold, fontSize: 11 },
});

const sheetS = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: space.xl, paddingTop: 8, paddingBottom: space.xxl,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15, marginBottom: 8 },
  headerLink: { color: colors.primary, fontFamily: font.bodySemibold, fontSize: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    height: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  rowTxt: { color: colors.text, fontFamily: font.body, fontSize: 14 },
  rowTxtActive: { color: colors.primary, fontFamily: font.bodySemibold },
  specGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
  specChip: {
    height: 36, paddingHorizontal: 14, borderRadius: 18,
    backgroundColor: colors.surface2,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'transparent',
  },
  specChipActive: { backgroundColor: 'rgba(245,166,35,0.14)', borderColor: colors.primary },
  specChipTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },
  specChipTxtActive: { color: colors.primary, fontFamily: font.bodySemibold },
});
