import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, TextInput } from 'react-native';
import { Search, ChevronDown, ChevronRight, User as UserIcon, MapPin, FileText, Flag, Shield, ShieldCheck, Crown } from 'lucide-react-native';
import EmptyState from '../../src/components/EmptyState';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';

type Audit = {
  audit_id: string;
  action: string;
  admin_email?: string;
  admin_user_id: string;
  admin_role: string;
  target_type?: string;
  target_id?: string;
  before?: any;
  after?: any;
  notes?: string;
  created_at: string;
};

// Human-readable rewrites of raw actions.
const HUMAN: Record<string, (a: Audit) => { title: string; summary: string; Icon: any; color: string }> = {
  'user.grant_plan': (a) => ({
    title: 'Plan granted',
    summary: `${a.admin_email || 'Admin'} set ${targetLabel(a)} to ${(a.after?.plan || '').toUpperCase()}`,
    Icon: Crown, color: colors.primary }),
  'user.suspend': (a) => ({
    title: 'User suspended',
    summary: `${a.admin_email || 'Admin'} suspended ${targetLabel(a)}${a.notes ? ` — ${a.notes}` : ''}`,
    Icon: Shield, color: colors.secondary }),
  'user.unsuspend': (a) => ({
    title: 'User unsuspended',
    summary: `${a.admin_email || 'Admin'} restored ${targetLabel(a)}`,
    Icon: UserIcon, color: colors.success }),
  'user.update': (a) => ({
    title: 'User updated',
    summary: `${a.admin_email || 'Admin'} edited ${targetLabel(a)} — ${changeSummary(a.before, a.after)}`,
    Icon: UserIcon, color: colors.text }),
  'spot.approve': (a) => ({
    title: 'Spot approved',
    summary: `${a.admin_email || 'Admin'} approved ${targetLabel(a)}`,
    Icon: MapPin, color: colors.success }),
  'spot.reject': (a) => ({
    title: 'Spot rejected',
    summary: `${a.admin_email || 'Admin'} rejected ${targetLabel(a)}${a.notes ? ` — ${a.notes}` : ''}`,
    Icon: MapPin, color: colors.secondary }),
  'spot.remove': (a) => ({
    title: 'Spot removed',
    summary: `${a.admin_email || 'Admin'} removed ${targetLabel(a)}`,
    Icon: MapPin, color: colors.secondary }),
  'spot.delete_hard': (a) => ({
    title: 'Spot deleted (super admin)',
    summary: `${a.admin_email || 'Super admin'} permanently deleted ${a.before?.title ? `"${a.before.title}"` : targetLabel(a)}${a.notes ? ` — ${stripPrefix(a.notes)}` : ''}`,
    Icon: MapPin, color: colors.secondary }),
  'user.delete_soft': (a) => ({
    title: 'User deleted (super admin)',
    summary: `${a.admin_email || 'Super admin'} soft-deleted ${a.before?.username ? `@${a.before.username}` : targetLabel(a)}${a.notes ? ` — ${stripPrefix(a.notes)}` : ''}`,
    Icon: UserIcon, color: colors.secondary }),
  'post.remove': (a) => ({
    title: 'Post removed',
    summary: `${a.admin_email || 'Admin'} removed community post ${a.target_id}`,
    Icon: FileText, color: colors.secondary }),
  'post.restore': (a) => ({
    title: 'Post restored',
    summary: `${a.admin_email || 'Admin'} restored community post ${a.target_id}`,
    Icon: FileText, color: colors.success }),
  'report.resolve': (a) => ({
    title: 'Report resolved',
    summary: `${a.admin_email || 'Admin'} resolved report ${a.target_id}${a.notes ? ` — ${a.notes}` : ''}`,
    Icon: Flag, color: colors.success }),
  'report.dismiss': (a) => ({
    title: 'Report dismissed',
    summary: `${a.admin_email || 'Admin'} dismissed report ${a.target_id}`,
    Icon: Flag, color: colors.textTertiary }) };

function targetLabel(a: Audit) {
  if (!a.target_type) return 'item';
  const short = a.target_id ? a.target_id.slice(0, 14) : '';
  return `${a.target_type}${short ? ` · ${short}` : ''}`;
}

function stripPrefix(notes: string): string {
  // Audit notes can start with "[SUPER ADMIN] ..." — the tag already shows role, strip it.
  return notes.replace(/^\[SUPER ADMIN\]\s*/i, '').trim();
}

function changeSummary(before: any, after: any): string {
  if (!after || typeof after !== 'object') return 'fields updated';
  const keys = Object.keys(after);
  if (keys.length === 0) return 'fields updated';
  if (keys.length === 1) {
    const k = keys[0];
    return `${k}: ${fmtVal(before?.[k])} → ${fmtVal(after[k])}`;
  }
  return `${keys.length} field${keys.length === 1 ? '' : 's'} changed`;
}

function fmtVal(v: any): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v.length > 24 ? `${v.slice(0, 21)}…` : v;
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === 'object') return '{…}';
  return String(v);
}

