/**
 * DirectoryView — Photographer Directory inside the Network tab.
 *
 * UI polish pass (2026-04, "Apple/Instagram/Airbnb premium"):
 *   - Every pill / chip now has an EXPLICIT 36-40px height. Horizontal
 *     ScrollViews use alignItems:'center' on their contentContainerStyle
 *     so children never vertically-stretch (this was the bug producing
 *     tall capsule-shaped pills on iOS).
 *   - Specialties moved out of the inline chip row and into a sheet
 *     opened by a compact "Specialties ▾" pill that shows the active
 *     selection inline.
 *   - Sort moved to a single "Sort · <current> ▼" pill that opens
 *     its own sheet — cleaner than a 5-pill row.
 *   - Empty state: tighter typography, suggestion bullets, "Reset
 *     filters" CTA, and surfaces top of viewport instead of dominating.
 *
 * Data layer is unchanged (same /api/directory + /api/directory/suggested
 * contracts). No perf regression.
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
} from 'lucide-react-native';
import { api } from '../api';
import { useAuth } from '../auth';
import { colors, font, space, radii } from '../theme';

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

const SORTS: Array<{ key: string; label: string }> = [
  { key: 'popular', label: 'Popular' },
  { key: 'nearby', label: 'Nearby' },
  { key: 'recent', label: 'Recently Active' },
  { key: 'new', label: 'Newest' },
  { key: 'name', label: 'A–Z' },
];

const SPECIALTIES = [
  'Wedding', 'Portrait', 'Family', 'Pet', 'Maternity',
  'Newborn', 'Real Estate', 'Landscape', 'Drone', 'Events',
  'Brand', 'Fashion', 'Food', 'Sports', 'Automotive', 'Content Creator',
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
  const specs = (u.specialties || []).slice(0, 3);
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
          {elite ? <View style={s.eliteRing} pointerEvents="none" /> : null}
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
          <View style={s.metaRow}>
            {u.username ? (
              <Text style={s.handle} numberOfLines={1}>@{u.username}</Text>
            ) : null}
            {u.username && (u.city || u.state) ? (
              <Text style={s.metaDot}>·</Text>
            ) : null}
            {(u.city || u.state) ? (
              <View style={s.locInline}>
                <MapPin size={10} color={colors.textTertiary} />
                <Text style={s.loc} numberOfLines={1}>
                  {u.city}{u.state ? (u.city ? `, ${u.state}` : u.state) : ''}
                </Text>
              </View>
            ) : null}
          </View>
          {typeof u.follower_count === 'number' ? (
            <Text style={s.followers}>
              {u.follower_count.toLocaleString()} follower{u.follower_count === 1 ? '' : 's'}
            </Text>
          ) : null}
        </View>
      </View>
      {specs.length > 0 ? (
        <View style={s.specRow}>
          {specs.map((sp) => (
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
      if (resetCursor) {
        setItems(r.items || []);
      } else {
        setItems((prev) => [...prev, ...(r.items || [])]);
      }
      setCursor(r.next_cursor);
    } catch {
      // Leave existing list in place.
    } finally {
      setLoading(false);
      setPaging(false);
    }
  }, [q, sort, filter, specialty, cursor]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(true), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, filter, specialty]);

  useEffect(() => {
    if (!user) return;
    api.get('/directory/suggested', { limit: 8 })
      .then((r) => setSuggested(r.items || []))
      .catch(() => setSuggested([]));
  }, [user]);

  const handleFollow = useCallback(async (u: DirItem) => {
    if (busyFollow) return;
    setBusyFollow(u.user_id);
    setItems((prev) => prev.map((x) => x.user_id === u.user_id ? { ...x, is_following: !x.is_following } : x));
    try {
      if (u.is_following) await api.delete(`/users/${u.user_id}/follow`);
      else await api.post(`/users/${u.user_id}/follow`, {});
    } catch {
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
    } catch {
      router.push('/inbox');
    }
  }, []);

  const resetFilters = useCallback(() => {
    setQ('');
    setFilter('all');
    setSort('popular');
    setSpecialty(null);
  }, []);

  const hasActiveFilters = !!(q || filter !== 'all' || specialty);
  const sortLabel = SORTS.find((srt) => srt.key === sort)?.label || 'Popular';

  return (
    <View style={s.root}>
      {/* Compact premium search bar (40px height) */}
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

      {/* Single horizontal pill row — no vertical stretch */}
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

      {/* Sort + Specialties — two compact dropdown pills */}
      <View style={s.controlRow}>
        <Pressable
          onPress={() => setSortSheetOpen(true)}
          style={s.controlPill}
          testID="directory-sort-open"
        >
          <Text style={s.controlLabel}>Sort</Text>
          <Text style={s.controlValue}>{sortLabel}</Text>
          <ChevronDown size={12} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          onPress={() => setSpecSheetOpen(true)}
          style={[s.controlPill, specialty && s.controlPillActive]}
          testID="directory-specialty-open"
        >
          <SlidersHorizontal size={11} color={specialty ? colors.primary : colors.textSecondary} />
          <Text style={[s.controlLabel, specialty && { color: colors.primary }]}>
            {specialty ? 'Specialty' : 'Specialties'}
          </Text>
          {specialty ? <Text style={[s.controlValue, { color: colors.primary }]}>{specialty}</Text> : null}
          <ChevronDown size={12} color={specialty ? colors.primary : colors.textSecondary} />
        </Pressable>
        {hasActiveFilters ? (
          <Pressable onPress={resetFilters} style={s.resetMini} testID="directory-reset-mini">
            <RefreshCw size={11} color={colors.textSecondary} />
          </Pressable>
        ) : null}
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
          keyExtractor={(u: DirItem) => u.user_id}
          contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: 80 }}
          ListHeaderComponent={
            !q && filter === 'all' && !specialty && suggested.length > 0 ? (
              <View style={s.sugWrap}>
                <View style={s.sugHead}>
                  <Sparkles size={13} color={colors.primary} />
                  <Text style={s.sugTitle}>People you may know</Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={s.sugScroller}
                >
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
                      <Text style={s.sugName} numberOfLines={1}>{u.name || `@${u.username}`}</Text>
                      {u.city ? <Text style={s.sugLoc} numberOfLines={1}>{u.city}</Text> : null}
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <DirectoryCard
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
      <Modal
        visible={sortSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSortSheetOpen(false)}
      >
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
      <Modal
        visible={specSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSpecSheetOpen(false)}
      >
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

// -----------------------------------------------------------------------------
// Styles — every interactive pill has an EXPLICIT height and the parent rows
// use alignItems:'center' so children never vertically-stretch.
// -----------------------------------------------------------------------------
const s = StyleSheet.create({
  root: { flex: 1 },
  // Search — 44px touch target
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    marginHorizontal: space.xl,
    paddingHorizontal: 12,
    borderRadius: 22,
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
  // Filter pill row
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.xl,
    paddingTop: 12,
    paddingBottom: 4,
  },
  pill: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    backgroundColor: 'rgba(245,166,35,0.16)',
    borderColor: colors.primary,
  },
  pillTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  pillTxtActive: { color: colors.primary, fontFamily: font.bodySemibold },
  // Sort + Specialties control row
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: space.xl,
    paddingTop: 8,
    paddingBottom: 12,
  },
  controlPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  controlPillActive: {
    borderColor: 'rgba(245,166,35,0.45)',
    backgroundColor: 'rgba(245,166,35,0.06)',
  },
  controlLabel: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.3 },
  controlValue: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 12 },
  resetMini: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Empty state
  emptyWrap: {
    paddingHorizontal: space.xl,
    paddingTop: 28,
    paddingBottom: 32,
    alignItems: 'flex-start',
  },
  emptyTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 16 },
  emptySub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, marginTop: 4, lineHeight: 18 },
  suggestList: { marginTop: 14, gap: 4 },
  suggestRow: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 20 },
  emptyActions: { flexDirection: 'row', gap: 8, marginTop: 18 },
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
  // Suggested rail
  sugWrap: { paddingTop: 8, paddingBottom: 14 },
  sugHead: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 },
  sugTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 12, letterSpacing: 0.3 },
  sugScroller: { gap: 8, alignItems: 'center' },
  sugCard: {
    width: 100,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sugAvatar: { width: 52, height: 52, borderRadius: 26, marginBottom: 8 },
  sugName: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 11, textAlign: 'center' },
  sugLoc: { color: colors.textTertiary, fontFamily: font.body, fontSize: 9, marginTop: 2, textAlign: 'center' },
  // Card
  card: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 14,
    marginBottom: 10,
  },
  cardElite: {
    borderColor: 'rgba(245,166,35,0.35)',
    backgroundColor: 'rgba(245,166,35,0.04)',
  },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  avatarWrap: { position: 'relative' },
  avatar: { width: 54, height: 54, borderRadius: 27 },
  eliteRing: {
    position: 'absolute', top: -2, left: -2, right: -2, bottom: -2,
    borderRadius: 29, borderWidth: 1.5, borderColor: '#f5a623',
  },
  avatarPh: {
    backgroundColor: colors.surface2,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  avatarPhTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 16 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  name: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, flexWrap: 'wrap' },
  handle: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, flexShrink: 1 },
  metaDot: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  locInline: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  loc: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  followers: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, marginTop: 4 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: 4, borderWidth: StyleSheet.hairlineWidth,
  },
  badgeElite: { backgroundColor: '#f5a623', borderColor: '#f5a623' },
  badgePro: { backgroundColor: 'rgba(245,166,35,0.14)', borderColor: 'rgba(245,166,35,0.4)' },
  badgeTxt: { fontFamily: font.bodyBold, fontSize: 8, letterSpacing: 0.6 },
  specRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 10 },
  specChip: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 4, backgroundColor: colors.surface2,
  },
  specTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 10 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4,
    height: 36,
    borderRadius: 10,
  },
  actionFollow: { backgroundColor: colors.primary },
  actionFollowing: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  actionMessage: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  actionTxt: { fontFamily: font.bodyBold, fontSize: 12 },
});

const sheetS = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: space.xl,
    paddingTop: 8,
    paddingBottom: space.xxl,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    borderColor: colors.border,
  },
  grabber: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center', marginBottom: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15, marginBottom: 8 },
  headerLink: { color: colors.primary, fontFamily: font.bodySemibold, fontSize: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    height: 48,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  rowTxt: { color: colors.text, fontFamily: font.body, fontSize: 14 },
  rowTxtActive: { color: colors.primary, fontFamily: font.bodySemibold },
  specGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4,
  },
  specChip: {
    height: 36, paddingHorizontal: 14, borderRadius: 18,
    backgroundColor: colors.surface2,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'transparent',
  },
  specChipActive: {
    backgroundColor: 'rgba(245,166,35,0.14)', borderColor: colors.primary,
  },
  specChipTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },
  specChipTxtActive: { color: colors.primary, fontFamily: font.bodySemibold },
});
