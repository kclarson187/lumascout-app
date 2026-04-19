import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, Check, Crown } from 'lucide-react-native';
import { colors, font, space, radii } from '../src/theme';
import { Button } from '../src/components/Button';
import { api, formatApiError } from '../src/api';
import { useAuth } from '../src/auth';

const PLANS = [
  {
    key: 'free',
    name: 'Free',
    price: '$0',
    tagline: 'For casual scouting',
    features: [
      'Browse all public spots',
      'Save up to 20 spots',
      '3 private spots',
      '3 collections',
      'Basic filters',
    ],
    cta: 'Current plan',
  },
  {
    key: 'pro',
    name: 'Pro',
    price: '$7.99',
    period: '/mo',
    tagline: 'For working photographers',
    features: [
      'Unlimited saves & collections',
      'Unlimited private spots',
      'Advanced filters & search',
      'Detailed logistics data',
      'Priority in search results',
      'Offline saved spots (soon)',
    ],
    popular: true,
    cta: 'Start 7-day free trial',
  },
  {
    key: 'elite',
    name: 'Elite',
    price: '$19.99',
    period: '/mo',
    tagline: 'For creators who sell',
    features: [
      'Everything in Pro',
      'Premium creator analytics',
      'Sell curated spot packs',
      'Private audience access',
      'Enhanced verified profile',
      'Early access to new features',
    ],
    cta: 'Go Elite',
  },
];

export default function Paywall() {
  const { user, refresh } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  const tryPlan = async (plan: string) => {
    if (plan === 'free' || plan === user?.plan) return;
    setBusy(plan);
    try {
      await api.post('/me/upgrade', { plan });
      await refresh();
      Alert.alert('You\'re on ' + plan.toUpperCase(), 'Preview unlock active. Real billing will move to Stripe at launch.');
    } catch (e) {
      Alert.alert('Could not upgrade', formatApiError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="paywall-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 60 }}>
        <View style={styles.crown}><Crown size={28} color={colors.primary} /></View>
        <Text style={styles.title}>Scout smarter.{'\n'}Shoot better.</Text>
        <Text style={styles.sub}>
          {user?.plan && user.plan !== 'free'
            ? `You're on ${user.plan.toUpperCase()}. Thank you for supporting PhotoScout.`
            : 'Upgrade for unlimited saves, advanced filters, and creator tools.'}
        </Text>

        <View style={{ gap: space.md, marginTop: space.xl }}>
          {PLANS.map((p) => {
            const onPlan = user?.plan === p.key;
            return (
            <View key={p.key} style={[styles.planCard, p.popular && styles.planPopular, onPlan && { borderColor: colors.success }]}>
              {p.popular && !onPlan && (
                <View style={styles.popBadge}>
                  <Text style={styles.popBadgeTxt}>MOST POPULAR</Text>
                </View>
              )}
              {onPlan && (
                <View style={[styles.popBadge, { backgroundColor: colors.success }]}>
                  <Text style={styles.popBadgeTxt}>YOUR PLAN</Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <Text style={styles.planName}>{p.name}</Text>
                <Text style={styles.planPrice}>{p.price}</Text>
                {p.period && <Text style={styles.planPeriod}>{p.period}</Text>}
              </View>
              <Text style={styles.planTag}>{p.tagline}</Text>

              <View style={{ gap: 8, marginTop: space.md }}>
                {p.features.map((f) => (
                  <View key={f} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <Check size={14} color={colors.success} />
                    <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 13 }}>{f}</Text>
                  </View>
                ))}
              </View>

              <Button
                title={onPlan ? 'Current plan' : p.cta}
                variant={p.popular && !onPlan ? 'primary' : 'secondary'}
                loading={busy === p.key}
                disabled={onPlan || p.key === 'free'}
                onPress={() => tryPlan(p.key)}
                style={{ marginTop: space.md }}
                testID={`paywall-${p.key}`}
              />
            </View>
            );
          })}
        </View>

        <Text style={styles.fine}>
          Preview unlock is free during beta. Stripe billing ships at launch — your plan will migrate automatically.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', paddingHorizontal: space.xl, paddingTop: space.sm },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  crown: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: 'rgba(245,166,35,0.15)', borderColor: 'rgba(245,166,35,0.4)', borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: space.lg,
  },
  title: {
    color: colors.text, fontFamily: font.display, fontSize: 36,
    lineHeight: 40, letterSpacing: -0.5, textAlign: 'center', marginTop: space.xl,
  },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 15, textAlign: 'center', marginTop: space.sm, lineHeight: 22 },
  planCard: {
    padding: space.xl, backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg,
  },
  planPopular: { borderColor: colors.primary },
  popBadge: {
    position: 'absolute', top: -10, left: space.xl,
    backgroundColor: colors.primary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill,
  },
  popBadgeTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.5 },
  planName: { color: colors.text, fontFamily: font.display, fontSize: 26 },
  planPrice: { color: colors.primary, fontFamily: font.display, fontSize: 26 },
  planPeriod: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13 },
  planTag: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
  fine: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, textAlign: 'center', marginTop: space.xl, lineHeight: 16 },
});
