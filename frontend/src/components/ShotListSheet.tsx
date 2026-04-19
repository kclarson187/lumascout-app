import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Wand2, RefreshCw, Sparkles } from 'lucide-react-native';
import { api, formatApiError } from '../api';
import { colors, font, space, radii } from '../theme';

export default function ShotListSheet({
  visible,
  spotId,
  spotTitle,
  onClose,
}: {
  visible: boolean;
  spotId: string;
  spotTitle?: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<string[]>([]);
  const [cached, setCached] = useState(false);

  const load = async (refresh = false) => {
    if (!spotId) return;
    setLoading(true);
    try {
      const res = await api.post(`/spots/${spotId}/shot-list${refresh ? '?refresh=true' : ''}`);
      setItems(res.items || []);
      setCached(!!res.cached);
    } catch (e) {
      Alert.alert('Could not generate shot list', formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      setItems([]);
      load(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, spotId]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.head}>
            <View style={styles.titleWrap}>
              <View style={styles.iconBubble}><Wand2 size={16} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>AI shot list</Text>
                {!!spotTitle && <Text style={styles.subtitle} numberOfLines={1}>{spotTitle}</Text>}
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} testID="shotlist-close">
              <X size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.xl, paddingTop: 0, gap: space.sm }}>
            {loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.loadingTxt}>Generating composition ideas…</Text>
                <Text style={styles.loadingHint}>This usually takes 3–6 seconds.</Text>
              </View>
            ) : items.length === 0 ? (
              <Text style={styles.empty}>No shot ideas yet. Try tapping refresh below.</Text>
            ) : (
              items.map((line, i) => (
                <View key={i} style={styles.row}>
                  <View style={styles.dot}>
                    <Text style={styles.dotTxt}>{i + 1}</Text>
                  </View>
                  <Text style={styles.lineTxt}>{line}</Text>
                </View>
              ))
            )}
          </ScrollView>

          <View style={styles.footer}>
            {cached && !loading && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Sparkles size={11} color={colors.textSecondary} />
                <Text style={styles.cachedTxt}>Cached — tap refresh for new ideas</Text>
              </View>
            )}
            <TouchableOpacity
              onPress={() => load(true)}
              disabled={loading}
              style={[styles.refreshBtn, loading && { opacity: 0.5 }]}
              testID="shotlist-refresh"
            >
              <RefreshCw size={14} color={colors.textInverse} />
              <Text style={styles.refreshTxt}>Generate new</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, maxHeight: '85%' },

  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.md, gap: 12,
  },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  iconBubble: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.3 },
  subtitle: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12, marginTop: 1 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },

  loadingWrap: { alignItems: 'center', paddingVertical: space.xxxl, gap: 10 },
  loadingTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14, marginTop: 4 },
  loadingHint: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },

  empty: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, textAlign: 'center', paddingVertical: 40 },

  row: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    padding: space.md, backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1, borderRadius: radii.md,
  },
  dot: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  dotTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 11 },
  lineTxt: { color: colors.text, fontFamily: font.body, fontSize: 14, lineHeight: 20, flex: 1 },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.xl, paddingVertical: space.md, borderTopWidth: 1,
    borderTopColor: colors.border, gap: 12,
  },
  cachedTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  refreshBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.primary, borderRadius: radii.pill,
    marginLeft: 'auto',
  },
  refreshTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 12 },
});
