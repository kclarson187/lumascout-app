import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput } from 'react-native';
import { Search } from 'lucide-react-native';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';

export default function AdminAudit() {
  const [items, setItems] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 50 };
      if (filter.trim()) params.action = filter.trim();
      const r = await api.get('/admin/audit-logs', params);
      setItems(r.items);
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
            placeholder="Filter by action prefix (e.g. user.update)"
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
          contentContainerStyle={{ padding: space.xl, gap: 8, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
        >
          {items.length === 0 && <Text style={styles.empty}>No audit entries match.</Text>}
          {items.map((a) => (
            <View key={a.audit_id} style={styles.row}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.action}>{a.action}</Text>
                <Text style={styles.time}>{new Date(a.created_at).toLocaleString()}</Text>
              </View>
              <Text style={styles.who}>by {a.admin_email || a.admin_user_id} ({a.admin_role})</Text>
              {a.target_id && <Text style={styles.target}>target: {a.target_type}/{a.target_id}</Text>}
              {(a.before || a.after) && (
                <View style={styles.diffWrap}>
                  {a.before && <Text style={styles.diffBefore} numberOfLines={2}>before: {JSON.stringify(a.before)}</Text>}
                  {a.after  && <Text style={styles.diffAfter}  numberOfLines={2}>after:  {JSON.stringify(a.after)}</Text>}
                </View>
              )}
              {a.notes && <Text style={styles.notes}>“{a.notes}”</Text>}
            </View>
          ))}
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
  row: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: space.md, gap: 3 },
  action: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  time: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10 },
  who: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  target: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  diffWrap: { backgroundColor: colors.surface2, padding: 6, borderRadius: radii.sm, marginTop: 4, gap: 2 },
  diffBefore: { color: colors.secondary, fontFamily: font.body, fontSize: 10 },
  diffAfter:  { color: colors.success,   fontFamily: font.body, fontSize: 10 },
  notes: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, fontStyle: 'italic' },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: space.lg },
  pagerBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  pagerTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },
  pagerPage: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
});
