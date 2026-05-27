import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Slot, router, usePathname } from 'expo-router';
import {
  LayoutDashboard, Inbox, Users, Map, MoreHorizontal, ChevronLeft, ShieldCheck } from 'lucide-react-native';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';

const ADMIN_ROLES = ['moderator', 'support', 'admin', 'super_admin'];

// New simplified primary nav per Jun-2025 admin overhaul.
// Less-used tools live under /admin/more.
const TABS = [
  { key: 'index', label: 'Overview', icon: LayoutDashboard, path: '/admin' },
  { key: 'queue', label: 'Queue',    icon: Inbox,           path: '/admin/queue' },
  { key: 'users', label: 'Users',    icon: Users,           path: '/admin/users' },
  { key: 'spots', label: 'Spots',    icon: Map,             path: '/admin/spots' },
  { key: 'more',  label: 'More',     icon: MoreHorizontal,  path: '/admin/more' },
];

const ROLE_RANK: Record<string, number> = {
  user: 0, moderator: 1, support: 1, admin: 3, super_admin: 4 };

export default function AdminLayout() {
  const { user } = useAuth();
  const pathname = usePathname();

  // FIX(Commit 5 / 2026-04): hooks-stability — compute unconditionally.
  const myRank = ROLE_RANK[(user && user.role) || 'user'] || 0;
  const visibleTabs = useMemo(() => TABS, [myRank]);

  if (!user) {
    return (
      <SafeAreaView style={styles.gateWrap}>
        <View style={styles.gate}>
          <ShieldCheck size={28} color={colors.primary} />
          <Text style={styles.gateTitle}>Admin sign-in required</Text>
          <Text style={styles.gateBody}>Log in with an admin account to access this dashboard.</Text>
          <TouchableOpacity style={styles.gateBtn} onPress={() => router.replace('/(auth)/login')}>
            <Text style={styles.gateBtnTxt}>Go to sign-in</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const allowed = !!user && ADMIN_ROLES.includes(user.role || '');
  if (!allowed) {
    return (
      <SafeAreaView style={styles.gateWrap}>
        <View style={styles.gate}>
          <ShieldCheck size={28} color={colors.secondary} />
          <Text style={styles.gateTitle}>Access denied</Text>
          <Text style={styles.gateBody}>This dashboard is for LumaScout staff only.</Text>
          <TouchableOpacity style={styles.gateBtn} onPress={() => router.replace('/(tabs)')}>
            <Text style={styles.gateBtnTxt}>Back to app</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isActive = (t: typeof TABS[number]) => {
    if (t.path === '/admin') return pathname === '/admin' || pathname === '/admin/';
    if (t.path === '/admin/more') {
      // "More" stays highlighted when on any sub-tool route.
      return pathname.startsWith('/admin/more')
        || pathname.startsWith('/admin/analytics')
        || pathname.startsWith('/admin/diagnostics')
        || pathname.startsWith('/admin/audit')
        || pathname.startsWith('/admin/settings')
        || pathname.startsWith('/admin/marketplace')
        || pathname.startsWith('/admin/community')
        || pathname.startsWith('/admin/ai-controls')
        || pathname.startsWith('/admin/posts')
        || pathname.startsWith('/admin/reports')
        || pathname.startsWith('/admin/edit-requests');
    }
    if (t.path === '/admin/queue') return pathname.startsWith('/admin/queue');
    if (t.path === '/admin/users') return pathname.startsWith('/admin/user');
    if (t.path === '/admin/spots') return pathname.startsWith('/admin/spots');
    return pathname.startsWith(t.path);
  };

  const roleLabel = user.role === 'super_admin'
    ? 'Super Admin'
    : (user.role || 'Staff').replace('_', ' ');

  return (
    <SafeAreaView style={styles.wrap} edges={['top']}>
      {/* Compact header */}
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.replace('/(tabs)/profile')} style={styles.backBtn} testID="admin-exit">
          <ChevronLeft size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.title}>Admin</Text>
          <View style={styles.roleBadge}>
            <ShieldCheck size={10} color={colors.primary} />
            <Text style={styles.roleBadgeTxt} numberOfLines={1}>{roleLabel}</Text>
          </View>
        </View>
      </View>

      {/* 5-up primary nav — fixed grid, no horizontal scroll */}
      <View style={styles.tabsRow}>
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          const on = isActive(t);
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => router.push(t.path as any)}
              style={styles.tab}
              testID={`admin-tab-${t.key}`}
              hitSlop={6}
            >
              <Icon size={18} color={on ? colors.primary : colors.textSecondary} />
              <Text style={[styles.tabTxt, on && styles.tabTxtActive]} numberOfLines={1}>{t.label}</Text>
              {on ? <View style={styles.tabUnderline} /> : <View style={styles.tabUnderlineHidden} />}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.divider} />

      <View style={{ flex: 1 }}><Slot /></View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  head: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.lg, paddingVertical: 8, gap: 4 },
  backBtn: {
    width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: {
    color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.3 },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill,
    borderColor: 'rgba(245,166,35,0.35)', borderWidth: 1,
    backgroundColor: 'rgba(245,166,35,0.08)' },
  roleBadgeTxt: {
    color: colors.primary, fontFamily: font.bodyBold, fontSize: 10 },

  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: space.xs,
    alignItems: 'stretch' },
  tab: {
    flex: 1,
    alignItems: 'center', justifyContent: 'flex-start',
    paddingVertical: 8, gap: 3 },
  tabTxt: {
    color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  tabTxtActive: { color: colors.primary, fontFamily: font.bodyBold },
  tabUnderline: {
    marginTop: 4, height: 2, width: 24, borderRadius: 1, backgroundColor: colors.primary },
  tabUnderlineHidden: { marginTop: 4, height: 2, width: 24 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },

  gateWrap: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  gate: { alignItems: 'center', gap: 10, maxWidth: 320 },
  gateTitle: { color: colors.text, fontFamily: font.display, fontSize: 26, textAlign: 'center' },
  gateBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  gateBtn: { marginTop: 14, paddingHorizontal: 20, paddingVertical: 12, borderRadius: radii.md, backgroundColor: colors.primary },
  gateBtnTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 14 } });
