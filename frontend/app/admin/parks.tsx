/**
 * Admin Parks list — Phase 5 of the Park-Based Multi-Spot Workflow.
 *
 * Lists every parent park with admin tools per row:
 *   • Edit — opens /admin/parks/[id]/edit (name, address, general notes)
 *   • Merge — pick a target park, absorbs all children into it
 *   • Delete — soft-delete (blocked if the park has children)
 *
 * Merged-into parks are shown dimmed so admins can audit them, but
 * actions are disabled (the canonical record is the merge target).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Layers, Search, Pencil, GitMerge, Trash2, AlertTriangle, X,
} from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import ParkPickerSheet, { ParkSummary } from '../../src/components/ParkPickerSheet';
import { colors, font, space, radii } from '../../src/theme';

type Park = {
  park_id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  child_spot_count?: number;
  status?: string;
  merged_into_park_id?: string | null;
  latitude?: number;
  longitude?: number;
  created_at?: string;
};

export default function AdminParksScreen() {
  const [items, setItems] = useState<Park[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mergeSource, setMergeSource] = useState<Park | null>(null);

  const load = useCallback(async (search?: string) => {
    try {
      const params: any = { limit: 200 };
      if (search && search.trim()) params.q = search.trim();
      const r = await api.get('/admin/parks', params);
      setItems((r?.items as Park[]) || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  const confirmMergeWith = async (target: ParkSummary) => {
    if (!mergeSource) return;
    if (target.park_id === mergeSource.park_id) {
      Alert.alert('Pick a different park', 'Choose a different park as the merge target.');
      return;
    }
    Alert.alert(
      'Merge parks?',
      `Absorb "${mergeSource.name}" into "${target.name}"?\n\nAll child spots and saves will be moved. This cannot be undone automatically.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Merge',
          style: 'destructive',
          onPress: async () => {
            setBusyId(mergeSource.park_id);
            try {
              const r = await api.post(`/admin/parks/${mergeSource.park_id}/merge`, {
                target_park_id: target.park_id,
              });
              Alert.alert(
                'Merged',
                `Moved ${r.moved_spots ?? 0} spot(s) and ${r.moved_saves ?? 0} save(s) into "${target.name}".`,
              );
              await load(q);
            } catch (e) {
              Alert.alert('Merge failed', formatApiError(e));
            } finally {
              setBusyId(null);
              setMergeSource(null);
            }
          },
        },
      ],
    );
  };

  const onDelete = async (p: Park) => {
    Alert.alert(
      'Delete park?',
      `"${p.name}" will be hidden. If it still has child spots the server will refuse.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusyId(p.park_id);
            try {
              await api.delete(`/admin/parks/${p.park_id}`);
              await load(q);
            } catch (e) {
              Alert.alert('Could not delete', formatApiError(e));
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.searchWrap}>
        <Search size={15} color={colors.textTertiary} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search by name, city, address…"
          placeholderTextColor={colors.textTertiary}
          style={styles.searchInput}
        />
        {q.length > 0 && (
          <TouchableOpacity onPress={() => setQ('')} hitSlop={8}>
            <X size={13} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space.lg, paddingBottom: 80, gap: 8 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(q); }} tintColor={colors.primary} />}
        >
          {items.length === 0 ? (
            <Text style={styles.empty}>No parks{q ? ` matching "${q}"` : ''} yet.</Text>
          ) : (
            items.map((p) => {
              const isMerged = p.status === 'merged_into';
              const isHidden = p.status === 'hidden';
              const muted = isMerged || isHidden;
              return (
                <View
                  key={p.park_id}
                  style={[styles.row, muted && { opacity: 0.55 }]}
                  testID={`admin-park-row-${p.park_id}`}
                >
                  <TouchableOpacity
                    style={styles.rowMain}
                    onPress={() => router.push(`/admin/parks/${p.park_id}/edit` as any)}
                    activeOpacity={0.7}
                    disabled={muted}
                  >
                    <View style={styles.rowIcon}>
                      <Layers size={15} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{p.name}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {[p.city, p.state].filter(Boolean).join(', ') || '—'}
                        {' · '}{p.child_spot_count ?? 0} spot{(p.child_spot_count ?? 0) === 1 ? '' : 's'}
                        {isMerged ? ' · merged' : isHidden ? ' · hidden' : ''}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  {!muted && (
                    <View style={styles.actions}>
                      <TouchableOpacity
                        style={styles.actBtn}
                        onPress={() => router.push(`/admin/parks/${p.park_id}/edit` as any)}
                        testID={`admin-park-edit-${p.park_id}`}
                      >
                        <Pencil size={13} color={colors.text} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.actBtn}
                        onPress={() => setMergeSource(p)}
                        testID={`admin-park-merge-${p.park_id}`}
                      >
                        <GitMerge size={13} color={colors.warning} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.actBtn}
                        onPress={() => onDelete(p)}
                        testID={`admin-park-delete-${p.park_id}`}
                        disabled={busyId === p.park_id}
                      >
                        <Trash2 size={13} color={colors.secondary} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* Merge target picker — re-uses ParkPickerSheet's search UI. */}
      <ParkPickerSheet
        visible={!!mergeSource}
        onClose={() => setMergeSource(null)}
        onPick={confirmMergeWith}
        nearLat={mergeSource?.latitude ?? null}
        nearLng={mergeSource?.longitude ?? null}
        defaultCity={mergeSource?.city || ''}
        defaultState={mergeSource?.state || ''}
        initialQuery={mergeSource?.name?.split(' ')[0] || ''}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: space.lg, marginTop: 10,
    padding: 10, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 13 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: 10, borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(245,166,35,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },
  rowMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 4 },
  actBtn: {
    width: 32, height: 32, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.sm,
    backgroundColor: colors.surface2,
  },
  empty: { color: colors.textTertiary, fontFamily: font.body, fontSize: 13, textAlign: 'center', marginTop: 24 },
});
