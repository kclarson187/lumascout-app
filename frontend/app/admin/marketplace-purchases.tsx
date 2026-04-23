/**
 * Admin — Marketplace Purchases (for refunds and oversight).
 * Path: /admin/marketplace-purchases
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Image, Modal, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useFocusEffect } from 'expo-router';
import { ArrowLeft, RotateCcw, ShoppingBag, AlertTriangle } from 'lucide-react-native';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';

function fmt(cents: number) { return `$${((cents || 0) / 100).toFixed(2)}`; }

export default function AdminPurchases() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'completed' | 'pending' | 'refunded'>('completed');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refundTarget, setRefundTarget] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const canRefund = !!user && ['admin', 'super_admin'].includes(user.role);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/admin/marketplace/purchases', { status: tab, limit: 80 });
      setItems(r.items || []);
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [tab]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const doRefund = async () => {
    if (!refundTarget) return;
    setBusy(true);
    try {
      await api.post(`/admin/marketplace/purchases/${refundTarget.purchase_id}/refund`, {
        reason: reason.trim() || null,
      });
      setRefundTarget(null); setReason('');
      await load();
      Alert.alert('Refunded', 'The buyer has been notified and their entitlement reversed.');
    } catch (e: any) {
      Alert.alert('Refund failed', e?.response?.data?.detail || 'Please try again.');
    } finally { setBusy(false); }
  };

  if (!canRefund) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.empty}>
          <AlertTriangle size={32} color={colors.textTertiary} />
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
          <Text style={styles.headerTitle}>Purchases & Refunds</Text>
          <Text style={styles.headerSub}>{items.length} in {tab}</Text>
        </View>
      </View>

      <View style={styles.tabRow}>
        {(['completed', 'pending', 'refunded'] as const).map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>{t.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}><ActivityIndicator color={colors.primary} /></View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <ShoppingBag size={32} color={colors.textTertiary} />
          <Text style={styles.emptyHead}>No {tab} purchases</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          {items.map((row: any) => (
            <View key={row.purchase_id} style={styles.card}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {row.product?.thumbnail_url ? (
                  <Image source={{ uri: row.product.thumbnail_url }} style={styles.thumb} />
                ) : <View style={[styles.thumb, { backgroundColor: colors.surface2 }]} />}
                <View style={{ flex: 1 }}>
                  <Text style={styles.pTitle} numberOfLines={2}>{row.product?.title || '—'}</Text>
                  <Text style={styles.pMeta}>
                    {fmt(row.price_cents)} · fee {fmt(row.platform_fee_cents)} · payout {fmt(row.seller_payout_cents)}
                  </Text>
                  <Text style={styles.pBuyer}>Buyer: {row.buyer?.name || '—'}</Text>
                  <Text style={styles.pBuyer}>Seller: {row.seller?.name || '—'}</Text>
                  <Text style={styles.pDate}>{row.created_at ? new Date(row.created_at).toLocaleString() : ''}</Text>
                  {row.mocked ? <Text style={styles.mockLbl}>MOCK</Text> : null}
                </View>
              </View>
              {tab === 'completed' && (
                <TouchableOpacity style={styles.refundBtn} onPress={() => { setRefundTarget(row); setReason(''); }}>
                  <RotateCcw size={14} color={colors.secondary} />
                  <Text style={styles.refundTxt}>Issue refund</Text>
                </TouchableOpacity>
              )}
              {row.status === 'refunded' && row.refund_reason ? (
                <View style={styles.refundedNote}>
                  <Text style={styles.refundedTxt}>Refunded: {row.refund_reason}</Text>
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={!!refundTarget} transparent animationType="slide" onRequestClose={() => setRefundTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Refund purchase</Text>
            <Text style={styles.modalSub}>
              {refundTarget?.product?.title} · {fmt(refundTarget?.price_cents || 0)}
            </Text>
            <Text style={styles.warnTxt}>
              Refunds the buyer in full, reverses the transfer from the seller's
              Connect balance, and refunds the platform fee. This cannot be undone.
            </Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              multiline
              numberOfLines={3}
              placeholder="Reason (shown to buyer)"
              placeholderTextColor={colors.textTertiary}
              style={styles.reasonInput}
            />
            <TouchableOpacity
              style={styles.refundBtnBig}
              onPress={doRefund}
              disabled={busy}
            >
              {busy ? <ActivityIndicator color={colors.textInverse} /> : (
                <>
                  <RotateCcw size={14} color={colors.textInverse} />
                  <Text style={styles.refundBtnBigTxt}>Refund {fmt(refundTarget?.price_cents || 0)}</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setRefundTarget(null)} style={{ marginTop: 10, alignItems: 'center' }}>
              <Text style={{ color: colors.textTertiary, fontFamily: font.body, fontSize: 13 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
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

  card: { backgroundColor: colors.surface1, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: 12 },
  thumb: { width: 70, height: 70, borderRadius: radii.md },
  pTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  pMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 3 },
  pBuyer: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  pDate: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10, marginTop: 4 },
  mockLbl: { color: colors.warning, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 1, marginTop: 3 },

  refundBtn: {
    marginTop: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 9, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.secondary,
  },
  refundTxt: { color: colors.secondary, fontFamily: font.bodyBold, fontSize: 12 },

  refundedNote: { marginTop: 10, padding: 8, backgroundColor: 'rgba(208,72,72,0.08)', borderRadius: radii.sm },
  refundedTxt: { color: colors.secondary, fontFamily: font.body, fontSize: 11 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: {
    padding: space.xl, paddingBottom: 30,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderWidth: 1, borderColor: colors.border,
  },
  modalTitle: { color: colors.text, fontFamily: font.display, fontSize: 20 },
  modalSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, marginTop: 4 },
  warnTxt: { color: colors.textTertiary, fontFamily: font.body, fontSize: 12, marginTop: 10, marginBottom: 12, lineHeight: 17 },
  reasonInput: {
    minHeight: 70,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md, padding: 10,
    color: colors.text, fontFamily: font.body, fontSize: 13,
    textAlignVertical: 'top',
  },
  refundBtnBig: {
    marginTop: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, borderRadius: radii.md,
    backgroundColor: colors.secondary,
  },
  refundBtnBigTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },
});
