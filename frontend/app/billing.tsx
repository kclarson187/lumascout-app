import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, Receipt, Calendar, CreditCard, Crown } from 'lucide-react-native';
import { api } from '../src/api';
import { useAuth } from '../src/auth';
import { colors, font, space, radii } from '../src/theme';
import { Button } from '../src/components/Button';
import { EmptyState } from '../src/components/ui';

export default function Billing() {
  const { user } = useAuth();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const r = await api.get('/me/billing');
      setData(r);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  if (loading || !data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const plan = (data.plan || 'free').toUpperCase();
  const isPaid = data.plan !== 'free';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="billing-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Plan & billing</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: 80 }}>
        <View style={[styles.planCard, isPaid && { borderColor: colors.primary }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Crown size={22} color={isPaid ? colors.primary : colors.textSecondary} />
              <View>
                <Text style={styles.planLabel}>You're on</Text>
                <Text style={styles.planName}>{plan}</Text>
              </View>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: isPaid ? colors.success : colors.surface3 }]}>
              <Text style={styles.statusTxt}>{data.plan_status === 'active' ? 'ACTIVE' : 'FREE TIER'}</Text>
            </View>
          </View>
          <View style={{ marginTop: space.lg, gap: 8 }}>
            <Row label="Saves used" value={`${data.usage?.saves || 0} / ${data.limits.saves.toLocaleString()}`} />
            <Row label="Private spots" value={`${data.usage?.private_spots || 0} / ${data.limits.private_spots.toLocaleString()}`} />
            <Row label="Collections" value={`${data.usage?.collections || 0} / ${data.limits.collections.toLocaleString()}`} />
            <Row label="Advanced filters" value={data.limits.advanced_filters ? 'Unlocked' : 'Pro & Elite only'} />
            <Row label="Sell packs" value={data.limits.sell_packs ? 'Unlocked' : 'Elite only'} />
          </View>
        </View>

        <View style={styles.detailCard}>
          <Text style={styles.sectionLabel}>Subscription</Text>
          <View style={styles.detailRow}>
            <Calendar size={16} color={colors.textSecondary} />
            <Text style={styles.detailTxt}>
              {isPaid ? (data.renews_at ? `Renews ${new Date(data.renews_at).toLocaleDateString()}` : 'Renewal starts with Stripe next release') : 'No subscription — you\'re on Free'}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <CreditCard size={16} color={colors.textSecondary} />
            <Text style={styles.detailTxt}>
              {data.payment_method || 'No payment method on file'}
            </Text>
          </View>
        </View>

        <View style={styles.detailCard}>
          <Text style={styles.sectionLabel}>Billing history</Text>
          {(data.invoices || []).length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: space.lg, gap: 6 }}>
              <Receipt size={24} color={colors.textTertiary} />
              <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 13 }}>No invoices yet</Text>
              <Text style={{ color: colors.textTertiary, fontFamily: font.body, fontSize: 11 }}>
                Invoices appear here once Stripe billing is live.
              </Text>
            </View>
          ) : (
            data.invoices.map((inv: any) => (
              <View key={inv.id} style={styles.invRow}>
                <Text style={{ color: colors.text, fontFamily: font.bodyMedium }}>{new Date(inv.date).toLocaleDateString()}</Text>
                <Text style={{ color: colors.text, fontFamily: font.bodyBold }}>${(inv.amount_cents / 100).toFixed(2)}</Text>
              </View>
            ))
          )}
        </View>

        <View style={{ gap: space.md }}>
          <Button
            title={isPaid ? 'Change plan' : 'Upgrade to Pro or Elite'}
            onPress={() => router.push('/paywall')}
            testID="billing-change-plan"
          />
          {isPaid && (
            <Button
              title="Cancel subscription"
              variant="ghost"
              onPress={() => Alert.alert('Not available yet', 'Cancellation opens with Stripe billing at launch. Your preview plan remains active until then.')}
              testID="billing-cancel"
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, paddingVertical: space.md, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 26 },
  planCard: {
    padding: space.xl, backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg,
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
  detailTxt: { color: colors.text, fontFamily: font.body, fontSize: 13 },
  invRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle,
  },
});
