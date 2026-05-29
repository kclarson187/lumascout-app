/**
 * Admin → Active Share Links — Jun 2025 (Phase 4 dashboard).
 *
 * Replaces the original flat list with a grouped-by-location dashboard
 * that surfaces duplicate-link risk at a glance. Backed by the new
 * `GET /api/admin/share-links/grouped` endpoint which:
 *   • returns one group per spot with at least one active link
 *   • enriches each link with creator display_name + effective plan
 *   • computes per-group stats (active_link_count, total_views,
 *     is_multiple) and a top-of-page summary (total_links,
 *     total_locations, multi_locations, total_views)
 *   • supports server-side `multiple_only` filter, `q=` search, and
 *     `sort=newest|most_viewed|duplicate_count`
 *
 * Access:
 *   • Admin + Super Admin only. The previous build let moderator /
 *     support open this page; tightened here per the spec ("If
 *     moderator or support roles currently have broader admin
 *     dashboard access, do not automatically expose this page").
 *   • Hard-delete still routes through the existing
 *     `DELETE /api/admin/share-links/{token}` endpoint which writes
 *     a `share_link_audit_logs` entry before removing the row.
 *   • Audit Log tab — super_admin only, unchanged from prior turn.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, TextInput, Linking, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '../../src/auth';
import { api, formatApiError } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import EmptyState from '../../src/components/EmptyState';
import ScreenErrorBoundary from '../../src/components/ScreenErrorBoundary';
import {
  Link2, Trash2, ExternalLink, RefreshCw, Search, Shield,
  ScrollText, ClipboardCheck, X, AlertTriangle, MapPin, Eye,
  Copy as CopyIcon, ArrowDownAZ, Filter as FilterIcon } from 'lucide-react-native';

type GroupLink = {
  share_link_id: string;
  token: string;
  share_token_short?: string | null;
  share_url?: string | null;
  share_link_creator_id?: string | null;
  share_link_creator_name?: string | null;
  creator_membership_tier?: string | null;
  created_at: string;
  view_count: number;
  last_viewed_at?: string | null;
  status: string;
  label?: string | null;
  personal_note?: string | null;
};
type LocationGroup = {
  location_id: string;
  location_name: string;
  location_owner_id?: string | null;
  location_owner_name?: string | null;
  active_link_count: number;
  is_multiple: boolean;
  total_views: number;
  links: GroupLink[];
};
type GroupedResponse = {
  items: LocationGroup[];
  summary: {
    total_links: number;
    total_locations: number;
    multi_locations: number;
    total_views: number;
  };
};

type SortKey = 'newest' | 'most_viewed' | 'duplicate_count';

const ROLE_RANK: Record<string, number> = {
  user: 0, support: 1, moderator: 2, admin: 3, super_admin: 4 };

export default function AdminShareLinksScreen() {
  return (
    <ScreenErrorBoundary label="Admin · Share Links">
      <AdminShareLinksImpl />
    </ScreenErrorBoundary>
  );
}

function AdminShareLinksImpl() {
  const router = useRouter();
  const { user } = useAuth();
  const myRank = ROLE_RANK[(user?.role) || 'user'] || 0;
  // Admin + Super Admin only. Per spec, even moderator/support are
  // NOT exposed to this page automatically.
  const canSeePage = myRank >= ROLE_RANK.admin;
  const canSeeAudit = myRank >= ROLE_RANK.admin; // admin + super_admin

  const [tab, setTab] = useState<'active' | 'audit'>('active');
  const [data, setData] = useState<GroupedResponse | null>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters / sort.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [multipleOnly, setMultipleOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>('newest');

  // Confirm-delete state.
  const [pendingDelete, setPendingDelete] = useState<{ token: string; locationName: string } | null>(null);

  const loadGrouped = useCallback(async () => {
    setError(null);
    try {
      const params: Record<string, any> = { sort };
      if (multipleOnly) params.multiple_only = true;
      if (search.trim()) params.q = search.trim();
      const r = await api.get('/admin/share-links/grouped', params);
      setData(r as GroupedResponse);
    } catch (e) {
      setError(formatApiError(e) || 'Failed to load share links');
    }
  }, [sort, multipleOnly, search]);

  const loadAudit = useCallback(async () => {
    setError(null);
    try {
      const r = await api.get('/admin/share-links/audit', { limit: 100 });
      setAudit(r?.items || []);
    } catch (e) {
      setError(formatApiError(e) || 'Failed to load audit log');
    }
  }, []);

  const load = useCallback(async () => {
    if (!canSeePage) { setLoading(false); return; }
    setLoading(true);
    try {
      if (tab === 'active') await loadGrouped();
      else await loadAudit();
    } finally {
      setLoading(false);
    }
  }, [canSeePage, tab, loadGrouped, loadAudit]);

  useEffect(() => { load(); }, [load]);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  const doDelete = useCallback(async () => {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    try {
      await api.delete(`/admin/share-links/${target.token}`);
      // Optimistic local update — strip the link from any group that
      // contains it; recompute the group's count + is_multiple flag;
      // if the group hits zero, drop it entirely. Summary updates
      // in the same pass.
      setData((prev) => {
        if (!prev) return prev;
        const items: LocationGroup[] = [];
        let deltaLinks = 0;
        let deltaViews = 0;
        let deltaMulti = 0;
        let deltaLocations = 0;
        for (const g of prev.items) {
          const idx = g.links.findIndex((l) => l.token === target.token);
          if (idx === -1) { items.push(g); continue; }
          const removed = g.links[idx];
          deltaLinks -= 1;
          deltaViews -= removed.view_count || 0;
          const newLinks = g.links.filter((_, i) => i !== idx);
          if (newLinks.length === 0) {
            deltaLocations -= 1;
            if (g.is_multiple) deltaMulti -= 1;
            continue; // drop the empty group
          }
          const newIsMultiple = newLinks.length > 1;
          if (g.is_multiple && !newIsMultiple) deltaMulti -= 1;
          items.push({
            ...g,
            links: newLinks,
            active_link_count: newLinks.length,
            is_multiple: newIsMultiple,
            total_views: g.total_views - (removed.view_count || 0),
          });
        }
        return {
          items,
          summary: {
            total_links: prev.summary.total_links + deltaLinks,
            total_locations: prev.summary.total_locations + deltaLocations,
            multi_locations: prev.summary.multi_locations + deltaMulti,
            total_views: prev.summary.total_views + deltaViews,
          },
        };
      });
      Alert.alert('Share link deleted.');
    } catch (e) {
      Alert.alert(formatApiError(e) || "Couldn't delete this share link. Please try again.");
    }
  }, [pendingDelete]);

  // -- Access gate -----------------------------------------------------
  if (!canSeePage) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Active Share Links</Text>
        <EmptyState
          icon={Shield}
          title="Restricted"
          message="The Share Links dashboard is available to Admin and Super Admin only."
        />
      </ScrollView>
    );
  }

  // -- Renderers -------------------------------------------------------
  const summary = data?.summary;

  const renderActive = () => (
    <View>
      {/* Summary cards */}
      <View style={styles.summaryRow}>
        <SummaryCard label="Active Links" value={summary?.total_links ?? '—'} icon={Link2} />
        <SummaryCard label="Locations" value={summary?.total_locations ?? '—'} icon={MapPin} />
        <SummaryCard
          label="Multi Links"
          value={summary?.multi_locations ?? '—'}
          icon={AlertTriangle}
          accent={(summary?.multi_locations ?? 0) > 0}
        />
        <SummaryCard label="Total Views" value={summary?.total_views ?? '—'} icon={Eye} />
      </View>

      {/* Filters / search */}
      <View style={styles.searchRow}>
        <Search size={14} color={colors.textSecondary} />
        <TextInput
          value={searchInput}
          onChangeText={setSearchInput}
          onSubmitEditing={() => setSearch(searchInput)}
          placeholder="Search by location or creator…"
          placeholderTextColor={colors.textTertiary}
          style={styles.searchInput}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          testID="share-links-search"
        />
        {searchInput ? (
          <TouchableOpacity onPress={() => { setSearchInput(''); setSearch(''); }} hitSlop={10}>
            <X size={14} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.chip, multipleOnly && styles.chipOn]}
          onPress={() => setMultipleOnly((v) => !v)}
          testID="share-links-filter-multiple"
        >
          <FilterIcon size={11} color={multipleOnly ? colors.primary : colors.textSecondary} />
          <Text style={[styles.chipText, multipleOnly && styles.chipTextOn]}>
            Multiple Links Only
          </Text>
        </TouchableOpacity>

        <View style={styles.sortBox}>
          <ArrowDownAZ size={11} color={colors.textSecondary} />
          {(['newest','most_viewed','duplicate_count'] as SortKey[]).map((k) => (
            <TouchableOpacity
              key={k}
              style={[styles.sortChip, sort === k && styles.sortChipOn]}
              onPress={() => setSort(k)}
              testID={`share-links-sort-${k}`}
            >
              <Text style={[styles.sortChipText, sort === k && styles.sortChipTextOn]}>
                {k === 'newest' ? 'Newest' : k === 'most_viewed' ? 'Most viewed' : 'Duplicates'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Groups */}
      {(data?.items || []).length === 0 ? (
        <EmptyState
          icon={Link2}
          title={multipleOnly ? 'No duplicates found' : 'No active share links'}
          message={
            multipleOnly
              ? 'No locations currently have more than one active share link.'
              : 'When users mint public share links, they will appear here grouped by location.'
          }
        />
      ) : (
        (data?.items || []).map((g) => (
          <LocationGroupCard
            key={g.location_id}
            group={g}
            onOpenSpot={() => router.push(`/spot/${g.location_id}` as any)}
            onAskDelete={(token) => setPendingDelete({ token, locationName: g.location_name })}
          />
        ))
      )}
    </View>
  );

  const renderAudit = () => {
    if (!canSeeAudit) {
      return (
        <EmptyState
          icon={Shield}
          title="Restricted"
          message="The deletion audit log is visible to admin and super admin only."
        />
      );
    }
    if (audit.length === 0) {
      return (
        <EmptyState
          icon={ScrollText}
          title="No deletions yet"
          message="When a share link is revoked, the action will appear here for audit."
        />
      );
    }
    return (
      <View>
        {audit.map((a: any) => (
          <View key={a.audit_id} style={styles.row}>
            <View style={styles.rowHeader}>
              <View style={[styles.iconCircle, { backgroundColor: 'rgba(220,80,80,0.10)', borderColor: 'rgba(220,80,80,0.30)' }]}>
                <ClipboardCheck size={14} color={colors.secondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {a.location_name || `Spot ${(a.location_id || '').slice(-6)}`}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  Deleted by {a.deleted_by_role || '?'} on {a.deleted_at ? new Date(a.deleted_at).toLocaleString() : '—'}
                </Text>
              </View>
            </View>
            {a.reason ? <Text style={styles.note} numberOfLines={3}>Reason: {a.reason}</Text> : null}
          </View>
        ))}
      </View>
    );
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={colors.primary} />}
      testID="admin-share-links-screen"
    >
      <Text style={styles.title}>Active Share Links</Text>
      <Text style={styles.subtitle}>
        Every active public Share Location link, grouped by location. Locations with more than one active link are highlighted so you can prune duplicates.
      </Text>

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, tab === 'active' && styles.tabActive]}
          onPress={() => setTab('active')}
          testID="share-links-tab-active"
        >
          <Text style={[styles.tabText, tab === 'active' && styles.tabTextActive]}>Active</Text>
        </TouchableOpacity>
        {canSeeAudit ? (
          <TouchableOpacity
            style={[styles.tab, tab === 'audit' && styles.tabActive]}
            onPress={() => setTab('audit')}
            testID="share-links-tab-audit"
          >
            <Text style={[styles.tabText, tab === 'audit' && styles.tabTextActive]}>Audit Log</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={load}
          disabled={loading}
          testID="share-links-refresh"
        >
          <RefreshCw size={14} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

      {loading ? (
        <View style={styles.loadingWrap}><ActivityIndicator color={colors.primary} /></View>
      ) : tab === 'active' ? renderActive() : renderAudit()}

      {/* Confirm-delete modal (inline, dismiss-on-cancel). */}
      {pendingDelete ? (
        <View style={styles.confirmOverlay} pointerEvents="box-none">
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{pendingDelete.locationName}</Text>
            <Text style={styles.confirmText}>
              Are you sure you want to revoke and permanently delete this share link? Anyone with this link will lose access immediately.
            </Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity style={styles.btnSecondary} onPress={() => setPendingDelete(null)}>
                <Text style={styles.btnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnDanger} onPress={doDelete} testID="share-links-confirm-delete">
                <Trash2 size={13} color={colors.secondary} />
                <Text style={styles.btnDangerText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

// ────────────────────────────────────────────────────────────────────
function SummaryCard({
  label, value, icon: Icon, accent,
}: { label: string; value: number | string; icon: any; accent?: boolean }) {
  return (
    <View style={[styles.summaryCard, accent && styles.summaryCardAccent]}>
      <View style={styles.summaryIcon}>
        <Icon size={13} color={accent ? colors.secondary : colors.primary} />
      </View>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function LocationGroupCard({
  group, onOpenSpot, onAskDelete,
}: { group: LocationGroup; onOpenSpot: () => void; onAskDelete: (token: string) => void }) {
  return (
    <View style={[styles.group, group.is_multiple && styles.groupMultiple]} testID={`group-${group.location_id}`}>
      <View style={styles.groupHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.groupTitle} numberOfLines={1}>{group.location_name}</Text>
          <Text style={styles.groupMeta} numberOfLines={1}>
            ID {group.location_id?.slice(-8)} · Owner {group.location_owner_name || '—'}
          </Text>
        </View>
        <View style={[styles.countBadge, group.is_multiple && styles.countBadgeMultiple]}>
          <Text style={[styles.countBadgeText, group.is_multiple && styles.countBadgeTextMultiple]}>
            {group.active_link_count}
          </Text>
        </View>
      </View>

      {group.is_multiple ? (
        <View style={styles.dupeBadge}>
          <AlertTriangle size={11} color={colors.secondary} />
          <Text style={styles.dupeBadgeText}>Multiple active links</Text>
        </View>
      ) : null}

      <TouchableOpacity style={styles.openSpotBtn} onPress={onOpenSpot}>
        <MapPin size={11} color={colors.textSecondary} />
        <Text style={styles.openSpotBtnText}>Open location detail</Text>
      </TouchableOpacity>

      {group.links.map((l) => <LinkRow key={l.share_link_id || l.token} link={l} onAskDelete={onAskDelete} />)}
    </View>
  );
}

function LinkRow({ link, onAskDelete }: { link: GroupLink; onAskDelete: (token: string) => void }) {
  const created = useMemo(() => {
    try { return new Date(link.created_at).toLocaleDateString(); }
    catch { return ''; }
  }, [link.created_at]);
  const lastViewed = link.last_viewed_at
    ? new Date(link.last_viewed_at).toLocaleDateString()
    : '—';
  const onCopy = async () => {
    if (link.share_url) {
      await Clipboard.setStringAsync(link.share_url).catch(() => {});
      Alert.alert('Share URL copied.');
    }
  };
  const onOpenPublic = () => {
    if (link.share_url) Linking.openURL(link.share_url).catch(() => {});
  };
  return (
    <View style={styles.linkRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.linkTitle} numberOfLines={1}>
          {link.share_link_creator_name || 'Unknown creator'}
          {link.creator_membership_tier ? (
            <Text style={styles.tier}>  ·  {link.creator_membership_tier}</Text>
          ) : null}
        </Text>
        <Text style={styles.linkMeta} numberOfLines={1}>
          {link.share_token_short || link.token?.slice(0, 8)} · Created {created} · {link.view_count} view{link.view_count === 1 ? '' : 's'} · Last opened {lastViewed}
        </Text>
      </View>
      <View style={styles.linkActions}>
        <TouchableOpacity style={styles.iconBtn} onPress={onCopy} testID={`share-link-copy-${link.token}`}>
          <CopyIcon size={12} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={onOpenPublic} testID={`share-link-open-public-${link.token}`}>
          <ExternalLink size={12} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.iconBtn, styles.iconBtnDanger]}
          onPress={() => onAskDelete(link.token)}
          testID={`share-link-delete-${link.token}`}
        >
          <Trash2 size={12} color={colors.secondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingBottom: 100, gap: space.md },
  title: { color: colors.text, fontFamily: font.bodyBold, fontSize: 22 },
  subtitle: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 18, marginBottom: 4 },

  tabBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  tab: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.divider,
  },
  tabActive: { backgroundColor: 'rgba(245,166,35,0.10)', borderColor: 'rgba(245,166,35,0.36)' },
  tabText: { color: colors.textSecondary, fontFamily: font.bodySemibold, fontSize: 12.5 },
  tabTextActive: { color: colors.primary },
  refreshBtn: {
    marginLeft: 'auto',
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.divider,
  },

  summaryRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 6 },
  summaryCard: {
    flexBasis: '23%', minWidth: 130, flexGrow: 1,
    padding: 12, backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.divider,
  },
  summaryCardAccent: { borderColor: 'rgba(220,80,80,0.32)', backgroundColor: 'rgba(220,80,80,0.05)' },
  summaryIcon: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.10)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.28)',
    marginBottom: 6,
  },
  summaryValue: { color: colors.text, fontFamily: font.bodyBold, fontSize: 20 },
  summaryLabel: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 1 },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.divider,
  },
  searchInput: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 13.5, padding: 0 },

  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, marginBottom: space.sm, alignItems: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: colors.surface1, borderRadius: radii.pill,
    borderWidth: 1, borderColor: colors.divider,
  },
  chipOn: { backgroundColor: 'rgba(245,166,35,0.10)', borderColor: 'rgba(245,166,35,0.36)' },
  chipText: { color: colors.textSecondary, fontFamily: font.bodySemibold, fontSize: 11.5 },
  chipTextOn: { color: colors.primary },
  sortBox: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' },
  sortChip: {
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: colors.surface1, borderRadius: radii.pill,
    borderWidth: 1, borderColor: colors.divider,
  },
  sortChipOn: { backgroundColor: 'rgba(245,166,35,0.10)', borderColor: 'rgba(245,166,35,0.36)' },
  sortChipText: { color: colors.textSecondary, fontFamily: font.bodySemibold, fontSize: 10.5 },
  sortChipTextOn: { color: colors.primary },

  errorBanner: {
    color: colors.secondary,
    backgroundColor: 'rgba(220,80,80,0.10)',
    borderColor: 'rgba(220,80,80,0.30)', borderWidth: 1, borderRadius: radii.md,
    padding: 10, fontFamily: font.body, fontSize: 12.5, marginBottom: 4,
  },
  loadingWrap: { padding: space.xl, alignItems: 'center' },

  // Generic row used by audit tab.
  row: {
    backgroundColor: colors.surface1, borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.divider,
    padding: space.md, gap: 8, marginBottom: space.md,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconCircle: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.10)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.28)',
  },
  rowTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13.5 },
  rowMeta: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11.5, marginTop: 1 },
  note: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12.5, fontStyle: 'italic', paddingHorizontal: 4 },

  // Group card
  group: {
    backgroundColor: colors.surface1, borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.divider,
    padding: space.md, marginBottom: space.md, gap: 8,
  },
  groupMultiple: {
    borderColor: 'rgba(220,80,80,0.40)',
    backgroundColor: 'rgba(220,80,80,0.04)',
  },
  groupHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  groupTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14.5 },
  groupMeta: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11.5, marginTop: 2 },
  countBadge: {
    minWidth: 28, height: 24, paddingHorizontal: 8,
    borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.30)',
  },
  countBadgeMultiple: {
    backgroundColor: 'rgba(220,80,80,0.18)',
    borderColor: 'rgba(220,80,80,0.40)',
  },
  countBadgeText: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 12 },
  countBadgeTextMultiple: { color: colors.secondary },
  dupeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: 'rgba(220,80,80,0.10)',
    borderRadius: radii.pill, borderWidth: 1, borderColor: 'rgba(220,80,80,0.36)',
  },
  dupeBadgeText: { color: colors.secondary, fontFamily: font.bodySemibold, fontSize: 11 },
  openSpotBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: colors.surface2, borderRadius: radii.pill,
    borderWidth: 1, borderColor: colors.divider,
  },
  openSpotBtnText: { color: colors.textSecondary, fontFamily: font.bodySemibold, fontSize: 11 },

  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: 'rgba(0,0,0,0.10)',
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.05)',
    marginTop: 4,
  },
  linkTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  tier: { color: colors.primary, fontSize: 11, fontFamily: font.bodySemibold },
  linkMeta: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 1 },
  linkActions: { flexDirection: 'row', gap: 6 },
  iconBtn: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.divider,
  },
  iconBtnDanger: { backgroundColor: 'rgba(220,80,80,0.12)', borderColor: 'rgba(220,80,80,0.32)' },

  // Confirm overlay (inline, not a Modal — keeps things simple)
  confirmOverlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: space.lg,
  },
  confirmCard: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: 'rgba(220,80,80,0.36)',
    padding: space.lg, gap: 10,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  confirmTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  confirmText: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12.5, lineHeight: 18 },
  confirmActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  btnSecondary: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill,
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.divider,
  },
  btnSecondaryText: { color: colors.textSecondary, fontFamily: font.bodySemibold, fontSize: 12.5 },
  btnDanger: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill,
    backgroundColor: 'rgba(220,80,80,0.18)', borderWidth: 1, borderColor: 'rgba(220,80,80,0.45)',
  },
  btnDangerText: { color: colors.secondary, fontFamily: font.bodySemibold, fontSize: 12.5 },
});
