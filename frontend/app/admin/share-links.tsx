/**
 * Admin → Share Links — Jun 2025.
 *
 * Lets support / moderator / admin / super_admin review every active
 * public Share Location link and hard-delete any of them. Built on
 * top of the backend endpoints added the same day:
 *
 *   GET    /api/admin/share-links          — active list (support+)
 *   DELETE /api/admin/share-links/{token}  — hard delete (support+)
 *   GET    /api/admin/share-links/audit    — audit feed (admin+)
 *
 * Two tabs:
 *   • Active Links  — visible to all staff roles.
 *   • Audit Log     — visible to admin / super_admin only.
 *
 * Deletion is irreversible. A confirmation row is required before the
 * DELETE request fires (matches the product spec copy). On success
 * the row is removed from the list immediately so the screen never
 * shows stale state.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, TextInput, Linking } from 'react-native';
import { useAuth } from '../../src/auth';
import { api, formatApiError } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import EmptyState from '../../src/components/EmptyState';
import ScreenErrorBoundary from '../../src/components/ScreenErrorBoundary';
import { Alert } from 'react-native';
import {
  Link2, Trash2, ExternalLink, RefreshCw, Search, Shield,
  ScrollText, ClipboardCheck, X } from 'lucide-react-native';

type ShareLink = {
  share_id: string;
  token: string;
  share_url: string | null;
  spot_id: string;
  spot_title?: string | null;
  created_at: string;
  created_by_user_id?: string | null;
  created_by_role?: string | null;
  last_accessed_at?: string | null;
  access_count: number;
  show_exact_location: boolean;
  personal_note?: string | null;
  label?: string | null;
};

type AuditRow = {
  audit_id: string;
  deleted_share_link_id?: string;
  token?: string;
  location_id?: string;
  location_name?: string;
  deleted_by_user_id?: string;
  deleted_by_role?: string;
  original_created_by_user_id?: string;
  deleted_at: string;
  reason?: string | null;
  action_type: string;
};

const ROLE_RANK: Record<string, number> = {
  user: 0, moderator: 1, support: 1, admin: 3, super_admin: 4 };

export default function AdminShareLinksScreen() {
  return (
    <ScreenErrorBoundary label="Admin · Share Links">
      <AdminShareLinksImpl />
    </ScreenErrorBoundary>
  );
}

function AdminShareLinksImpl() {
  const { user } = useAuth();
  const myRank = ROLE_RANK[(user?.role) || 'user'] || 0;
  const canSeeAudit = myRank >= ROLE_RANK.admin;

  const [tab, setTab] = useState<'active' | 'audit'>('active');
  const [items, setItems] = useState<ShareLink[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ShareLink | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadActive = useCallback(async () => {
    setError(null);
    try {
      const params: any = { limit: 100 };
      if (search.trim()) params.q = search.trim();
      const r = await api.get('/admin/share-links', params);
      setItems(r?.items || []);
    } catch (e) {
      setError(formatApiError(e) || 'Failed to load share links');
    }
  }, [search]);

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
    setLoading(true);
    try {
      if (tab === 'active') {
        await loadActive();
      } else if (canSeeAudit) {
        await loadAudit();
      }
    } finally {
      setLoading(false);
    }
  }, [tab, canSeeAudit, loadActive, loadAudit]);

  useEffect(() => { load(); }, [load]);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  const onConfirmDelete = useCallback(async () => {
    const link = pendingDelete;
    if (!link) return;
    setPendingDelete(null);
    try {
      await api.delete(`/admin/share-links/${link.token}`);
      // Optimistic: drop the row from local state immediately.
      setItems((prev) => prev.filter((x) => x.token !== link.token));
      Alert.alert('Share link revoked and deleted.');
    } catch (e) {
      Alert.alert(formatApiError(e) || "Couldn't delete this share link. Please try again.");
    }
  }, [pendingDelete]);

  // -- Renderers -------------------------------------------------------

  const renderActive = () => (
    <View>
      <View style={styles.searchRow}>
        <Search size={14} color={colors.textSecondary} />
        <TextInput
          value={searchInput}
          onChangeText={setSearchInput}
          onSubmitEditing={() => setSearch(searchInput)}
          placeholder="Search by location title…"
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

      {items.length === 0 ? (
        <EmptyState
          icon={Link2}
          title="No active share links"
          message={search ? 'No matches for that location title.' : 'When users create public share links, they appear here.'}
        />
      ) : (
        items.map((it) => (
          <ShareLinkRow
            key={it.share_id || it.token}
            item={it}
            pending={pendingDelete?.token === it.token}
            onAskDelete={() => setPendingDelete(it)}
            onCancelDelete={() => setPendingDelete(null)}
            onConfirmDelete={onConfirmDelete}
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
        {audit.map((a) => <AuditRow key={a.audit_id} row={a} />)}
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
      <Text style={styles.title}>Share Links</Text>
      <Text style={styles.subtitle}>
        Public location share links. Deletes are immediate and permanent — the public URL stops working at once.
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
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : tab === 'active' ? renderActive() : renderAudit()}
    </ScrollView>
  );
}

// ──────────────────────────────────────────────────────────────────────
function ShareLinkRow({
  item, pending, onAskDelete, onCancelDelete, onConfirmDelete,
}: {
  item: ShareLink;
  pending: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const created = useMemo(() => new Date(item.created_at).toLocaleDateString(), [item.created_at]);
  const accessed = item.last_accessed_at
    ? new Date(item.last_accessed_at).toLocaleDateString()
    : '—';

  const openLink = () => {
    if (item.share_url) {
      Linking.openURL(item.share_url).catch(() => {});
    }
  };

  return (
    <View style={styles.row} testID={`share-link-row-${item.token}`}>
      <View style={styles.rowHeader}>
        <View style={styles.iconCircle}>
          <Link2 size={14} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.spot_title || `Spot ${item.spot_id?.slice(-6) || ''}`}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            Created {created} · {item.access_count} view{item.access_count === 1 ? '' : 's'} · Last opened {accessed}
          </Text>
        </View>
      </View>

      {item.personal_note ? (
        <Text style={styles.note} numberOfLines={2}>“{item.personal_note}”</Text>
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.linkBtn} onPress={openLink} testID={`share-link-open-${item.token}`}>
          <ExternalLink size={12} color={colors.textSecondary} />
          <Text style={styles.linkBtnText}>Open</Text>
        </TouchableOpacity>
        {!pending ? (
          <TouchableOpacity
            style={[styles.linkBtn, styles.linkBtnDanger]}
            onPress={onAskDelete}
            testID={`share-link-delete-${item.token}`}
          >
            <Trash2 size={12} color={colors.secondary} />
            <Text style={[styles.linkBtnText, styles.linkBtnTextDanger]}>Delete</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {pending ? (
        <View style={styles.confirmBox}>
          <Text style={styles.confirmText}>
            Are you sure you want to revoke and permanently delete this share link? Anyone with this link will lose access immediately.
          </Text>
          <View style={styles.confirmActions}>
            <TouchableOpacity style={styles.linkBtn} onPress={onCancelDelete} testID={`share-link-cancel-${item.token}`}>
              <Text style={styles.linkBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.linkBtn, styles.linkBtnDanger]}
              onPress={onConfirmDelete}
              testID={`share-link-confirm-${item.token}`}
            >
              <Trash2 size={12} color={colors.secondary} />
              <Text style={[styles.linkBtnText, styles.linkBtnTextDanger]}>Yes, delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function AuditRow({ row }: { row: AuditRow }) {
  const when = useMemo(() => {
    try { return new Date(row.deleted_at).toLocaleString(); }
    catch { return row.deleted_at || ''; }
  }, [row.deleted_at]);
  return (
    <View style={styles.row} testID={`audit-row-${row.audit_id}`}>
      <View style={styles.rowHeader}>
        <View style={[styles.iconCircle, { backgroundColor: 'rgba(220,80,80,0.10)', borderColor: 'rgba(220,80,80,0.30)' }]}>
          <ClipboardCheck size={14} color={colors.secondary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {row.location_name || `Spot ${(row.location_id || '').slice(-6)}`}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            Deleted by {row.deleted_by_role || '?'} on {when}
          </Text>
        </View>
      </View>
      {row.reason ? (
        <Text style={styles.note} numberOfLines={3}>Reason: {row.reason}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingBottom: 100, gap: space.md },
  title: {
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 22,
  },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  tabActive: {
    backgroundColor: 'rgba(245,166,35,0.10)',
    borderColor: 'rgba(245,166,35,0.36)',
  },
  tabText: { color: colors.textSecondary, fontFamily: font.bodySemibold, fontSize: 12.5 },
  tabTextActive: { color: colors.primary },
  refreshBtn: {
    marginLeft: 'auto',
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.divider,
  },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.divider,
    marginBottom: space.md,
  },
  searchInput: {
    flex: 1, color: colors.text, fontFamily: font.body, fontSize: 13.5, padding: 0,
  },

  errorBanner: {
    color: colors.secondary,
    backgroundColor: 'rgba(220,80,80,0.10)',
    borderColor: 'rgba(220,80,80,0.30)',
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 10,
    fontFamily: font.body,
    fontSize: 12.5,
    marginBottom: 4,
  },
  loadingWrap: { padding: space.xl, alignItems: 'center' },

  row: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: space.md,
    gap: 8,
    marginBottom: space.md,
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
  note: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 12.5,
    fontStyle: 'italic',
    paddingHorizontal: 4,
  },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    borderWidth: 1, borderColor: colors.divider,
  },
  linkBtnDanger: {
    backgroundColor: 'rgba(220,80,80,0.10)',
    borderColor: 'rgba(220,80,80,0.30)',
  },
  linkBtnText: { color: colors.textSecondary, fontFamily: font.bodySemibold, fontSize: 11.5 },
  linkBtnTextDanger: { color: colors.secondary },

  confirmBox: {
    marginTop: 4,
    padding: 10,
    backgroundColor: 'rgba(220,80,80,0.06)',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(220,80,80,0.20)',
    gap: 8,
  },
  confirmText: {
    color: colors.text,
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
  },
  confirmActions: { flexDirection: 'row', gap: 8 },
});