function humanize(a: Audit) {
  const fn = HUMAN[a.action];
  if (fn) return fn(a);
  // Fallback — friendly split of "namespace.action"
  const [ns, ...rest] = (a.action || '').split('.');
  return {
    title: rest.join(' ').replace(/_/g, ' ') || a.action || 'action',
    summary: `${a.admin_email || 'Admin'} · ${ns || 'system'} · ${targetLabel(a)}`,
    Icon: FileText as any,
    color: colors.text };
}

function relativeTime(iso: string) {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function AdminAudit() {
  const [items, setItems] = useState<Audit[]>([]);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 50 };
      if (filter.trim()) params.action = filter.trim();
      const r = await api.get('/admin/audit-logs', params);
      setItems(r.items || []);
      setPages(r.pages || 1);
    } finally { setLoading(false); }
  }, [page, filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: space.xl, paddingTop: space.sm }}>
        <View style={styles.searchWrap}>
          <Search size={14} color={colors.textSecondary} />
          <TextInput
            value={filter}
            onChangeText={setFilter}
            onSubmitEditing={() => { setPage(1); load(); }}
            placeholder="Filter by action prefix (e.g. user.)"
            placeholderTextColor={colors.textTertiary}
            style={styles.searchInput}
            returnKeyType="search"
          />
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
          contentContainerStyle={{ padding: space.xl, gap: 8, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
        >
          {items.length === 0 && (
            <EmptyState
              icon={<ShieldCheck size={22} color={colors.primary} strokeWidth={1.5} />}
              title="No audit entries match"
              body="When admins or super admins moderate content, onboard sellers, or tweak platform settings, a tamper-evident record shows up here."
              testID="admin-audit-empty"
            />
          )}
          {items.map((a) => {
            const { title, summary, Icon, color } = humanize(a);
            const isOpen = !!expanded[a.audit_id];
            const hasDetail = a.before || a.after || a.notes;
            return (
              <TouchableOpacity
                key={a.audit_id}
                style={styles.row}
                onPress={() => hasDetail && setExpanded((x) => ({ ...x, [a.audit_id]: !isOpen }))}
                activeOpacity={hasDetail ? 0.85 : 1}
              >
                <View style={styles.iconBubble}>
                  <Icon size={16} color={color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={styles.title} numberOfLines={1}>{title}</Text>
                    <View style={[styles.tag, { borderColor: color }]}>
                      <Text style={[styles.tagTxt, { color }]}>{a.admin_role}</Text>
                    </View>
                  </View>
                  <Text style={styles.summary} numberOfLines={isOpen ? 0 : 2}>{summary}</Text>
                  <Text style={styles.meta}>{relativeTime(a.created_at)} · {a.action}</Text>
                  {isOpen && (a.before || a.after) && (
                    <View style={styles.diffWrap}>
                      {a.before && <Text style={styles.diffLabel}>Before</Text>}
                      {a.before && <Text style={styles.diffBefore}>{JSON.stringify(a.before, null, 2)}</Text>}
                      {a.after && <Text style={styles.diffLabel}>After</Text>}
                      {a.after && <Text style={styles.diffAfter}>{JSON.stringify(a.after, null, 2)}</Text>}
                    </View>
                  )}
                  {isOpen && a.notes && <Text style={styles.notes}>“{a.notes}”</Text>}
                </View>
                {hasDetail && (isOpen ? <ChevronDown size={14} color={colors.textSecondary} /> : <ChevronRight size={14} color={colors.textSecondary} />)}
              </TouchableOpacity>
            );
          })}

          {pages > 1 && (
            <View style={styles.pager}>
              <TouchableOpacity style={[styles.pagerBtn, page <= 1 && { opacity: 0.4 }]} disabled={page <= 1} onPress={() => setPage((p) => Math.max(1, p - 1))}>
                <Text style={styles.pagerTxt}>← Prev</Text>
              </TouchableOpacity>
              <Text style={styles.pagerPage}>{page} / {pages}</Text>
              <TouchableOpacity style={[styles.pagerBtn, page >= pages && { opacity: 0.4 }]} disabled={page >= pages} onPress={() => setPage((p) => p + 1)}>
                <Text style={styles.pagerTxt}>Next →</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: space.md, paddingVertical: 10 },
  searchInput: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 14 },
  empty: { color: colors.textTertiary, fontFamily: font.body, textAlign: 'center', marginTop: 40 },
  row: { flexDirection: 'row', gap: 10, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: space.md, alignItems: 'flex-start' },
  iconBubble: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },
  summary: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17, marginTop: 2 },
  meta: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10, marginTop: 4 },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.pill, borderWidth: 1 },
  tagTxt: { fontFamily: font.bodyBold, fontSize: 9 },
  diffWrap: { backgroundColor: colors.surface2, padding: 8, borderRadius: radii.sm, marginTop: 6, gap: 4 },
  diffLabel: { color: colors.textTertiary, fontFamily: font.bodyBold, fontSize: 9 },
  diffBefore: { color: colors.secondary, fontFamily: 'Menlo', fontSize: 10 },
  diffAfter: { color: colors.success, fontFamily: 'Menlo', fontSize: 10 },
  notes: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, fontStyle: 'italic', marginTop: 6 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: space.lg },
  pagerBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  pagerTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },
  pagerPage: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 } });
