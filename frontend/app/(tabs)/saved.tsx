import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Image,
  Modal,
  Alert,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { FolderPlus, Bookmark, Lock, X } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import SpotCard from '../../src/components/SpotCard';
import { EmptyState, Chip } from '../../src/components/ui';
import { Button } from '../../src/components/Button';

export default function Saved() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'favorites' | 'collections' | 'private'>('favorites');
  const [savedSpots, setSavedSpots] = useState<any[]>([]);
  const [privateSpots, setPrivateSpots] = useState<any[]>([]);
  const [collections, setCollections] = useState<any[]>([]);
  const [showNewCol, setShowNewCol] = useState(false);
  const [newColName, setNewColName] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [saves, mine, cols] = await Promise.all([
        api.get('/me/saved'),
        api.get('/me/spots'),
        api.get('/me/collections'),
      ]);
      setSavedSpots(saves);
      setPrivateSpots(mine.filter((s: any) => s.privacy_mode !== 'public' && s.privacy_mode !== 'premium'));
      setCollections(cols);
    } catch {}
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <EmptyState
          title="Sign in to save"
          subtitle="Favorite spots, build collections, and keep private locations just for you."
          action={<Button title="Sign in" onPress={() => router.push('/(auth)/login')} />}
        />
      </SafeAreaView>
    );
  }

  const createCollection = async () => {
    if (!newColName.trim()) return;
    try {
      await api.post('/collections', { name: newColName.trim(), privacy_mode: 'private' });
      setNewColName('');
      setShowNewCol(false);
      load();
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.head}>
        <Text style={styles.title}>Saved</Text>
        {user.plan && user.plan !== 'free' ? null : (
          <View style={styles.planPill}><Text style={styles.planPillTxt}>FREE</Text></View>
        )}
      </View>
      {user.plan === 'free' && user.limits && user.usage && (
        <TouchableOpacity onPress={() => router.push('/paywall')} style={styles.usageBanner} testID="saved-usage-banner">
          <Text style={styles.usageTxt}>
            {user.usage.saves}/{user.limits.saves} saves · {user.usage.private_spots}/{user.limits.private_spots} private · {user.usage.collections}/{user.limits.collections} collections
          </Text>
          <Text style={styles.usageCta}>Upgrade →</Text>
        </TouchableOpacity>
      )}
      <View style={styles.tabs}>
        {[
          { k: 'favorites', l: 'Favorites', icon: <Bookmark size={14} color={tab === 'favorites' ? colors.textInverse : colors.text} /> },
          { k: 'collections', l: 'Collections', icon: <FolderPlus size={14} color={tab === 'collections' ? colors.textInverse : colors.text} /> },
          { k: 'private', l: 'Private', icon: <Lock size={14} color={tab === 'private' ? colors.textInverse : colors.text} /> },
        ].map((t) => (
          <TouchableOpacity
            key={t.k}
            testID={`saved-tab-${t.k}`}
            style={[styles.tab, tab === t.k && styles.tabActive]}
            onPress={() => setTab(t.k as any)}
          >
            {t.icon}
            <Text style={[styles.tabText, tab === t.k && { color: colors.textInverse }]}>{t.l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'favorites' && (
        savedSpots.length === 0 ? (
          <EmptyState title="Nothing saved yet" subtitle="Tap the bookmark on any spot to save it here." />
        ) : (
          <FlatList
            data={savedSpots}
            keyExtractor={(i) => i.spot_id}
            contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 100 }}
            renderItem={({ item }) => <SpotCard spot={item} width={undefined as any} onToggleSave={load} />}
          />
        )
      )}

      {tab === 'private' && (
        privateSpots.length === 0 ? (
          <EmptyState
            title="No private spots"
            subtitle="Log secret locations that stay just for you."
            action={<Button title="Add private spot" onPress={() => router.push('/(tabs)/add')} />}
          />
        ) : (
          <FlatList
            data={privateSpots}
            keyExtractor={(i) => i.spot_id}
            contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 100 }}
            renderItem={({ item }) => <SpotCard spot={item} width={undefined as any} />}
          />
        )
      )}

      {tab === 'collections' && (
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 100 }}>
          <Button title="New collection" variant="secondary" icon={<FolderPlus size={18} color={colors.text} />} onPress={() => setShowNewCol(true)} testID="saved-new-collection" />
          {collections.length === 0 ? (
            <EmptyState title="No collections yet" subtitle="Group spots into collections like 'Family Sessions' or 'Golden Hour Fields'." />
          ) : (
            collections.map((c) => (
              <TouchableOpacity
                key={c.collection_id}
                style={styles.colCard}
                onPress={() => router.push(`/collection/${c.collection_id}`)}
                testID={`collection-${c.collection_id}`}
              >
                <View style={styles.colGrid}>
                  {(c.previews || []).slice(0, 4).map((url: string, i: number) => (
                    <Image key={i} source={{ uri: url }} style={styles.colThumb} />
                  ))}
                  {(c.previews || []).length === 0 && (
                    <View style={[styles.colThumb, { backgroundColor: colors.surface2 }]} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontFamily: font.display, fontSize: 18 }}>{c.name}</Text>
                  <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 4 }}>
                    {c.count} spot{c.count === 1 ? '' : 's'} · {c.privacy_mode}
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}

      <Modal transparent visible={showNewCol} animationType="fade" onRequestClose={() => setShowNewCol(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontFamily: font.display, fontSize: 22 }}>New collection</Text>
              <TouchableOpacity onPress={() => setShowNewCol(false)}><X size={20} color={colors.text} /></TouchableOpacity>
            </View>
            <TextInput
              placeholder="Collection name"
              placeholderTextColor={colors.textTertiary}
              value={newColName}
              onChangeText={setNewColName}
              style={styles.input}
              testID="collection-name-input"
              autoFocus
            />
            <Button title="Create" onPress={createCollection} testID="collection-create" />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  head: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 34, letterSpacing: -0.5 },
  planPill: {
    backgroundColor: colors.surface2, paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: radii.pill, borderColor: colors.border, borderWidth: 1, marginBottom: 6,
  },
  planPillTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.6 },
  usageBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginHorizontal: space.xl, marginBottom: space.md,
    padding: space.md, backgroundColor: colors.surface1,
    borderColor: colors.primary, borderWidth: 1, borderRadius: radii.md,
  },
  usageTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12, flex: 1 },
  usageCta: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 12 },
  tabs: {
    flexDirection: 'row', paddingHorizontal: space.xl, gap: 8, marginBottom: space.md,
  },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 13 },
  colCard: {
    flexDirection: 'row', gap: 12, alignItems: 'center',
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.lg, padding: space.md,
  },
  colGrid: { width: 80, height: 80, flexDirection: 'row', flexWrap: 'wrap', gap: 2, borderRadius: radii.md, overflow: 'hidden' },
  colThumb: { width: 39, height: 39, borderRadius: 4, backgroundColor: colors.surface2 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  modalCard: { width: '100%', backgroundColor: colors.surface1, borderRadius: radii.lg, padding: space.xl, gap: space.md, borderWidth: 1, borderColor: colors.border },
  input: {
    backgroundColor: colors.surface2, color: colors.text, fontFamily: font.body,
    paddingHorizontal: space.lg, paddingVertical: 14, borderRadius: radii.md, fontSize: 15,
  },
});
