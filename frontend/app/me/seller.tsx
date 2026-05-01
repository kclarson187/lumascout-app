/**
 * Seller Dashboard — sales, revenue, product list.
 * Path: /me/seller
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useFocusEffect } from 'expo-router';
import {
  ArrowLeft, Plus, Briefcase, TrendingUp, DollarSign, Eye, ShoppingCart,
  Edit3, Package, Info, ExternalLink, CheckCircle2, AlertCircle, Zap,
} from 'lucide-react-native';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';

function fmt(cents: number) { return `$${(cents / 100).toFixed(2)}`; }

export default function SellerDashboard() {
  const [data, setData] = useState<any>(null);
  const [connect, setConnect] = useState<any>(null);
  const [payouts, setPayouts] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, c, p] = await Promise.all([
        api.get('/me/marketplace/sales', { since_days: 90 }),
        api.get('/me/seller/connect-status').catch(() => null),
        api.get('/me/seller/payouts').catch(() => null),
      ]);
      setData(r); setConnect(c); setPayouts(p);
    } catch (e: any) {
      if (e?.response?.status !== 401) {
        // ignore
      }
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onConnectStripe = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      const r = await api.post('/me/seller/onboard', {});
      if (r.url) {
        const WebBrowser = await import('expo-web-browser');
        await WebBrowser.openBrowserAsync(r.url);
        // Refresh after return
        setTimeout(load, 1500);
      }
    } catch (e: any) {
      Alert.alert('Could not start onboarding', e?.response?.data?.detail || 'Please try again.');
    } finally { setConnecting(false); }
  };

  const onOpenStripeDashboard = async () => {
    try {
      const r = await api.post('/me/seller/dashboard-link', {});
      if (r.url) {
        const WebBrowser = await import('expo-web-browser');
        await WebBrowser.openBrowserAsync(r.url);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Could not open Stripe dashboard.');
    }
  };

  if (loading || !data) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.loadingWrap}><ActivityIndicator color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  const products = data.products || [];
  const active = products.filter((p: any) => p.status === 'active').length;
  const pending = products.filter((p: any) => p.status === 'pending').length;
  const totalViews = products.reduce((s: number, p: any) => s + (p.view_count || 0), 0);
  const conversion = totalViews > 0 ? ((data.total_sales / totalViews) * 100).toFixed(1) : '0.0';

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.hBtn} hitSlop={10}>
          <ArrowLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Seller Dashboard</Text>
          <Text style={styles.headerSub}>Last {data.since_days || 90} days</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/marketplace/new' as any)} style={styles.addBtn}>
          <Plus size={14} color={colors.textInverse} />
          <Text style={styles.addTxt}>New</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        {/* Earnings hero */}
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Net earnings</Text>
          <Text style={styles.heroValue}>{fmt(data.net_cents || 0)}</Text>
          <View style={{ flexDirection: 'row', gap: space.md, marginTop: 8 }}>
            <View style={styles.heroBadge}>
              <TrendingUp size={11} color={colors.primary} />
              <Text style={styles.heroBadgeTxt}>{data.total_sales} sale{data.total_sales === 1 ? '' : 's'}</Text>
            </View>
            <View style={styles.heroBadge}>
              <DollarSign size={11} color={colors.success} />
              <Text style={styles.heroBadgeTxt}>Gross {fmt(data.gross_cents || 0)}</Text>
            </View>
          </View>
          <View style={styles.feeRow}>
            <Info size={11} color={colors.textTertiary} />
            <Text style={styles.feeTxt}>
              Platform fee {data.platform_fee_pct || 15}% · paid {fmt(data.platform_fee_cents || 0)} to platform
            </Text>
          </View>
        </View>

        {/* KPI row */}
        <View style={styles.kpiRow}>
          <Kpi label="Active listings" value={active.toString()} />
          <Kpi label="Pending review" value={pending.toString()} />
          <Kpi label="Total views" value={totalViews.toString()} />
          <Kpi label="Conversion" value={`${conversion}%`} />
        </View>

        {/* Connect / Payout status */}
        <ConnectPayoutCard
          connect={connect}
          payouts={payouts}
          net_cents={data.net_cents || 0}
          connecting={connecting}
          onConnect={onConnectStripe}
          onOpenDashboard={onOpenStripeDashboard}
        />

        {/* Products list */}
        <View style={{ paddingHorizontal: space.md, marginTop: space.xl }}>
          <Text style={styles.sectionHead}>Your products ({products.length})</Text>
          {products.length === 0 ? (
            <View style={styles.empty}>
              <Briefcase size={36} color={colors.textTertiary} />
              <Text style={styles.emptyHead}>No products yet</Text>
              <Text style={styles.emptySub}>List your first pack to start earning.</Text>
              <TouchableOpacity style={styles.emptyCta} onPress={() => router.push('/marketplace/new' as any)}>
                <Plus size={14} color={colors.textInverse} />
                <Text style={styles.emptyCtaTxt}>List a product</Text>
              </TouchableOpacity>
            </View>
          ) : (
            products.map((p: any) => (
              <View key={p.product_id} style={styles.productRow}>
                <TouchableOpacity style={{ flexDirection: 'row', gap: 10, flex: 1 }} onPress={() => router.push(`/marketplace/${p.product_id}` as any)}>
                  {p.thumbnail_url ? (
                    <Image source={{ uri: p.thumbnail_url }} style={styles.productThumb} />
                  ) : <View style={[styles.productThumb, { backgroundColor: colors.surface2 }]} />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.productTitle} numberOfLines={2}>{p.title}</Text>
                    <View style={styles.productMeta}>
                      <StatusChip status={p.status} />
                      <View style={styles.productKpi}>
                        <Eye size={10} color={colors.textTertiary} />
                        <Text style={styles.productKpiTxt}>{p.view_count}</Text>
                      </View>
                      <View style={styles.productKpi}>
                        <ShoppingCart size={10} color={colors.textTertiary} />
                        <Text style={styles.productKpiTxt}>{p.sales}</Text>
                      </View>
                    </View>
                    <Text style={styles.productRevenue}>{fmt(p.revenue_cents || 0)} earned</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={styles.editBtn} onPress={() => router.push(`/marketplace/edit/${p.product_id}` as any)} hitSlop={10}>
                  <Edit3 size={14} color={colors.primary} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ConnectPayoutCard({
  connect, payouts, net_cents, connecting, onConnect, onOpenDashboard,
}: {
  connect: any; payouts: any; net_cents: number; connecting: boolean;
  onConnect: () => void; onOpenDashboard: () => void;
}) {
  const status = connect?.status || 'disconnected';
  const active = status === 'active';
  const onboarding = status === 'onboarding';
  const restricted = status === 'restricted';

  // Batch #6 — seller onboarding can be gated off at the API layer via the
  // MARKETPLACE_SELLER_ENABLED env flag. Until Stripe Connect is enabled on
  // LumaScout's Stripe account, every tap on "Connect Stripe" hits a
  // dead-end; this branch replaces that broken CTA with a tasteful
  // "Coming soon" card so users see intentional product copy instead of
  // a generic Stripe error.
  if (connect && connect.seller_onboarding_enabled === false) {
    return (
      <View style={[styles.connectCard, { borderColor: 'rgba(245,166,35,0.35)' }]}>
        <View style={styles.connectRow}>
          <View style={styles.stripeIconWrap}>
            <Zap size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.connectHead}>Creator payouts — coming soon</Text>
            <Text style={styles.connectSub}>
              {connect.seller_onboarding_disabled_reason ||
                "We're finalizing our payouts infrastructure. As soon as sellers in your country can onboard, we'll email you directly."}
            </Text>
          </View>
        </View>
        <Text style={styles.connectFoot}>
          Buyers can still browse and purchase packs from existing approved creators today.
        </Text>
      </View>
    );
  }

  if (!connect || status === 'disconnected') {
    return (
      <View style={styles.connectCard}>
        <View style={styles.connectRow}>
          <View style={styles.stripeIconWrap}>
            <Zap size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.connectHead}>Get paid with Stripe</Text>
            <Text style={styles.connectSub}>
              Connect your Stripe account to receive 85% of every sale, paid weekly
              to your bank. Takes ~2 minutes.
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.connectBtn} onPress={onConnect} disabled={connecting}>
          {connecting ? <ActivityIndicator color={colors.textInverse} /> : (
            <>
              <ExternalLink size={14} color={colors.textInverse} />
              <Text style={styles.connectBtnTxt}>Connect Stripe</Text>
            </>
          )}
        </TouchableOpacity>
        <Text style={styles.connectFoot}>Powered by Stripe Express. US sellers only (more countries soon).</Text>
      </View>
    );
  }

  if (onboarding) {
    return (
      <View style={[styles.connectCard, { borderColor: colors.warning }]}>
        <View style={styles.connectRow}>
          <View style={[styles.stripeIconWrap, { backgroundColor: 'rgba(251,191,36,0.12)', borderColor: colors.warning }]}>
            <AlertCircle size={18} color={colors.warning} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.connectHead}>Finish Stripe setup</Text>
            <Text style={styles.connectSub}>
              You started Stripe onboarding but a few steps remain (bank account,
              ID verification). Earnings accrue but can't pay out until this is done.
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.connectBtn} onPress={onConnect} disabled={connecting}>
          {connecting ? <ActivityIndicator color={colors.textInverse} /> :
            <><ExternalLink size={14} color={colors.textInverse} /><Text style={styles.connectBtnTxt}>Resume onboarding</Text></>}
        </TouchableOpacity>
      </View>
    );
  }

  if (restricted) {
    return (
      <View style={[styles.connectCard, { borderColor: colors.warning }]}>
        <View style={styles.connectRow}>
          <View style={[styles.stripeIconWrap, { backgroundColor: 'rgba(251,191,36,0.12)', borderColor: colors.warning }]}>
            <AlertCircle size={18} color={colors.warning} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.connectHead}>Payouts restricted</Text>
            <Text style={styles.connectSub}>
              Stripe needs more info before they can release payouts. Open your
              Stripe dashboard to see what's needed.
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.connectBtn} onPress={onOpenDashboard}>
          <ExternalLink size={14} color={colors.textInverse} />
          <Text style={styles.connectBtnTxt}>Open Stripe dashboard</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ACTIVE — show balance + payouts
  const pending = payouts?.pending_cents || 0;
  const available = payouts?.available_cents || 0;
  const items = (payouts?.items || []).slice(0, 3);
  return (
    <View style={[styles.connectCard, { borderColor: colors.success }]}>
      <View style={styles.connectRow}>
        <View style={[styles.stripeIconWrap, { backgroundColor: 'rgba(16,185,129,0.12)', borderColor: colors.success }]}>
          <CheckCircle2 size={18} color={colors.success} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.connectHead}>Stripe Connected</Text>
          <Text style={styles.connectSub}>Payouts arrive weekly to your bank via Stripe.</Text>
        </View>
      </View>
      <View style={styles.balanceRow}>
        <View style={styles.balanceBox}>
          <Text style={styles.balanceLabel}>Available</Text>
          <Text style={styles.balanceVal}>{fmt(available)}</Text>
        </View>
        <View style={styles.balanceBox}>
          <Text style={styles.balanceLabel}>Pending</Text>
          <Text style={styles.balanceVal}>{fmt(pending)}</Text>
        </View>
      </View>
      {items.length > 0 && (
        <View style={{ marginTop: 10 }}>
          <Text style={[styles.connectHead, { fontSize: 11, marginBottom: 6, color: colors.textTertiary, letterSpacing: 0.5 }]}>RECENT PAYOUTS</Text>
          {items.map((p: any) => (
            <View key={p.id} style={styles.payoutLine}>
              <View style={{ flex: 1 }}>
                <Text style={styles.payoutDate}>
                  {p.arrival_date ? new Date(p.arrival_date * 1000).toLocaleDateString() : '—'}
                </Text>
                <Text style={styles.payoutStatus}>{p.status}</Text>
              </View>
              <Text style={styles.payoutAmt}>{fmt(p.amount)}</Text>
            </View>
          ))}
        </View>
      )}
      <TouchableOpacity style={[styles.connectBtn, { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, marginTop: 14 }]} onPress={onOpenDashboard}>
        <ExternalLink size={14} color={colors.primary} />
        <Text style={[styles.connectBtnTxt, { color: colors.primary }]}>Open Stripe dashboard</Text>
      </TouchableOpacity>
    </View>
  );
}


