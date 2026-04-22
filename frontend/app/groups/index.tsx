import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, RefreshControl, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, Plus, Users, MapPin, Search, X } from 'lucide-react-native';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import { EmptyState } from '../../src/components/ui';

export default function GroupsIndex() {
  const [tab, setTab] = useState<'discover' | 'mine'>('discover');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const params: any = {};
      if (tab === 'mine') params.mine = true;
      if (query.trim()) params.q = query.trim();
      const r = await api.get('/groups', params);
      setItems(r?.items || []);
    } finally { setLoading(false); setRefreshing(false); }
  }, [tab, query]);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="groups-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>CHAPTERS</Text>
          <Text style={styles.title}>Local groups</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/groups/create')} style={styles.addBtn} testID="groups-create">
          <Plus size={18} color={colors.textInverse} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabs}>
        {(['discover', 'mine'] as const).map((t) => (
          <TouchableOpacity key={t} onPress={() => { setLoading(true); setTab(t); }} style={[styles.tabBtn, tab === t && styles.tabBtnActive]} testID={`groups-tab-${t}`}>
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>
              {t === 'discover' ? 'Discover' : 'My groups'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'discover' && (
        <View style={styles.searchWrap}>
          <Search size={15} color={colors.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={load}
            placeholder="Search group name…"
            placeholderTextColor={colors.textTertiary}
            style={styles.searchInput}
            testID="groups-search"
          />
          {!!query && <TouchableOpacity onPress={() => { setQuery(''); setTimeout(load, 50); }}><X size={15} color={colors.textSecondary} /></TouchableOpacity>}
        </View>
      )}

      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Users size={28} color={colors.primary} />}
            title={tab === 'mine' ? 'No groups joined yet' : 'No groups here yet'}
            body={tab === 'mine' ? 'Discover local chapters, or start your own.' : 'Be the first to start a chapter in your city.'}
          />
        ) : (
          items.map((g) => (
            <TouchableOpacity key={g.group_id} style={styles.card} activeOpacity={0.85} onPress={() => router.push(`/groups/${g.group_id}`)} testID={`group-${g.group_id}`}>
              {g.cover_image_url && (
                <Image source={{ uri: g.cover_image_url }} style={styles.cover} />
              )}
              <View style={{ padding: space.md, gap: 6 }}>
                <Text style={styles.name}>{g.name}</Text>
                {!!g.tagline && <Text style={styles.tagline} numberOfLines={2}>{g.tagline}</Text>}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {!!g.city && (
                    <View style={styles.metaPill}>
                      <MapPin size={11} color={colors.textSecondary} />
                      <Text style={styles.metaTxt}>{g.city}{g.state ? `, ${g.state}` : ''}</Text>
                    </View>
                  )}
                  <View style={styles.metaPill}>
                    <Users size={11} color={colors.textSecondary} />
                    <Text style={styles.metaTxt}>{g.member_count} member{g.member_count === 1 ? '' : 's'}</Text>
                  </View>
                  {g.is_member && <View style={styles.joinedPill}><Text style={styles.joinedTxt}>MEMBER</Text></View>}
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  kicker: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.8 },
  title: { color: colors.text, fontFamily: font.display, fontSize: 28, letterSpacing: -0.3 },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', paddingHorizontal: space.xl, gap: 8, marginBottom: space.md },
  tabBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  tabBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 12 },
  tabTxtActive: { color: colors.textInverse },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: space.xl, marginBottom: space.md, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md },
  searchInput: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 14, padding: 0 },
  card: { backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, overflow: 'hidden' },
  cover: { width: '100%', aspectRatio: 16 / 7 },
  name: { color: colors.text, fontFamily: font.display, fontSize: 19, letterSpacing: -0.2 },
  tagline: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 19 },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.surface2, borderRadius: radii.pill },
  metaTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  joinedPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill, backgroundColor: colors.success, marginLeft: 'auto' },
  joinedTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.4 },
});
