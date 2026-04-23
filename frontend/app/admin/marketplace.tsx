/**
 * Admin — Marketplace Moderation.
 * Path: /admin/marketplace
 *
 * Super Admin + Admin + Moderator can approve, deny, feature, suspend listings.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useFocusEffect } from 'expo-router';
import {
  ArrowLeft, Check, X, Star, ShieldAlert, Sparkles, Package, ExternalLink,
} from 'lucide-react-native';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';

function fmt(cents: number) { return `$${(cents / 100).toFixed(2)}`; }

export default function AdminMarketplace() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'pending' | 'active' | 'all'>('pending');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionSheet, setActionSheet] = useState<{ product: any; action: string } | null>(null);
  const [reason, setReason] = useState('');

  const canModerate = !!user && ['admin', 'super_admin', 'moderator'].includes(user.role);

  const load = useCallback(async () => {
    try {
      if (tab === 'pending') {
        const r = await api.get('/admin/marketplace/pending');
        setItems(r.items || []);
      } else {
        const r = await api.get('/marketplace/products', {
          sort: 'newest',
          limit: 60,
        });
        setItems(r.items || []);
      }
    } catch (e: any) {
      // ignore
    } finally { setLoading(false); setRefreshing(false); }
  }, [tab]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const doAction = async (product: any, action: string, reasonTxt?: string) => {
    try {
      await api.post(`/admin/marketplace/products/${product.product_id}/moderate`, {
        action,
        reason: reasonTxt || null,
      });
      setActionSheet(null);
      setReason('');
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Action failed.');
    }
  };

  if (!canModerate) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.empty}>
          <ShieldAlert size={32} color={colors.textTertiary} />
          <Text style={styles.emptyHead}>Admin access required</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.hBtn} hitSlop={10}>
          <ArrowLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Marketplace Moderation</Text>
          <Text style={styles.headerSub}>{items.length} in {tab}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/admin/marketplace-purchases' as any)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, marginRight: 6 }}>
          <Text style={{ color: colors.primary, fontFamily: font.bodyBold, fontSize: 11 }}>REFUNDS</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabRow}>
        {(['pending', 'active', 'all'] as const).map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>{t.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}><ActivityIndicator color={colors.primary} /></View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Package size={32} color={colors.textTertiary} />
          <Text style={styles.emptyHead}>Nothing to review</Text>
          <Text style={styles.emptySub}>When creators submit new products, they'll show up here.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          {items.map((p: any) => (
            <View key={p.product_id} style={styles.card}>
              <TouchableOpacity onPress={() => router.push(`/marketplace/${p.product_id}` as any)} style={{ flexDirection: 'row', gap: 10 }}>
                {p.thumbnail_url ? (
                  <Image source={{ uri: p.thumbnail_url }} style={styles.thumb} />
                ) : <View style={[styles.thumb, { backgroundColor: colors.surface2 }]} />}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.pType}>{(p.type || '').toUpperCase()}</Text>
                    {p.featured ? (
                      <View style={styles.featuredBadge}>
                        <Star size={10} color={colors.primary} fill={colors.primary} strokeWidth={0} />
                        <Text style={{ color: colors.primary, fontFamily: font.bodyBold, fontSize: 10 }}>FEATURED</Text>
                      </View>
                    ) : null}
                    <View style={[styles.statusBadge, statusStyle(p.status)]}>
                      <Text style={[styles.statusTxt, { color: statusStyle(p.status).borderColor }]}>{(p.status || '').toUpperCase()}</Text>
                    </View>
                  </View>
                  <Text style={styles.pTitle} numberOfLines={2}>{p.title}</Text>
                  <Text style={styles.pMeta}>
                    {fmt(p.price_cents)} · by {p.seller?.name || '—'}
                  </Text>
                  <Text style={styles.pDesc} numberOfLines={2}>{p.description}</Text>
                </View>
              </TouchableOpacity>

              <View style={styles.actionRow}>
                {p.status === 'pending' && (
                  <>
                    <TouchableOpacity style={[styles.actionBtn, styles.approveBtn]} onPress={() => doAction(p, 'approve')}>
                      <Check size={14} color={colors.textInverse} />
                      <Text style={styles.approveTxt}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, styles.denyBtn]} onPress={() => { setActionSheet({ product: p, action: 'deny' }); setReason(''); }}>
                      <X size={14} color={colors.secondary} />
                      <Text style={styles.denyTxt}>Deny</Text>
                    </TouchableOpacity>
                  </>
                )}
                {p.status === 'active' && (
                  <>
                    <TouchableOpacity style={[styles.actionBtn, styles.featureBtn]} onPress={() => doAction(p, p.featured ? 'unfeature' : 'feature')}>
                      <Sparkles size={14} color={colors.primary} />
                      <Text style={styles.featureTxt}>{p.featured ? 'Unfeature' : 'Feature'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, styles.denyBtn]} onPress={() => { setActionSheet({ product: p, action: 'suspend' }); setReason(''); }}>
                      <ShieldAlert size={14} color={colors.secondary} />
                      <Text style={styles.denyTxt}>Suspend</Text>
                    </TouchableOpacity>
                  </>
                )}
                {(p.status === 'suspended' || p.status === 'denied') && (
                  <TouchableOpacity style={[styles.actionBtn, styles.approveBtn]} onPress={() => doAction(p, p.status === 'suspended' ? 'unsuspend' : 'approve')}>
                    <Check size={14} color={colors.textInverse} />
                    <Text style={styles.approveTxt}>Reinstate</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[styles.actionBtn, styles.viewBtn]} onPress={() => router.push(`/marketplace/${p.product_id}` as any)}>
                  <ExternalLink size={14} color={colors.textSecondary} />
                  <Text style={styles.viewTxt}>View</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Reason modal */}
      <Modal visible={!!actionSheet} transparent animationType="slide" onRequestClose={() => setActionSheet(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{actionSheet?.action === 'deny' ? 'Deny listing' : 'Suspend listing'}</Text>
            <Text style={styles.modalSub}>{actionSheet?.product?.title}</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              multiline
              numberOfLines={4}
              placeholder="Reason (sent to seller)"
              placeholderTextColor={colors.textTertiary}
              style={styles.reasonInput}
            />
            <TouchableOpacity
              style={[styles.actionBtn, styles.denyBtn, { justifyContent: 'center', marginTop: 10 }]}
              onPress={() => doAction(actionSheet!.product, actionSheet!.action, reason)}
            >
              <Text style={[styles.denyTxt, { fontSize: 14 }]}>
                {actionSheet?.action === 'deny' ? 'Deny listing' : 'Suspend seller'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setActionSheet(null)} style={{ marginTop: 10, alignItems: 'center' }}>
              <Text style={{ color: colors.textTertiary, fontFamily: font.body, fontSize: 13 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function statusStyle(status: string) {
  switch (status) {
    case 'active':    return { backgroundColor: 'rgba(16,185,129,0.14)', borderColor: colors.success };
    case 'pending':   return { backgroundColor: 'rgba(251,191,36,0.14)', borderColor: colors.warning };
    case 'denied':    return { backgroundColor: 'rgba(208,72,72,0.14)',  borderColor: colors.secondary };
    case 'suspended': return { backgroundColor: 'rgba(208,72,72,0.14)',  borderColor: colors.secondary };
    default:          return { backgroundColor: 'rgba(113,113,122,0.14)', borderColor: colors.textTertiary };
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.sm, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  hBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 16 },
  headerSub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },

  tabRow: { flexDirection: 'row', paddingHorizontal: space.md, gap: 6, marginTop: 6 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.8 },
  tabTxtActive: { color: colors.textInverse },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: 8 },
  emptyHead: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  emptySub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center' },

  card: {
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.lg, padding: 12,
  },
  thumb: { width: 80, height: 80, borderRadius: radii.md },
  pType: { color: colors.textTertiary, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.8 },
  pTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14, marginTop: 4 },
  pMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 3 },
  pDesc: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 4, lineHeight: 15 },

  featuredBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(245,166,35,0.12)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.sm },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.sm, borderWidth: 1 },
  statusTxt: { fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.6 },

  actionRow: { flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  approveBtn: { backgroundColor: colors.success, borderColor: colors.success },
  approveTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 12 },
  denyBtn: { backgroundColor: 'transparent', borderColor: colors.secondary },
  denyTxt: { color: colors.secondary, fontFamily: font.bodyBold, fontSize: 12 },
  featureBtn: { backgroundColor: 'rgba(245,166,35,0.12)', borderColor: colors.primary },
  featureTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 12 },
  viewBtn: { backgroundColor: 'transparent', borderColor: colors.border },
  viewTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 12 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: {
    padding: space.xl, paddingBottom: 30,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderWidth: 1, borderColor: colors.border,
  },
  modalTitle: { color: colors.text, fontFamily: font.display, fontSize: 20 },
  modalSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, marginTop: 4, marginBottom: 12 },
  reasonInput: {
    minHeight: 90,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md, padding: 12,
    color: colors.text, fontFamily: font.body, fontSize: 13,
    textAlignVertical: 'top',
  },
});