function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kpiCard}>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    active:    { bg: 'rgba(16,185,129,0.16)',  color: colors.success, label: 'Live' },
    pending:   { bg: 'rgba(251,191,36,0.16)',  color: colors.warning, label: 'In review' },
    denied:    { bg: 'rgba(208,72,72,0.16)',   color: colors.secondary, label: 'Denied' },
    suspended: { bg: 'rgba(208,72,72,0.16)',   color: colors.secondary, label: 'Suspended' },
    removed:   { bg: 'rgba(113,113,122,0.16)', color: colors.textTertiary, label: 'Removed' },
  };
  const c = map[status] || map.pending;
  return (
    <View style={[styles.statusChip, { backgroundColor: c.bg }]}>
      <Text style={[styles.statusChipTxt, { color: c.color }]}>{c.label}</Text>
    </View>
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
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: colors.primary, borderRadius: radii.pill, marginRight: 8 },
  addTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 12 },

  hero: {
    marginHorizontal: space.md, marginTop: space.md,
    padding: space.xl,
    backgroundColor: colors.primary,
    borderRadius: radii.xl,
  },
  heroLabel: { color: 'rgba(0,0,0,0.7)', fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 1 },
  heroValue: { color: colors.textInverse, fontFamily: font.display, fontSize: 34, marginTop: 4 },
  heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.2)', paddingHorizontal: 9, paddingVertical: 4, borderRadius: radii.pill },
  heroBadgeTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 11 },
  feeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12 },
  feeTxt: { color: 'rgba(0,0,0,0.6)', fontFamily: font.body, fontSize: 11 },

  kpiRow: { flexDirection: 'row', paddingHorizontal: space.md, marginTop: space.md, gap: 6 },
  kpiCard: { flex: 1, padding: 10, backgroundColor: colors.surface1, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
  kpiValue: { color: colors.text, fontFamily: font.bodyBold, fontSize: 16 },
  kpiLabel: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10, marginTop: 2 },

  payoutCard: {
    marginHorizontal: space.md, marginTop: space.md,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.lg,
  },
  payoutK: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  payoutV: { color: colors.text, fontFamily: font.bodyBold, fontSize: 20, marginTop: 2 },
  payoutSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 4, lineHeight: 15 },
  payoutBtn: { paddingVertical: 9, paddingHorizontal: 12, backgroundColor: colors.surface2, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
  payoutBtnTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 12 },

  connectCard: {
    marginHorizontal: space.md, marginTop: space.md,
    padding: 14,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.lg,
  },
  connectRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  stripeIconWrap: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  connectHead: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  connectSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 3, lineHeight: 17 },
  connectBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, paddingHorizontal: 16,
    backgroundColor: colors.primary, borderRadius: radii.md,
  },
  connectBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 13 },
  connectFoot: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10, textAlign: 'center', marginTop: 8 },
  balanceRow: { flexDirection: 'row', gap: 8 },
  balanceBox: { flex: 1, padding: 10, backgroundColor: colors.surface2, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
  balanceLabel: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10, letterSpacing: 0.5 },
  balanceVal: { color: colors.text, fontFamily: font.bodyBold, fontSize: 18, marginTop: 2 },
  payoutLine: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border },
  payoutDate: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },
  payoutStatus: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10, marginTop: 2 },
  payoutAmt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 14 },

  sectionHead: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13, marginBottom: 10, letterSpacing: 0.3 },

  empty: { alignItems: 'center', padding: space.xxl, gap: 8 },
  emptyHead: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  emptySub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13 },
  emptyCta: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 11, backgroundColor: colors.primary, borderRadius: radii.md, marginTop: 4 },
  emptyCtaTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 13 },

  productRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 10,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md, marginBottom: 8,
  },
  productThumb: { width: 64, height: 64, borderRadius: radii.sm },
  productTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },
  productMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  productKpi: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  productKpiTxt: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  productRevenue: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 12, marginTop: 4 },
  editBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(245,166,35,0.12)', borderWidth: 1, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  statusChip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: radii.sm },
  statusChipTxt: { fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.3 },
});
