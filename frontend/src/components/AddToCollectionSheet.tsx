import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Alert, TextInput } from 'react-native';
import { X, FolderPlus, Check, Plus } from 'lucide-react-native';
import { api, formatApiError } from '../api';
import { colors, font, space, radii } from '../theme';
import { Button } from './Button';

export default function AddToCollectionSheet({
  visible,
  onClose,
  spotId,
}: {
  visible: boolean;
  onClose: () => void;
  spotId: string;
}) {
  const [collections, setCollections] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const c = await api.get('/me/collections');
      setCollections(c);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (visible) load(); }, [visible]);

  const toggle = async (collectionId: string) => {
    try {
      await api.post(`/collections/${collectionId}/spots`, { spot_id: spotId });
      load();
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
    }
  };

  const createAndAdd = async () => {
    if (!newName.trim()) return;
    try {
      const col = await api.post('/collections', { name: newName.trim(), privacy_mode: 'private' });
      await api.post(`/collections/${col.collection_id}/spots`, { spot_id: spotId });
      setNewName('');
      setCreating(false);
      load();
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
    }
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.bg}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={styles.title}>Add to collection</Text>
            <TouchableOpacity onPress={onClose} testID="atc-close"><X size={22} color={colors.text} /></TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ padding: space.xl, gap: space.sm }}>
            {collections.length === 0 && !loading && (
              <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center', paddingVertical: space.xl }}>
                No collections yet. Create your first below.
              </Text>
            )}
            {collections.map((c) => {
              const isInColl = (c.spot_ids || []).includes(spotId);
              return (
                <TouchableOpacity
                  key={c.collection_id}
                  style={[styles.row, isInColl && { borderColor: colors.primary }]}
                  onPress={() => toggle(c.collection_id)}
                  testID={`atc-collection-${c.collection_id}`}
                >
                  <View style={styles.rowIcon}>
                    <FolderPlus size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{c.name}</Text>
                    <Text style={styles.rowSub}>{c.count || 0} spots · {c.privacy_mode}</Text>
                  </View>
                  {isInColl && <Check size={18} color={colors.primary} />}
                </TouchableOpacity>
              );
            })}

            {creating ? (
              <View style={styles.createCard}>
                <TextInput
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Collection name"
                  placeholderTextColor={colors.textTertiary}
                  style={styles.input}
                  autoFocus
                  testID="atc-new-name"
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button title="Cancel" variant="ghost" onPress={() => { setCreating(false); setNewName(''); }} style={{ flex: 1 }} />
                  <Button title="Create & add" onPress={createAndAdd} style={{ flex: 2 }} testID="atc-new-create" />
                </View>
              </View>
            ) : (
              <TouchableOpacity style={styles.newBtn} onPress={() => setCreating(true)} testID="atc-new">
                <Plus size={18} color={colors.primary} />
                <Text style={styles.newTxt}>New collection</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface1, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.surface3, alignSelf: 'center', marginTop: 10 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.sm },
  title: { color: colors.text, fontFamily: font.display, fontSize: 24 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: space.md, borderRadius: radii.md,
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
  },
  rowIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  rowSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: space.md,
    borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
  },
  newTxt: { color: colors.primary, fontFamily: font.bodySemibold, fontSize: 14 },
  createCard: { gap: 10, padding: space.md, backgroundColor: colors.surface2, borderRadius: radii.md },
  input: {
    backgroundColor: colors.surface1, color: colors.text, fontFamily: font.body,
    paddingHorizontal: space.md, paddingVertical: 12, borderRadius: radii.md, fontSize: 15,
    borderWidth: 1, borderColor: colors.border,
  },
});
