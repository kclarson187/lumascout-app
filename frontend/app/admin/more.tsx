/**
 * Admin · More — lower-frequency tools moved out of primary nav.
 *
 * Organized into sections:
 *   • SYSTEM      → System Health (Analytics), Diagnostics, Activity Log
 *   • CONTENT     → Reports, Edit Requests, Flagged Posts (deep links)
 *   • BUSINESS    → Marketplace, Marketplace Purchases
 *   • PLATFORM    → Scout AI Controls, Community, Admin Settings
 *
 * Each entry is a tight one-line row with icon + label + helper + chevron.
 * No oversized cards — list rows only.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import {
  Activity, Wrench, FileText, Flag, Edit3, AlertTriangle,
  ShoppingBag, Receipt, Sparkles, MessageSquare, Settings, ChevronRight, Layers } from 'lucide-react-native';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';

type Item = {
  key: string;
  label: string;
  helper: string;
  icon: any;
  route: string;
  iconColor?: string;
  minRole?: 'moderator' | 'admin' | 'super_admin';
};

const ROLE_RANK: Record<string, number> = {
  user: 0, moderator: 1, support: 1, admin: 3, super_admin: 4 };

const SECTIONS: { title: string; items: Item[] }[] = [
  {
    title: 'System',
    items: [
      { key: 'analytics',   label: 'System Health',  helper: 'Signups, approvals, charts', icon: Activity, route: '/admin/analytics', iconColor: colors.success },
      { key: 'diagnostics', label: 'Diagnostics',    helper: 'Backend URL · runtime · sample image', icon: Wrench, route: '/admin/diagnostics', iconColor: colors.info },
      { key: 'audit',       label: 'Activity Log',   helper: 'Admin actions audit trail', icon: FileText, route: '/admin/audit', iconColor: colors.textSecondary, minRole: 'admin' },
    ] },
  {
    title: 'Content',
    items: [
      { key: 'reports',  label: 'Reports',        helper: 'Full reports list with history', icon: Flag, route: '/admin/reports', iconColor: colors.secondary },
      { key: 'edits',    label: 'Edit Requests',  helper: 'Uploader proposed spot edits',   icon: Edit3, route: '/admin/edit-requests', iconColor: colors.info },
      { key: 'posts',    label: 'Community Posts', helper: 'Browse, filter, restore posts', icon: AlertTriangle, route: '/admin/posts', iconColor: colors.primary },
      { key: 'parks',    label: 'Parks',           helper: 'Edit · merge · move child spots', icon: Layers, route: '/admin/parks', iconColor: colors.primary },
    ] },
  {
    title: 'Business',
    items: [
      { key: 'mkt',   label: 'Marketplace',         helper: 'Listings, payouts, refunds',     icon: ShoppingBag, route: '/admin/marketplace',           iconColor: colors.primary },
      { key: 'mktp', label: 'Marketplace Purchases', helper: 'Order history & receipts',       icon: Receipt,    route: '/admin/marketplace-purchases', iconColor: colors.info },
    ] },
  {
    title: 'Platform',
    items: [
      { key: 'ai',        label: 'Scout AI Controls', helper: 'Cadence, editorial, replies', icon: Sparkles, route: '/admin/ai-controls', iconColor: colors.primary },
      { key: 'community', label: 'Community Tools',   helper: 'Member status & escalations', icon: MessageSquare, route: '/admin/community', iconColor: colors.success },
      { key: 'settings',  label: 'Admin Settings',    helper: 'Global flags & owner-only',   icon: Settings, route: '/admin/settings', iconColor: colors.textSecondary, minRole: 'super_admin' },
    ] },
];

export default function AdminMore() {
  const { user } = useAuth();
  const myRank = ROLE_RANK[(user?.role) || 'user'] || 0;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 100, gap: space.lg }}>
      <Text style={styles.intro}>
        Less-frequent admin tools live here so the primary tabs stay focused on review work.
      </Text>

      {SECTIONS.map((sec) => {
        const allowed = sec.items.filter(
          (it) => !it.minRole || myRank >= (ROLE_RANK[it.minRole] || 99),
        );
        if (allowed.length === 0) return null;
        return (
          <View key={sec.title}>
            <Text style={styles.sectionLabel}>{sec.title}</Text>
            <View style={styles.list}>
              {allowed.map((it, idx) => {
                const Icon = it.icon;
                return (
                  <TouchableOpacity
                    key={it.key}
                    style={[styles.row, idx > 0 && styles.rowDivider]}
                    onPress={() => router.push(it.route as any)}
                    testID={`more-${it.key}`}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.iconBox, { backgroundColor: (it.iconColor || colors.primary) + '18' }]}>
                      <Icon size={15} color={it.iconColor || colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label} numberOfLines={1}>{it.label}</Text>
                      <Text style={styles.helper} numberOfLines={1}>{it.helper}</Text>
                    </View>
                    <ChevronRight size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  intro: {
    color: colors.textTertiary, fontFamily: font.body, fontSize: 12, lineHeight: 16 },
  sectionLabel: {
    color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11, marginBottom: 8 },
  list: {
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    borderRadius: radii.md,
    overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: space.md, paddingVertical: 12 },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  iconBox: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  helper: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 2 } });
