/**
 * CommunityView — Network ▸ Community premium creator social feed.
 *
 *   Apr 2026 redesign — feels like a high-end creator community, not a
 *   generic forum. Cards breathe, typography is editorial, and every
 *   action lives in muscle-memory positions.
 *
 *   Layout (top → bottom):
 *     1) Search posts bar + floating gold "+" Compose CTA
 *     2) Category chips (All · Feedback · Referrals · Gear · Editing · Wins)
 *     3) Smart retention strip (counts of feedback, referrals, active today)
 *     4) Premium post cards — staggered fade-in entrance
 *
 *   Wires to: GET /api/posts, POST /api/posts/{id}/like (toggle),
 *   POST /api/dm/threads/start, share sheet, /community/compose route.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, Image, ActivityIndicator,
  ScrollView, Share, RefreshControl, Animated, Easing, TextInput, Alert,
  Modal,
} from 'react-native';
import { router } from 'expo-router';
import {
  Plus, Search, Heart, MessageCircle, Share2 as ShareIcon, Bookmark,
  Briefcase, Camera, Settings, Sparkles, MapPin, Trophy, Flame,
  Send, ChevronRight, MoreHorizontal, Trash2,
  CheckCircle2, Circle, X, ShieldAlert, EyeOff, AlertTriangle, Shield,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { api, formatApiError } from '../api';
import { useAuth } from '../auth';
import { colors, font, space, radii } from '../theme';
import UserBadge from './UserBadge';

// ============================================================================
// Categories — Apr 2026 spec: All / Feedback / Referrals / Gear / Editing / Wins
// ============================================================================
type CategoryKey = 'all' | 'feedback' | 'referrals' | 'gear' | 'editing' | 'wins';
const CATEGORIES: { key: CategoryKey; label: string; icon: any; accent: string }[] = [
  { key: 'all',       label: 'All',       icon: Sparkles,  accent: colors.primary },
  { key: 'feedback',  label: 'Feedback',  icon: Camera,    accent: '#22c55e' },
  { key: 'referrals', label: 'Referrals', icon: Briefcase, accent: '#9D59FF' },
  { key: 'gear',      label: 'Gear',      icon: Settings,  accent: '#60A5FA' },
  { key: 'editing',   label: 'Editing',   icon: Sparkles,  accent: '#F97316' },
  { key: 'wins',      label: 'Wins',      icon: Trophy,    accent: colors.primary },
];

// ============================================================================
// Helpers
// ============================================================================
function timeAgo(ts: string | undefined): string {
  if (!ts) return '';
  const d = new Date(ts).getTime();
  const sec = Math.max(1, Math.floor((Date.now() - d) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const day = Math.floor(h / 24);
  if (day < 7) return `${day}d`;
  const w = Math.floor(day / 7);
  if (w < 5) return `${w}w`;
  return new Date(ts).toLocaleDateString();
}

function categoryMeta(cat: string | undefined) {
  return CATEGORIES.find((c) => c.key === cat) || CATEGORIES[0];
}

// ============================================================================
// MAIN
// ============================================================================
export default function CommunityView() {
  const { user: me } = useAuth();
  const isAdmin = !!me && (me.role === 'admin' || me.role === 'super_admin');
  const isSuperAdmin = !!me && me.role === 'super_admin';
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState<CategoryKey>('all');
  const [q, setQ] = useState('');
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [savedMap, setSavedMap] = useState<Record<string, boolean>>({});

  // ---- Bulk moderation mode (Apr 2026 — Path 2 sprint) ----------------------
  // Admins/super-admins enter "Moderate" mode to multi-select posts. Tapping
  // a card while in mode toggles selection instead of opening detail. A
  // sticky action bar gives bulk options powered by the existing
  // /api/admin/community/bulk-moderate endpoint.
  const [modMode, setModMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<null | {
    label: string;
    action: 'soft_delete' | 'hide' | 'mark_spam' | 'restore' | 'hard_delete';
    danger: boolean;
    description: string;
  }>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const toggleSelect = useCallback((postId: string) => {
    Haptics.selectionAsync().catch(() => {});
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }, []);

  const exitModMode = useCallback(() => {
    setModMode(false);
    setSelectedIds(new Set());
  }, []);

  // ---- Apr 2026 — Stage 2 — Mod filter ----
  // Admin filter chips visible only in moderate mode. 'all' uses the
  // standard consumer feed; the others swap to /admin/community/content
  // so admins can see hidden/auto-flagged posts that consumers can't.
  type ModFilter = 'all' | 'reported' | 'auto_flagged' | 'no_comments';
  const [modFilter, setModFilter] = useState<ModFilter>('all');

  const load = useCallback(
    async (isRefresh = false) => {
      isRefresh ? setRefreshing(true) : setLoading(true);
      try {
        if (modMode && modFilter !== 'all') {
          // Admin-elevated content list
          const params: any = { type: 'post', limit: 50 };
          if (modFilter === 'reported') params.reported = true;
          if (modFilter === 'auto_flagged') params.auto_flagged = true;
          if (modFilter === 'no_comments') params.no_comments = true;
          const r = await api.get('/admin/community/content', params);
          // /admin/community/content returns { items, total, ... }
          const items = (r?.items || []).map((it: any) => ({
            ...it,
            // Normalize to consumer-feed shape so PostCard renders correctly
            author: it._author || it.author,
          }));
          setPosts(items);
        } else {
          const r = await api.get('/posts', {
            category: category === 'all' ? undefined : category,
            limit: 25,
          });
          setPosts(Array.isArray(r) ? r : (r?.items || []));
        }
      } catch {
        setPosts([]);
      } finally {
        isRefresh ? setRefreshing(false) : setLoading(false);
      }
    },
    [category, modMode, modFilter],
  );

  useEffect(() => { load(); }, [load]);

  // Local search filter — body / title / author name
  const visiblePosts = useMemo(() => {
    if (!q.trim()) return posts;
    const needle = q.trim().toLowerCase();
    return posts.filter((p) => {
      const hay = [
        p.title, p.body, p?.author?.name, p?.author?.username,
        p?.author?.city, p.category,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [posts, q]);

  // ---- Bulk moderate executor ----------------------------------------------
  const performBulk = useCallback(async () => {
    if (!bulkAction || selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const ids = Array.from(selectedIds);
      const r = await api.post('/admin/community/bulk-moderate', {
        type: 'post',
        ids,
        action: bulkAction.action,
        reason: `[bulk ${bulkAction.action}] ${ids.length} posts via Community Moderate mode`,
      });
      const ok = r.applied ?? 0;
      const failed = r.failed ?? 0;
      // Optimistically remove acted-on posts from the feed unless the action
      // is `restore`, which makes them re-appear via reload.
      if (bulkAction.action !== 'restore') {
        setPosts((prev) => prev.filter((p) => !selectedIds.has(p.post_id)));
      }
      setBulkAction(null);
      exitModMode();
      Alert.alert(
        'Moderation complete',
        failed === 0
          ? `${bulkAction.label}: ${ok} ${ok === 1 ? 'post' : 'posts'} succeeded.`
          : `${bulkAction.label}: ${ok} succeeded · ${failed} failed. Check audit log.`,
      );
      // Hard refresh on restore so the posts re-enter the feed.
      if (bulkAction.action === 'restore') load(true);
    } catch (e) {
      Alert.alert('Bulk action failed', formatApiError(e));
    } finally {
      setBulkBusy(false);
    }
  }, [bulkAction, selectedIds, exitModMode, load]);

  // Smart retention badges — counted from current feed
  const retentionStats = useMemo(() => {
    const now = Date.now();
    const dayAgo = now - 24 * 3600 * 1000;
    return {
      feedback: posts.filter((p) => p.category === 'feedback').length,
      referrals: posts.filter((p) => p.category === 'referrals').length,
      activeToday: posts.filter((p) => {
        const t = p.created_at ? new Date(p.created_at).getTime() : 0;
        return t > dayAgo;
      }).length,
    };
  }, [posts]);

  const toggleLike = useCallback(async (postId: string) => {
    Haptics.selectionAsync().catch(() => {});
    const wasLiked = !!likedMap[postId];
    setLikedMap((p) => ({ ...p, [postId]: !wasLiked }));
    try {
      if (wasLiked) await api.delete(`/posts/${postId}/like`);
      else await api.post(`/posts/${postId}/like`);
    } catch {
      setLikedMap((p) => ({ ...p, [postId]: wasLiked })); // rollback
    }
  }, [likedMap]);

  const toggleSave = useCallback((postId: string) => {
    // Backend doesn't yet have /posts/save — keep optimistic local state
    Haptics.selectionAsync().catch(() => {});
    setSavedMap((p) => ({ ...p, [postId]: !p[postId] }));
  }, []);

  // FIX(2026-04 / Item #4): Community admin/owner delete.
  // Backend: DELETE /api/posts/{id} \u2014 already supports admin override
  // + audit log. We just gate the UI: post owner OR admin/super_admin.
  const handleDelete = useCallback(async (post: any) => {
    Alert.alert(
      'Delete this post?',
      isAdmin && post?.author?.user_id !== me?.user_id
        ? 'This post will be removed from Community. The action will be recorded in the moderation audit log.'
        : 'This post will be removed from Community. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/posts/${post.post_id}`);
              setPosts((p) => p.filter((x) => x.post_id !== post.post_id));
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            } catch (e: any) {
              Alert.alert('Could not delete', e?.message || 'Please try again.');
            }
          },
        },
      ],
    );
  }, [isAdmin, me?.user_id]);

  const onShare = async (post: any) => {
    Haptics.selectionAsync().catch(() => {});
    try {
      const url = `https://lumascout.app/community/post/${post.post_id}`;
      await Share.share({
        message: `${post.body || post.title || 'Check this out on LumaScout'}\n\n${url}`,
        url,
      });
    } catch {}
  };

  const onMessage = async (uid: string, refPostId?: string) => {
    Haptics.selectionAsync().catch(() => {});
    try {
      const r = await api.post('/dm/threads/start', { other_user_id: uid });
      if (r?.thread_id) router.push(`/inbox/${r.thread_id}` as any);
    } catch {}
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Toolbar — search + floating gold compose */}
      <View style={s.toolbar}>
        <View style={s.searchBar}>
          <Search size={14} color={colors.textSecondary} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search posts, people, topics"
            placeholderTextColor={colors.textTertiary}
            style={s.searchInp}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            testID="community-search"
          />
        </View>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            router.push('/community/compose' as any);
          }}
          style={({ pressed }) => [s.composeBtn, pressed && s.composeBtnPressed]}
          testID="community-compose"
        >
          <Plus size={18} color="#1a1300" strokeWidth={3} />
        </Pressable>
        {/* Apr 2026 — admins/super-admins enter Moderate mode */}
        {isAdmin ? (
          <Pressable
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setModMode((m) => !m);
              if (modMode) setSelectedIds(new Set());
            }}
            style={[s.modBtn, modMode && s.modBtnActive]}
            testID="community-mod-toggle"
          >
            <Shield size={16} color={modMode ? '#1a1300' : colors.primary} />
          </Pressable>
        ) : null}
      </View>

      {/* Sticky action bar — Apr 2026 bulk moderation mode */}
      {modMode ? (
        <View style={s.modBar} testID="community-mod-bar">
          <View style={s.modBarHead}>
            <Pressable onPress={exitModMode} hitSlop={8} style={s.modBarClose}>
              <X size={16} color={colors.text} />
            </Pressable>
            <Text style={s.modBarTitle}>
              {selectedIds.size === 0
                ? 'Tap posts to select'
                : `${selectedIds.size} selected`}
            </Text>
            <Pressable
              onPress={() => {
                if (selectedIds.size === visiblePosts.length) {
                  setSelectedIds(new Set());
                } else {
                  setSelectedIds(new Set(visiblePosts.map((p) => p.post_id)));
                }
              }}
              style={s.modBarSelectAll}
              hitSlop={6}
            >
              <Text style={s.modBarSelectAllTxt}>
                {selectedIds.size === visiblePosts.length && visiblePosts.length > 0 ? 'Clear all' : 'Select all'}
              </Text>
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.modBarActions}
            keyboardShouldPersistTaps="handled"
          >
            <ModAction
              icon={EyeOff}
              label="Remove from feed"
              count={selectedIds.size}
              disabled={selectedIds.size === 0}
              onPress={() => setBulkAction({
                label: 'Remove from feed',
                action: 'hide',
                danger: false,
                description: `Soft-hides ${selectedIds.size} ${selectedIds.size === 1 ? 'post' : 'posts'} from the Community feed. Authors can still see their own posts. Reversible from the audit log.`,
              })}
            />
            <ModAction
              icon={AlertTriangle}
              label="Mark spam"
              count={selectedIds.size}
              danger
              disabled={selectedIds.size === 0}
              onPress={() => setBulkAction({
                label: 'Mark spam',
                action: 'mark_spam',
                danger: true,
                description: `Removes ${selectedIds.size} ${selectedIds.size === 1 ? 'post' : 'posts'} and adds a strike to each author. Trains the spam-detection signal.`,
              })}
            />
            <ModAction
              icon={Trash2}
              label="Soft delete"
              count={selectedIds.size}
              danger
              disabled={selectedIds.size === 0}
              onPress={() => setBulkAction({
                label: 'Delete (soft)',
                action: 'soft_delete',
                danger: true,
                description: `Marks ${selectedIds.size} ${selectedIds.size === 1 ? 'post' : 'posts'} as removed. Author content history preserved; reversible by Restore.`,
              })}
            />
            {isSuperAdmin ? (
              <ModAction
                icon={ShieldAlert}
                label="Delete permanently"
                count={selectedIds.size}
                danger
                disabled={selectedIds.size === 0}
                onPress={() => setBulkAction({
                  label: 'Delete permanently',
                  action: 'hard_delete',
                  danger: true,
                  description: `PERMANENTLY removes ${selectedIds.size} ${selectedIds.size === 1 ? 'post' : 'posts'} from the database, including comments and image references. THIS CANNOT BE UNDONE.`,
                })}
              />
            ) : null}
            <ModAction
              icon={CheckCircle2}
              label="Restore"
              count={selectedIds.size}
              disabled={selectedIds.size === 0}
              onPress={() => setBulkAction({
                label: 'Restore',
                action: 'restore',
                danger: false,
                description: `Restores ${selectedIds.size} previously hidden or removed ${selectedIds.size === 1 ? 'post' : 'posts'} back to the live feed.`,
              })}
            />
          </ScrollView>
          {/* Filter chips — Apr 2026 Stage 2 */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.modBarFilters}
            keyboardShouldPersistTaps="handled"
          >
            {([
              { k: 'all', l: 'All' },
              { k: 'reported', l: 'Reported' },
              { k: 'auto_flagged', l: 'Auto-flagged' },
              { k: 'no_comments', l: 'No comments' },
            ] as { k: ModFilter; l: string }[]).map((f) => (
              <Pressable
                key={f.k}
                onPress={() => {
                  setModFilter(f.k);
                  setSelectedIds(new Set());
                }}
                style={[s.modBarFilterChip, modFilter === f.k && s.modBarFilterChipActive]}
              >
                <Text style={[s.modBarFilterTxt, modFilter === f.k && s.modBarFilterTxtActive]}>
                  {f.l}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Category chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.catRow}
      >
        {CATEGORIES.map((c) => {
          const active = category === c.key;
          const Icon = c.icon;
          return (
            <Pressable
              key={c.key}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setCategory(c.key);
              }}
              style={[
                s.catPill,
                active && [s.catPillActive, { borderColor: c.accent + '88', backgroundColor: c.accent + '1a' }],
              ]}
              testID={`community-cat-${c.key}`}
            >
              <Icon size={11} color={active ? c.accent : colors.textSecondary} />
              <Text style={[s.catPillTxt, active && { color: c.accent, fontFamily: font.bodyBold }]}>
                {c.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Retention strip */}
      {(retentionStats.feedback > 0 || retentionStats.referrals > 0 || retentionStats.activeToday > 0) ? (
        <View style={s.retentionStrip}>
          {retentionStats.feedback > 0 ? (
            <View style={[s.retBlip, { borderColor: 'rgba(34,197,94,0.45)' }]}>
              <Camera size={10} color="#22c55e" />
              <Text style={[s.retBlipTxt, { color: '#22c55e' }]}>
                {retentionStats.feedback} feedback request{retentionStats.feedback === 1 ? '' : 's'}
              </Text>
            </View>
          ) : null}
          {retentionStats.referrals > 0 ? (
            <View style={[s.retBlip, { borderColor: 'rgba(157,89,255,0.45)' }]}>
              <Briefcase size={10} color="#9D59FF" />
              <Text style={[s.retBlipTxt, { color: '#9D59FF' }]}>
                {retentionStats.referrals} referral{retentionStats.referrals === 1 ? '' : 's'} near you
              </Text>
            </View>
          ) : null}
          {retentionStats.activeToday > 0 ? (
            <View style={[s.retBlip, { borderColor: 'rgba(245,166,35,0.45)' }]}>
              <Flame size={10} color={colors.primary} />
              <Text style={[s.retBlipTxt, { color: colors.primary }]}>
                {retentionStats.activeToday} active today
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Feed */}
      {visiblePosts.length === 0 ? (
        <EmptyState category={category} hasQuery={!!q.trim()} />
      ) : (
        <FlatList
          data={visiblePosts}
          keyExtractor={(p) => p.post_id}
          contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: 140, gap: 12 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item, index }) => {
            const isSelected = selectedIds.has(item.post_id);
            return (
              <StaggeredCard index={index}>
                <Pressable
                  onPress={modMode ? () => toggleSelect(item.post_id) : undefined}
                  style={modMode ? { position: 'relative' } : undefined}
                >
                  <PostCard
                    p={item}
                    isLiked={!!likedMap[item.post_id] || !!item.is_liked}
                    isSaved={!!savedMap[item.post_id]}
                    canDelete={isAdmin || (!!me && item?.author?.user_id === me.user_id)}
                    onLike={() => toggleLike(item.post_id)}
                    onSave={() => toggleSave(item.post_id)}
                    onShare={() => onShare(item)}
                    onMessage={() => item.author?.user_id && onMessage(item.author.user_id, item.post_id)}
                    onApply={() => item.author?.user_id && onMessage(item.author.user_id, item.post_id)}
                    onDelete={() => handleDelete(item)}
                    moderationOverlay={modMode ? (isSelected ? 'selected' : 'unselected') : null}
                  />
                </Pressable>
              </StaggeredCard>
            );
          }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* ---- Bulk-action confirmation modal ---- */}
      <Modal
        visible={!!bulkAction}
        transparent
        animationType="fade"
        onRequestClose={() => !bulkBusy && setBulkAction(null)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <View style={[
              s.modalIconWrap,
              { backgroundColor: bulkAction?.danger ? 'rgba(217,80,67,0.15)' : 'rgba(245,166,35,0.15)' },
            ]}>
              {bulkAction?.danger
                ? <AlertTriangle size={26} color={colors.secondary} />
                : <Shield size={26} color={colors.primary} />}
            </View>
            <Text style={s.modalTitle}>
              {bulkAction?.action === 'hard_delete'
                ? `Delete ${selectedIds.size} ${selectedIds.size === 1 ? 'post' : 'posts'} permanently?`
                : bulkAction?.action === 'hide'
                ? `Remove ${selectedIds.size} ${selectedIds.size === 1 ? 'post' : 'posts'} from community feed?`
                : `${bulkAction?.label} ${selectedIds.size} ${selectedIds.size === 1 ? 'post' : 'posts'}?`}
            </Text>
            <Text style={s.modalBody}>{bulkAction?.description}</Text>
            <View style={s.modalActions}>
              <Pressable
                onPress={() => setBulkAction(null)}
                style={[s.modalBtn, s.modalBtnGhost]}
                disabled={bulkBusy}
              >
                <Text style={s.modalBtnGhostTxt}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={performBulk}
                style={[
                  s.modalBtn,
                  bulkAction?.danger ? s.modalBtnDanger : s.modalBtnPrimary,
                  bulkBusy && { opacity: 0.6 },
                ]}
                disabled={bulkBusy}
                testID="community-mod-confirm"
              >
                {bulkBusy ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={bulkAction?.danger ? s.modalBtnDangerTxt : s.modalBtnPrimaryTxt}>
                    {bulkAction?.action === 'hide' ? 'Remove' : 'Confirm'}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ---- Sticky-bar action button ---------------------------------------------
function ModAction({ icon: Icon, label, count, danger, disabled, onPress }: {
  icon: any; label: string; count: number; danger?: boolean; disabled?: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles_modAction.btn,
        danger && styles_modAction.btnDanger,
        disabled && styles_modAction.btnDisabled,
      ]}
    >
      <Icon size={14} color={disabled ? colors.textTertiary : danger ? colors.secondary : colors.text} />
      <Text style={[
        styles_modAction.txt,
        danger && { color: colors.secondary },
        disabled && { color: colors.textTertiary },
      ]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles_modAction = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderWidth: 1,
  },
  btnDanger: {
    backgroundColor: 'rgba(217,80,67,0.08)',
    borderColor: 'rgba(217,80,67,0.30)',
  },
  btnDisabled: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    opacity: 0.6,
  },
  txt: {
    color: colors.text,
    fontFamily: font.bodySemibold,
    fontSize: 12.5,
  },
});

// ============================================================================
// Staggered fade-in wrapper for feed cards
// ============================================================================
function StaggeredCard({ index, children }: { index: number; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    const delay = Math.min(index * 45, 360);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1, duration: 360, delay,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(translate, {
        toValue: 0, duration: 360, delay,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start();
  }, [index, opacity, translate]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY: translate }] }}>
      {children}
    </Animated.View>
  );
}

// ============================================================================
// PostCard
// ============================================================================
function PostCard({
  p, isLiked, isSaved, canDelete, onLike, onSave, onShare, onMessage, onApply, onDelete,
  moderationOverlay,
}: {
  p: any;
  isLiked?: boolean;
  isSaved?: boolean;
  canDelete?: boolean;
  onLike: () => void;
  onSave: () => void;
  onShare: () => void;
  onMessage: () => void;
  onApply: () => void;
  onDelete: () => void;
  /** When set, the card is rendered in moderation-mode with a checkbox
   *  overlay and gold selection border. */
  moderationOverlay?: 'selected' | 'unselected' | null;
}) {
  const meta = categoryMeta(p.category);
  const hasKnownCat = !!CATEGORIES.find((c) => c.key === p.category && c.key !== 'all');
  const a = p.author || {};
  const isReferral = p.category === 'referrals';
  const elite = a.plan === 'elite';
  const verified = a.verification_status === 'verified';
  const likeCount = (p.like_count ?? p.likes ?? 0) + (isLiked && !p.is_liked ? 1 : 0);
  const commentCount = p.comment_count ?? p.comments ?? 0;
  const cover = (Array.isArray(p.images) ? p.images[0] : null);
  const coverUrl = cover?.image_url || cover?.url || (typeof cover === 'string' ? cover : null);
  const inModMode = !!moderationOverlay;
  const isSelected = moderationOverlay === 'selected';

  return (
    <Pressable
      onPress={inModMode ? undefined : () => router.push(`/community/post/${p.post_id}` as any)}
      style={({ pressed }) => [
        s.card,
        elite && s.cardElite,
        pressed && !inModMode && s.cardPressed,
        isSelected && s.cardModSelected,
        inModMode && !isSelected && s.cardModUnselected,
      ]}
      testID={`community-post-${p.post_id}`}
    >
      {/* Moderation checkbox overlay (Apr 2026 sprint) */}
      {inModMode ? (
        <View style={s.cardModBadge} pointerEvents="none">
          {isSelected ? (
            <CheckCircle2 size={22} color={colors.primary} />
          ) : (
            <Circle size={22} color="rgba(255,255,255,0.7)" />
          )}
        </View>
      ) : null}
      {/* Top: author row */}
      <View style={s.cardHead}>
        <Pressable
          onPress={() => a.user_id && router.push(`/user/${a.user_id}` as any)}
          style={s.avatarWrap}
        >
          {a.avatar_url ? (
            <Image source={{ uri: a.avatar_url }} style={s.avatar} />
          ) : (
            <View style={[s.avatar, s.avatarFallback]}>
              <Text style={s.avatarTxt}>
                {(a.name || a.username || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          {elite ? <View style={s.eliteRing} pointerEvents="none" /> : null}
        </Pressable>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <Text style={s.name} numberOfLines={1}>{a.name || `@${a.username || 'user'}`}</Text>
            {verified ? (
              <View style={s.verifiedDot}>
                <Text style={s.verifiedDotTxt}>✓</Text>
              </View>
            ) : null}
            <UserBadge user={a} variant="inline" />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {a.city ? (
              <>
                <MapPin size={10} color={colors.textTertiary} />
                <Text style={s.subtle} numberOfLines={1}>
                  {a.city}{a.state ? `, ${a.state}` : ''}
                </Text>
                <Text style={s.subtleDot}>·</Text>
              </>
            ) : null}
            <Text style={s.subtle}>{timeAgo(p.created_at)}</Text>
          </View>
        </View>
        <View style={[s.catChip, { borderColor: meta.accent + '66', backgroundColor: meta.accent + '18', opacity: hasKnownCat ? 1 : 0 }]}>
          {meta.icon ? <meta.icon size={10} color={meta.accent} /> : null}
          <Text style={[s.catChipTxt, { color: meta.accent }]}>{meta.label}</Text>
        </View>
        {canDelete ? (
          <Pressable
            onPress={(e) => { e.stopPropagation?.(); onDelete(); }}
            hitSlop={10}
            style={s.deleteBtn}
            testID={`post-delete-${p.post_id}`}
          >
            <Trash2 size={14} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {/* Body — title + body */}
      {p.title ? (
        <Text style={s.title} numberOfLines={2}>{p.title}</Text>
      ) : null}
      {p.body ? (
        <Text style={s.body} numberOfLines={5}>{p.body}</Text>
      ) : null}

      {/* Image (if uploaded) */}
      {coverUrl ? (
        <View style={s.imgWrap}>
          <Image source={{ uri: coverUrl }} style={s.img} />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.55)']}
            style={s.imgGrad}
          />
        </View>
      ) : null}

      {/* Action row */}
      <View style={s.actions}>
        <Pressable onPress={onLike} hitSlop={8} style={s.actBtn} testID={`like-${p.post_id}`}>
          <Heart
            size={17}
            color={isLiked ? '#ef4444' : colors.textSecondary}
            fill={isLiked ? '#ef4444' : 'transparent'}
          />
          {likeCount > 0 ? (
            <Text style={[s.actTxt, isLiked && { color: '#ef4444' }]}>{likeCount}</Text>
          ) : null}
        </Pressable>
        <Pressable
          onPress={() => router.push(`/community/post/${p.post_id}` as any)}
          hitSlop={8}
          style={s.actBtn}
        >
          <MessageCircle size={17} color={colors.textSecondary} />
          {commentCount > 0 ? <Text style={s.actTxt}>{commentCount}</Text> : null}
        </Pressable>
        <Pressable onPress={onShare} hitSlop={8} style={s.actBtn}>
          <ShareIcon size={16} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          onPress={onSave}
          hitSlop={8}
          style={[s.actBtn, { marginLeft: 'auto' }]}
        >
          <Bookmark
            size={16}
            color={isSaved ? colors.primary : colors.textSecondary}
            fill={isSaved ? colors.primary : 'transparent'}
          />
        </Pressable>
      </View>

      {/* Referral CTA row — Apply + Message */}
      {isReferral && a.user_id ? (
        <View style={s.referralRow}>
          <Pressable onPress={onApply} style={[s.refBtn, s.refBtnPrimary]}>
            <Briefcase size={12} color="#1a1300" />
            <Text style={s.refBtnPrimaryTxt}>Apply</Text>
          </Pressable>
          <Pressable onPress={onMessage} style={[s.refBtn, s.refBtnSecondary]}>
            <Send size={12} color={colors.text} />
            <Text style={s.refBtnSecondaryTxt}>Message</Text>
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

// ============================================================================
// Empty state
// ============================================================================
function EmptyState({ category, hasQuery }: { category: CategoryKey; hasQuery: boolean }) {
  const meta = categoryMeta(category);
  const Icon = meta.icon;
  return (
    <View style={s.empty}>
      <View style={[s.emptyIcon, { backgroundColor: meta.accent + '1a', borderColor: meta.accent + '55' }]}>
        <Icon size={22} color={meta.accent} />
      </View>
      <Text style={s.emptyTitle}>
        {hasQuery
          ? 'No matching posts'
          : category === 'all' ? 'No posts yet' : `No ${meta.label.toLowerCase()} posts yet`}
      </Text>
      <Text style={s.emptyBody}>
        {hasQuery
          ? 'Try a different keyword or clear the search.'
          : 'Start the conversation. Share your work, ask for feedback, or post a referral.'}
      </Text>
      <Pressable
        onPress={() => router.push('/community/compose' as any)}
        style={s.emptyCta}
      >
        <Plus size={14} color="#1a1300" strokeWidth={3} />
        <Text style={s.emptyCtaTxt}>Create a post</Text>
      </Pressable>
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================
const s = StyleSheet.create({
  // Toolbar
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: space.xl,
    paddingTop: 2,
    paddingBottom: 10,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  searchInp: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 13, padding: 0 },
  composeBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  composeBtnPressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },

  // ---- Apr 2026 — Bulk Moderate mode ----
  modBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface1,
    borderColor: 'rgba(245,166,35,0.35)',
    borderWidth: StyleSheet.hairlineWidth,
  },
  modBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  modBar: {
    marginHorizontal: space.xl,
    marginBottom: space.sm,
    paddingVertical: 10,
    paddingHorizontal: space.md,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderColor: 'rgba(245,166,35,0.35)',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    gap: 10,
  },
  modBarHead: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  modBarClose: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.surface1,
    alignItems: 'center', justifyContent: 'center',
  },
  modBarTitle: {
    flex: 1,
    color: colors.text, fontFamily: font.bodyBold, fontSize: 14,
    letterSpacing: -0.1,
  },
  modBarSelectAll: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1,
  },
  modBarSelectAllTxt: {
    color: colors.primary, fontFamily: font.bodyBold, fontSize: 11.5, letterSpacing: 0.2,
  },
  modBarActions: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  // Apr 2026 — Stage 2 filter chips
  modBarFilters: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  modBarFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderColor: 'rgba(245,166,35,0.20)',
    borderWidth: StyleSheet.hairlineWidth,
  },
  modBarFilterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  modBarFilterTxt: {
    color: colors.textSecondary,
    fontFamily: font.bodyMedium,
    fontSize: 11.5,
    letterSpacing: 0.2,
  },
  modBarFilterTxtActive: {
    color: '#1a0a06',
    fontFamily: font.bodyBold,
  },

  // Modal
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  modalCard: {
    width: '100%', maxWidth: 400,
    backgroundColor: colors.surface1,
    borderRadius: radii.xl,
    borderColor: colors.border, borderWidth: 1,
    padding: space.xl,
    alignItems: 'center',
  },
  modalIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: space.md,
  },
  modalTitle: {
    color: colors.text, fontFamily: font.bodyBold, fontSize: 17,
    textAlign: 'center', marginBottom: 8, letterSpacing: -0.2,
  },
  modalBody: {
    color: colors.textSecondary, fontFamily: font.body, fontSize: 13,
    textAlign: 'center', lineHeight: 19, marginBottom: space.lg,
  },
  modalActions: {
    flexDirection: 'row', gap: space.md, width: '100%',
  },
  modalBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12,
    borderRadius: radii.md,
  },
  modalBtnGhost: {
    backgroundColor: colors.surface2,
    borderColor: colors.border, borderWidth: 1,
  },
  modalBtnGhostTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  modalBtnPrimary: { backgroundColor: colors.primary },
  modalBtnPrimaryTxt: { color: '#1a0a06', fontFamily: font.bodyBold, fontSize: 14 },
  modalBtnDanger: { backgroundColor: colors.secondary },
  modalBtnDangerTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 14 },

  // Category pills
  catRow: {
    paddingHorizontal: space.xl,
    paddingBottom: 10,
    gap: 6,
  },
  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catPillActive: {},
  catPillTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },

  // Retention strip
  retentionStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: space.xl,
    paddingBottom: 12,
  },
  retBlip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  retBlipTxt: { fontFamily: font.bodyBold, fontSize: 10.5 },

  // Card
  card: {
    padding: 14,
    borderRadius: 22,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  cardElite: { borderColor: 'rgba(245,166,35,0.45)' },
  cardPressed: { opacity: 0.92, transform: [{ scale: 0.997 }] },

  // Apr 2026 — moderation-mode visual states
  cardModSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  cardModUnselected: {
    opacity: 0.85,
  },
  cardModBadge: {
    position: 'absolute',
    top: 12, right: 12,
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: 5,
  },

  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarWrap: { position: 'relative', width: 42, height: 42 },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  avatarFallback: {
    backgroundColor: colors.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarTxt: {
    color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 15,
  },
  eliteRing: {
    position: 'absolute', top: -2, left: -2, right: -2, bottom: -2,
    borderRadius: 23,
    borderWidth: 1.5, borderColor: colors.primary,
  },
  name: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  subtle: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  subtleDot: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  verifiedDot: {
    width: 13, height: 13, borderRadius: 6.5,
    backgroundColor: '#3b82f6',
    alignItems: 'center', justifyContent: 'center',
  },
  verifiedDotTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 8 },
  elitePill: {
    paddingHorizontal: 6, paddingVertical: 1.5,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  elitePillTxt: { color: '#1a1300', fontFamily: font.bodyBold, fontSize: 8.5, letterSpacing: 0.6 },

  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  catChipTxt: { fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.4 },
  deleteBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },

  // Body — editorial typography that breathes
  title: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 17,
    letterSpacing: -0.2,
    lineHeight: 22,
  },
  body: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 13.5,
    lineHeight: 19.5,
  },

  imgWrap: {
    height: 220,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  img: { width: '100%', height: '100%' },
  imgGrad: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '40%' },

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingTop: 2,
  },
  actBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  actTxt: { color: colors.textSecondary, fontFamily: font.bodySemibold, fontSize: 12.5 },

  referralRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 4,
  },
  refBtn: {
    flex: 1,
    height: 36,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  refBtnPrimary: { backgroundColor: colors.primary },
  refBtnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  refBtnPrimaryTxt: { color: '#1a1300', fontFamily: font.bodyBold, fontSize: 12.5 },
  refBtnSecondaryTxt: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 12.5 },

  // Empty state
  empty: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingTop: 60,
    gap: 8,
  },
  emptyIcon: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  emptyTitle: {
    color: colors.text, fontFamily: font.display, fontSize: 18, marginTop: 6, letterSpacing: -0.2,
  },
  emptyBody: {
    color: colors.textSecondary, fontFamily: font.body, fontSize: 13,
    textAlign: 'center', lineHeight: 18, marginBottom: 10,
    maxWidth: 280,
  },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, height: 40, borderRadius: 20,
    backgroundColor: colors.primary,
  },
  emptyCtaTxt: { color: '#1a1300', fontFamily: font.bodyBold, fontSize: 13 },
});
