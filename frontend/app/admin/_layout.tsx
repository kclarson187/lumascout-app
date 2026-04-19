import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Slot, router, usePathname } from 'expo-router';
import {
  LayoutDashboard, Users, Map, Flag, Activity, FileText, Settings, ChevronLeft, ShieldCheck,
} from 'lucide-react-native';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';

const ADMIN_ROLES = ['moderator', 'support', 'admin', 'super_admin'];

const TABS = [
  { key: 'index',     label: 'Overview',   icon: LayoutDashboard, path: '/admin' },
  { key: 'users',     label: 'Users',      icon: Users,           path: '/admin/users' },
  { key: 'spots',     label: 'Spots',      icon: Map,             path: '/admin/spots' },
  { key: 'reports',   label: 'Reports',    icon: Flag,            path: '/admin/reports' },
  { key: 'analytics', label: 'Analytics',  icon: Activity,        path: '/admin/analytics' },
  { key: 'audit',     label: 'Audit',      icon: FileText,        path: '/admin/audit', minRole: 'admin' },
  { key: 'settings',  label: 'Settings',   icon: Settings,        path: '/admin/settings', minRole: 'super_admin' },
];

const ROLE_RANK: Record<string, number> = {
  user: 0, moderator: 1, support: 1, admin: 3, super_admin: 4,
};

export default function AdminLayout() {
  const { user } = useAuth();
  const pathname = usePathname();

  // Role guard — never render admin UI for regular users.
  const allowed = !!user && ADMIN_ROLES.includes(user.role || '');
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
  if (!allowed) {
    return (
      <SafeAreaView style={styles.gateWrap}>
        <View style={styles.gate}>
          <ShieldCheck size={28} color={colors.secondary} />
          <Text style={styles.gateTitle}>Access denied</Text>
          <Text style={styles.gateBody}>This dashboard is for PhotoScout staff only.</Text>
          <TouchableOpacity style={styles.gateBtn} onPress={() => router.replace('/(tabs)')}>
            <Text style={styles.gateBtnTxt}>Back to app</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const myRank = ROLE_RANK[user.role || 'user'] || 0;
  const visibleTabs = useMemo(
    () => TABS.filter((t) => !t.minRole || myRank >= (ROLE_RANK[t.minRole] || 99)),
    [myRank]
  );

  const active = (t: typeof TABS[number]) => {
    if (t.path === '/admin') return pathname === '/admin' || pathname === '/admin/';
    return pathname.startsWith(t.path);
  };

  return (
    <SafeAreaView style={styles.wrap} edges={['top']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.replace('/(tabs)/profile')} style={styles.backBtn} testID="admin-exit">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>PhotoScout · Admin</Text>
          <Text style={styles.title}>{user.role === 'super_admin' ? 'Super Admin' : (user.role || 'Staff').replace('_', ' ')}</Text>
        </View>
        <View style={styles.roleBadge}>
          <Text style={styles.roleBadgeTxt}>{(user.role || 'staff').toUpperCase()}</Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsStripScroll}
        contentContainerStyle={styles.tabsStrip}
      >
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          const on = active(t);
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => router.push(t.path as any)}
              style={[styles.tab, on && styles.tabActive]}
              testID={`admin-tab-${t.key}`}
            >
              <Icon size={15} color={on ? colors.textInverse : colors.textSecondary} />
              <Text style={[styles.tabTxt, on && styles.tabTxtActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.divider} />

      <View style={{ flex: 1 }}><Slot /></View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  head: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.xl, paddingVertical: space.md, gap: 8,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  kicker: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 24, letterSpacing: -0.3, textTransform: 'capitalize' },
  roleBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill,
    borderColor: colors.primary, borderWidth: 1, backgroundColor: 'rgba(245,166,35,0.12)',
  },
  roleBadgeTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.5 },
  tabsStripScroll: { flexGrow: 0, flexShrink: 0, maxHeight: 44 },
  tabsStrip: {
    paddingHorizontal: space.xl, paddingBottom: space.sm, gap: 8, alignItems: 'center',
  },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 30, paddingHorizontal: 12, borderRadius: radii.pill,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  tabTxtActive: { color: colors.textInverse, fontFamily: font.bodySemibold },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginTop: 4 },

  gateWrap: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  gate: { alignItems: 'center', gap: 10, maxWidth: 320 },
  gateTitle: { color: colors.text, fontFamily: font.display, fontSize: 26, textAlign: 'center' },
  gateBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  gateBtn: { marginTop: 14, paddingHorizontal: 20, paddingVertical: 12, borderRadius: radii.md, backgroundColor: colors.primary },
  gateBtnTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 14 },
});
