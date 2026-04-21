import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Image, RefreshControl, Keyboard } from 'react-native';
import { router } from 'expo-router';
import { Search, ChevronRight, ShieldAlert, Flag } from 'lucide-react-native';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import VerifiedBadge from '../../src/components/VerifiedBadge';

const ROLE_FILTERS = ['all', 'user', 'moderator', 'admin', 'super_admin'];
const PLAN_FILTERS = ['all', 'free', 'pro', 'elite', 'comp_pro', 'comp_elite'];
const STATUS_FILTERS = ['all', 'active', 'suspended'];

const PLAN_COLOR: Record<string, string> = {
  free: colors.textSecondary,
  pro: colors.info,
  elite: colors.primary,
  comp_pro: colors.info,
  comp_elite: colors.primary,
  suspended: colors.secondary,
};

export default function AdminUsers() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const [plan, setPlan] = useState('all');
  const [status, setStatus] = useState('all');
  const [includeTest, setIncludeTest] = useState(false); // FIX(2026-04): [7.2]
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (q.trim()) params.q = q.trim();
      if (role !== 'all') params.role = role;
      if (plan !== 'all') params.plan = plan;
      if (status !== 'all') params.status = status;
      if (includeTest) params.include_test = true;
      setData(await api.get('/admin/users', params));
    } finally { setLoading(false); }
  }, [q, role, plan, status, includeTest, page]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.filterBar}>
        <View style={styles.searchWrap}>
          <Search size={14} color={colors.textSecondary} />
          <TextInput
            value={q}
            onChangeText={setQ}
            onSubmitEditing={() => { setPage(1); Keyboard.dismiss(); load(); }}
            placeholder="Search name, email, username…"
            placeholderTextColor={colors.textTertiary}
            style={styles.searchInput}
            returnKeyType="search"
            testID="admin-users-search"
          />
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, maxHeight: 44 }} contentContainerStyle={styles.chipsStrip}>
        {ROLE_FILTERS.map((r) => <Chip key={`role-${r}`} label={`role: ${r}`} active={role === r} onPress={() => { setPage(1); setRole(r); }} />)}
        {PLAN_FILTERS.map((p) => <Chip key={`plan-${p}`} label={`plan: ${p}`} active={plan === p} onPress={() => { setPage(1); setPlan(p); }} />)}
        {STATUS_FILTERS.map((s) => <Chip key={`status-${s}`} label={`status: ${s}`} active={status === s} onPress={() => { setPage(1); setStatus(s); }} />)}
        {/* FIX(2026-04): [7.2] show test/QA accounts on demand */}
        <Chip key="include-test" label={includeTest ? 'Test accounts: shown' : 'Hide test accounts'} active={includeTest} onPress={() => { setPage(1); setIncludeTest(v => !v); }} />
      </ScrollView>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space.xl, gap: 8, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
        >
          <Text style={styles.totals}>{data?.total ?? 0} match{(data?.total ?? 0) === 1 ? '' : 'es'} · page {data?.page ?? 1}/{data?.pages ?? 1}</Text>
          {(data?.items || []).map((u: any) => (
            <TouchableOpacity
              key={u.user_id}
              style={styles.row}
              onPress={() => router.push(`/admin/user/${u.user_id}` as any)}
              testID={`admin-user-${u.user_id}`}
            >
              {u.avatar_url
                ? <Image source={{ uri: u.avatar_url }} style={styles.avatar} />
                : <View style={[styles.avatar, { backgroundColor: colors.surface2 }]} />}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.name} numberOfLines={1}>{u.name}</Text>
                  <VerifiedBadge status={u.verification_status} variant="inline" size={12} />
                </View>
                <Text style={styles.sub} numberOfLines={1}>{u.email}</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  <Pill label={u.plan} color={PLAN_COLOR[u.plan] || colors.textSecondary} />
                  {u.role !== 'user' && <Pill label={u.role} color={colors.primary} />}
                  {u.status === 'suspended' && <Pill label="suspended" color={colors.secondary} />}
                  {u.spot_count > 0 && <Text style={styles.tiny}>· {u.spot_count} spots</Text>}
                  {u.open_reports > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                      <Flag size={11} color={colors.secondary} />
                      <Text style={[styles.tiny, { color: colors.secondary }]}>{u.open_reports}</Text>
                    </View>
                  )}
                </View>
              </View>
              <ChevronRight size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          ))}

          {data && data.pages > 1 && (
            <View style={styles.pager}>
              <TouchableOpacity
                style={[styles.pagerBtn, page <= 1 && styles.pagerBtnDisabled]}
                disabled={page <= 1}
                onPress={() => setPage((p) => Math.max(1, p - 1))}
                testID="admin-users-prev"
              >
                <Text style={styles.pagerTxt}>← Prev</Text>
              </TouchableOpacity>
              <Text style={styles.pagerPage}>{page} / {data.pages}</Text>
              <TouchableOpacity
                style={[styles.pagerBtn, page >= data.pages && styles.pagerBtnDisabled]}
                disabled={page >= data.pages}
                onPress={() => setPage((p) => p + 1)}
                testID="admin-users-next"
              >
                <Text style={styles.pagerTxt}>Next →</Text>
              </TouchableOpacity>
            </View>
          )}

          {(data?.items || []).length === 0 && (
            <View style={{ alignItems: 'center', marginTop: 40, gap: 8 }}>
              <ShieldAlert size={24} color={colors.textSecondary} />
              <Text style={{ color: colors.textSecondary, fontFamily: font.bodyMedium }}>No users match those filters.</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={{
      backgroundColor: color + '22', borderColor: color, borderWidth: 1,
      paddingHorizontal: 7, paddingVertical: 2, borderRadius: radii.pill,
    }}>
      <Text style={{ color, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  filterBar: { paddingHorizontal: space.xl, paddingTop: space.sm },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.md, paddingHorizontal: space.md, paddingVertical: 10,
  },
  searchInput: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 14 },
  chipsStrip: { paddingHorizontal: space.xl, paddingVertical: space.sm, gap: 6, alignItems: 'center' },
  chip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  chipTxtActive: { color: colors.textInverse, fontFamily: font.bodySemibold },
  totals: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.3, marginBottom: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: space.md, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  name: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },
  tiny: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: space.lg },
  pagerBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  pagerBtnDisabled: { opacity: 0.4 },
  pagerTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },
  pagerPage: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
});
