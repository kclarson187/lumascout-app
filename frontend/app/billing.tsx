import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Platform, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ChevronLeft, Receipt, Calendar, CreditCard, Crown,
  ExternalLink, AlertTriangle, CheckCircle2,
} from 'lucide-react-native';
import * as WebBrowser from 'expo-web-browser';
import { api, formatApiError } from '../src/api';
import { useAuth } from '../src/auth';
import { colors, font, space, radii } from '../src/theme';
import { Button } from '../src/components/Button';
import { isPaid as entitlementsIsPaid, isAdmin, planLabel } from '../src/utils/entitlements';

export default function Billing() {
  const { user, refresh } = useAuth();
  const params = useLocalSearchParams<{ status?: string; session_id?: string }>();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/billing/status');
      setData(r);
    } catch (e) {
      Alert.alert('Could not load billing', formatApiError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Came back from Stripe Checkout — refresh auth + status so plan shows fresh.
  useEffect(() => {
    if (params.status === 'success') {
      (async () => {
        await refresh();
        await load();
      })();
    }
  }, [params.status, refresh, load]);

  const openPortal = async () => {
    setPortalBusy(true);
    try {
      const r = await api.post('/billing/portal', {});
      if (!r?.url) throw new Error('No portal URL');
      await WebBrowser.openBrowserAsync(r.url);
      // Refresh once the user returns.
      await refresh();
      await load();
    } catch (e) {
      Alert.alert('Could not open billing portal', formatApiError(e));
    } finally {
      setPortalBusy(false);
    }
  };

  const openInvoice = async (url?: string | null) => {
    if (!url) return;
    try { await WebBrowser.openBrowserAsync(url); } catch {}
  };

  if (loading || !data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const plan = planLabel({ plan: data.plan, role: user?.role });
  // Treat admins, paid plans, comp plans, and trial plans all as "paid" for
  // entitlement purposes — none of them should ever see an upsell.
  const isPaid = entitlementsIsPaid({ plan: data.plan, role: user?.role });
  const isComp = data.billing_status === 'comp' || data.plan === 'comp_pro' || data.plan === 'comp_elite';
  const status = (data.billing_status || '').toLowerCase();
  const statusLabel = isComp
    ? 'COMPLIMENTARY'
    : status === 'active' ? 'ACTIVE'
    : status === 'past_due' ? 'PAYMENT FAILED'
    : status === 'canceled' ? 'CANCELED'
    : status === 'trialing' ? 'TRIAL'
    : isPaid ? 'ACTIVE' : 'FREE TIER';
  const statusColor =
    status === 'past_due' ? colors.secondary :
    status === 'canceled' ? colors.textTertiary :
    isPaid ? colors.success : colors.surface3;

  const renewsTxt = data.renewal_date
    ? `${data.cancel_at_period_end ? 'Access ends' : 'Renews'} ${new Date(data.renewal_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : isPaid ? 'Renewal date pending' : '—';

  const pm = data.payment_method;
  const pmTxt = pm
    ? `${(pm.brand || 'Card').toUpperCase()} •••• ${pm.last4}  ·  exp ${String(pm.exp_month).padStart(2, '0')}/${String(pm.exp_year).slice(-2)}`
    : isPaid ? 'Manage in billing portal' : 'No payment method on file';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="billing-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Plan & billing</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        {params.status === 'success' && (
          <View style={[styles.banner, { borderColor: colors.success, backgroundColor: 'rgba(16,185,129,0.08)' }]}>
            <CheckCircle2 size={18} color={colors.success} />
            <Text style={styles.bannerTxt}>
              Checkout complete — your plan is being activated. It may take a few seconds for Stripe to confirm.
            </Text>
          </View>
        )}

        {status === 'past_due' && (
          <View style={[styles.banner, { borderColor: colors.secondary, backgroundColor: 'rgba(208,72,72,0.08)' }]}>
            <AlertTriangle size={18} color={colors.secondary} />
            <Text style={styles.bannerTxt}>
              Last payment failed. Update your card to keep {plan} active.
            </Text>
          </View>
        )}

        {data.cancel_at_period_end && isPaid && (
          <View style={[styles.banner, { borderColor: colors.primary, backgroundColor: 'rgba(245,166,35,0.08)' }]}>
            <AlertTriangle size={18} color={colors.primary} />
            <Text style={styles.bannerTxt}>
              Subscription canceled — you'll keep {plan} until {new Date(data.renewal_date).toLocaleDateString()}.
            </Text>
          </View>
        )}

        {/* Plan card */}
        <View style={[styles.planCard, isPaid && { borderColor: colors.primary }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <View style={[styles.crownBubble, isPaid && { backgroundColor: 'rgba(245,166,35,0.15)' }]}>
                <Crown size={22} color={isPaid ? colors.primary : colors.textSecondary} />
              </View>
              <View>
                <Text style={styles.planLabel}>You're on</Text>
                <Text style={styles.planName}>{plan}</Text>
              </View>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
              <Text style={styles.statusTxt}>{statusLabel}</Text>
            </View>
          </View>
        </View>

        {/* Subscription details */}
        <View style={styles.detailCard}>
          <Text style={styles.sectionLabel}>Subscription</Text>
          <View style={styles.detailRow}>
            <Calendar size={16} color={colors.textSecondary} />
            <Text style={styles.detailTxt}>{renewsTxt}</Text>
          </View>
          <View style={styles.detailRow}>
            <CreditCard size={16} color={colors.textSecondary} />
            <Text style={styles.detailTxt}>{pmTxt}</Text>
          </View>
        </View>

        {/* Actions */}
        <View style={{ gap: space.md }}>
          <Button
            title={isPaid ? 'Change plan' : 'Upgrade to Pro or Elite'}
            onPress={() => router.push('/paywall')}
            testID="billing-change-plan"
          />
          {isPaid && !isComp && (
            <Button
              title="Manage billing (Stripe)"
              variant="secondary"
              loading={portalBusy}
              onPress={openPortal}
              testID="billing-portal"
            />
          )}
          {isComp && (
            <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 12, textAlign: 'center' }}>
              You have a complimentary {plan} grant from the LumaScout team. No billing required.
            </Text>
          )}
        </View>

        {/* Invoices */}
        <View style={styles.detailCard}>
          <Text style={styles.sectionLabel}>Billing history</Text>
          {(data.invoices || []).length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: space.lg, gap: 6 }}>
              <Receipt size={22} color={colors.textTertiary} />
              <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 13 }}>No invoices yet</Text>
              <Text style={{ color: colors.textTertiary, fontFamily: font.body, fontSize: 11, textAlign: 'center' }}>
                {isPaid ? 'Invoices appear here after each billing cycle.' : 'Upgrade to start receiving invoices.'}
              </Text>
            </View>
          ) : (
            data.invoices.map((inv: any) => (
              <TouchableOpacity
                key={inv.id}
                style={styles.invRow}
                onPress={() => openInvoice(inv.hosted_invoice_url || inv.invoice_pdf)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontFamily: font.bodyMedium, fontSize: 13 }}>
                    {inv.created ? new Date(inv.created * 1000).toLocaleDateString() : '—'}
                  </Text>
                  <Text style={{ color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                    {inv.number || inv.id} · {(inv.status || 'unknown').toUpperCase()}
                  </Text>
                </View>
                <Text style={{ color: colors.text, fontFamily: font.bodyBold, fontSize: 14, marginRight: 6 }}>
                  ${((inv.amount_paid ?? inv.amount_due ?? 0) / 100).toFixed(2)}
                </Text>
                <ExternalLink size={14} color={colors.textSecondary} />
              </TouchableOpacity>
            ))
          )}
        </View>

        <Text style={styles.fine}>
          Secure billing by Stripe. Taxes where applicable. {Platform.OS === 'web' ? 'Web' : 'App'} payments processed in USD.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, paddingVertical: space.md, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 26 },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: space.md, borderRadius: radii.md, borderWidth: 1,
  },
  bannerTxt: { flex: 1, color: colors.text, fontFamily: font.bodyMedium, fontSize: 12, lineHeight: 17 },
  planCard: {
    padding: space.xl, backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg,
  },
  crownBubble: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  planLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  planName: { color: colors.text, fontFamily: font.display, fontSize: 28, letterSpacing: -0.3, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill },
  statusTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.5 },
  detailCard: {
    padding: space.lg, backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, gap: 10,
  },
  sectionLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
  detailRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  detailTxt: { color: colors.text, fontFamily: font.body, fontSize: 13, flex: 1 },
  invRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle,
  },
  fine: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, textAlign: 'center', marginTop: space.md, lineHeight: 16 },
});
