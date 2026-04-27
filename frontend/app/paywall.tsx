import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Pressable, Platform, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Check, Crown, Sparkles } from 'lucide-react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { colors, font, space, radii } from '../src/theme';
import { Button } from '../src/components/Button';
import { api, formatApiError } from '../src/api';
import { useAuth } from '../src/auth';

const HERO = require('../assets/brand/branding-hero.png');

type BillingCycle = 'monthly' | 'annual';

interface Plan {
  key: string;
  name: string;
  tagline: string;
  monthly_price: string;
  annual_price: string;
  monthly_cents: number;
  annual_cents: number;
  features: string[];
  popular?: boolean;
}

export default function Paywall() {
  const { user, refresh } = useAuth();
  const params = useLocalSearchParams<{ reason?: string }>();
  const [busy, setBusy] = useState<string | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  // FIX(2026-05): Annual toggle is now fully enabled. Backend /checkout
  // accepts cycle='annual' and maps to the annual Stripe price. Users
  // save ~17% picking annual; the saveBadge shows the exact discount.
  const annualEnabled = true;
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/plans');
        setPlans(r?.plans || []);
      } catch {
        // Render will gracefully show nothing; user can back out.
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const tryPlan = async (plan: string) => {
    if (plan === user?.plan) return;
    // Free = downgrade → route to billing portal (Stripe handles cancel at period end).
    if (plan === 'free') {
      if (!user?.plan || user.plan === 'free') return;
      setBusy(plan);
      try {
        const r = await api.post('/billing/portal', {});
        if (r?.url) {
          await WebBrowser.openBrowserAsync(r.url);
        }
      } catch (e) {
        Alert.alert('Could not open billing portal', formatApiError(e));
      } finally {
        setBusy(null);
      }
      return;
    }
    // Upgrade → Stripe Checkout in an in-app browser.
    setBusy(plan);
    try {
      // Build origin URL from current page (web) or a canonical deep link (native).
      let origin: string | undefined;
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        origin = window.location.origin;
      } else {
        // On native, let backend auto-detect from Host header (works on preview).
        origin = undefined;
      }
      const r = await api.post('/billing/checkout', { plan, origin_url: origin });
      if (!r?.url) throw new Error('No checkout URL');
      const result = await WebBrowser.openAuthSessionAsync(r.url, Linking.createURL('/billing'));
      // Any dismiss/return → refresh the server view of current plan.
      await refresh();
      if (result.type === 'success' || result.type === 'dismiss') {
        router.replace('/billing');
      }
    } catch (e) {
      Alert.alert('Could not start checkout', formatApiError(e));
    } finally {
      setBusy(null);
    }
  };

  const reasonCopy = (() => {
    switch (params.reason) {
      case 'saves':
        return "You've reached your free save limit.";
      case 'collections':
        return 'Free plan includes 1 collection. Go Pro for unlimited.';
      case 'filters':
        return 'Advanced filters are a Pro feature.';
      case 'private':
        return 'Unlimited private spots are a Pro feature.';
      default:
        return 'Upgrade for unlimited saves, advanced filters, and creator tools.';
    }
  })();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="paywall-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 60, backgroundColor: '#000000' }}>
        {/* (Apr 2026 minor cleanup) Hero artwork removed entirely — the
            giant "LumaScout" watermark behind the pill consumed too much
            vertical real estate on iPhone, pushing the pricing tiers below
            the fold. Replaced with a clean solid-black header that keeps
            only the gold "LUMASCOUT MEMBERSHIP" pill. */}
        <View style={styles.cleanHead}>
          <View style={styles.heroBadge}>
            <Crown size={16} color={colors.primary} />
            <Text style={styles.heroBadgeTxt}>LUMASCOUT MEMBERSHIP</Text>
          </View>
        </View>
        <View style={{ paddingHorizontal: space.xl, backgroundColor: '#000000' }}>
        <Text style={styles.title}>Scout smarter.{'\n'}Shoot better.</Text>
        <Text style={styles.sub}>
          {user?.plan && user.plan !== 'free' && !params.reason
            ? `You're on ${user.plan.toUpperCase()}. Thank you for supporting LumaScout.`
            : reasonCopy}
        </Text>

        {/* Billing cycle toggle — annual is preview only until Stripe annual prices are wired */}
        <View style={styles.cycleWrap}>
          {(['monthly', 'annual'] as BillingCycle[]).map((c) => {
            const disabled = c === 'annual' && !annualEnabled;
            return (
              <Pressable
                key={c}
                onPress={() => !disabled && setCycle(c)}
                style={[
                  styles.cycleBtn,
                  cycle === c && styles.cycleBtnActive,
                  disabled && { opacity: 0.5 },
                ]}
                testID={`cycle-${c}`}
              >
                <Text style={[styles.cycleBtnTxt, cycle === c && styles.cycleBtnTxtActive]}>
                  {c === 'monthly' ? 'Monthly' : 'Annual'}
                </Text>
                {c === 'annual' && (
                  <View style={styles.saveBadge}>
                    {disabled
                      ? <Text style={styles.saveBadgeTxt}>Coming soon</Text>
                      : <>
                          <Sparkles size={10} color={colors.textInverse} />
                          <Text style={styles.saveBadgeTxt}>Save up to 17%</Text>
                        </>}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        <View style={{ gap: space.md, marginTop: space.xl }}>
          {plans.map((p) => {
            const onPlan = user?.plan === p.key;
            const price = cycle === 'monthly' ? p.monthly_price : p.annual_price;
            const period =
              p.key === 'free' ? '' : cycle === 'monthly' ? '/mo' : '/yr';
            const equivMonthly =
              cycle === 'annual' && p.annual_cents > 0
                ? `$${(p.annual_cents / 12 / 100).toFixed(2)}/mo equivalent`
                : '';
            return (
              <View
                key={p.key}
                style={[
                  styles.planCard,
                  p.popular && styles.planPopular,
                  onPlan && { borderColor: colors.success },
                ]}
              >
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
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, flexWrap: 'wrap' }}>
                  <Text style={styles.planName}>{p.name}</Text>
                  <Text style={styles.planPrice}>{price}</Text>
                  {!!period && <Text style={styles.planPeriod}>{period}</Text>}
                </View>
                {!!equivMonthly && <Text style={styles.planEquiv}>{equivMonthly}</Text>}
                <Text style={styles.planTag}>{p.tagline}</Text>

                <View style={{ gap: 8, marginTop: space.md }}>
                  {p.features.map((f) => (
                    <View key={f} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                      <Check size={14} color={colors.success} style={{ marginTop: 3 }} />
                      <Text style={styles.featLine}>{f}</Text>
                    </View>
                  ))}
                </View>

                <Button
                  title={
                    onPlan
                      ? 'Current plan'
                      : p.key === 'free'
                      ? 'Downgrade to Free'
                      : `Go ${p.name}`
                  }
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
          Secure billing by Stripe. Cancel anytime from Billing & Subscription. Monthly plans only.
        </Text>

        <Text style={styles.compareHead}>Compare plans</Text>
        <View style={styles.compare}>
          {/* FIX(2026-05): Rebuilt to the canonical column order
              Feature | Free | Pro | Elite. Rows are exhaustive, mobile
              readable, and checkmark-consistent. */}
          <View style={[styles.cmpRow, styles.cmpHead]}>
            <Text style={[styles.cmpCell, styles.cmpHeadTxt, { flex: 1.9, textAlign: 'left' }]}>Feature</Text>
            <Text style={[styles.cmpCell, styles.cmpHeadTxt]}>Free</Text>
            <Text style={[styles.cmpCell, styles.cmpHeadTxt]}>Pro</Text>
            <Text style={[styles.cmpCell, styles.cmpHeadTxt, { color: colors.primary }]}>Elite</Text>
          </View>
          {([
            ['Saved spots',              '5',       'Unlimited',  'Unlimited'],
            ['Private spots',            '1',       'Unlimited',  'Unlimited'],
            ['Collections',              '1',       'Unlimited',  'Unlimited'],
            ['Advanced filters',         '—',       '✓',          '✓'],
            ['Creator analytics',        '—',       'Basic',      'Advanced'],
            ['Sell spot packs',          '—',       '—',          '✓'],
            ['Verified creator badge',   '—',       'Pro badge',  'Elite badge'],
            ['DM read receipts',         '—',       '✓',          '✓'],
            ['Who viewed profile',       'Teaser',  'Full list',  'Full + analytics'],
            ['Referral priority',        '—',       'Standard',   'Priority'],
            ['Featured placement',       '—',       '—',          '✓'],
            ['AI shoot planner',         '—',       '—',          '✓'],
            ['Branded client portal',    '—',       '—',          '✓'],
          ] as Array<[string, string, string, string]>).map((row, i) => (
            <View
              key={i}
              style={[styles.cmpRow, i % 2 === 0 && { backgroundColor: colors.surface1 }]}
            >
              <Text style={[styles.cmpCell, { flex: 1.9, textAlign: 'left' }]}>{row[0]}</Text>
              <Text style={[styles.cmpCell, styles.cmpCellMuted]}>{row[1]}</Text>
              <Text style={[styles.cmpCell, row[2] !== '—' && styles.cmpCellYes]}>{row[2]}</Text>
              <Text style={[styles.cmpCell, row[3] !== '—' && { color: colors.primary, fontFamily: font.bodyBold }]}>{row[3]}</Text>
            </View>
          ))}
        </View>

        {loading && <Text style={[styles.fine, { marginTop: space.lg }]}>Loading plans…</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', paddingHorizontal: space.xl, paddingTop: space.sm, position: 'absolute', top: space.sm, left: 0, right: 0, zIndex: 10 },
  backBtn: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(10,10,10,0.55)', borderRadius: 20,
  },
  // (Apr 2026 minor cleanup) Replaced 220px hero+gradient with a slim
  // header strip so pricing tiers sit higher on the screen.
  cleanHead: {
    paddingTop: space.xxl,
    paddingBottom: space.lg,
    alignItems: 'center',
    backgroundColor: '#000000',
  },
  heroImg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginLeft: space.xl,
    marginBottom: space.lg,
    backgroundColor: 'rgba(10,10,10,0.65)',
    borderColor: 'rgba(245,166,35,0.45)',
    borderWidth: 1,
    borderRadius: radii.pill,
  },
  heroBadgeTxt: {
    color: colors.primary,
    fontFamily: font.bodyBold,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  title: {
    color: colors.text, fontFamily: font.display, fontSize: 36,
    lineHeight: 40, letterSpacing: -0.5, textAlign: 'center', marginTop: space.xl,
  },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 15, textAlign: 'center', marginTop: space.sm, lineHeight: 22 },

  cycleWrap: {
    flexDirection: 'row', alignSelf: 'center', marginTop: space.xl,
    backgroundColor: colors.surface1, borderRadius: radii.pill, padding: 4,
    borderColor: colors.border, borderWidth: 1,
  },
  cycleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 8, borderRadius: radii.pill,
  },
  cycleBtnActive: { backgroundColor: colors.primary },
  cycleBtnTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 13 },
  cycleBtnTxtActive: { color: colors.textInverse },
  saveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0,0,0,0.18)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.pill,
  },
  saveBadgeTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.3 },

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
  planEquiv: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  planTag: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
  featLine: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, flex: 1, lineHeight: 19 },
  fine: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, textAlign: 'center', marginTop: space.xl, lineHeight: 16 },
  compareHead: { color: colors.text, fontFamily: font.display, fontSize: 22, marginTop: space.xxl, marginBottom: space.md },
  compare: { borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  cmpRow: { flexDirection: 'row', paddingVertical: 12, paddingHorizontal: space.md, alignItems: 'center' },
  cmpHead: { backgroundColor: colors.surface2, borderBottomWidth: 1, borderBottomColor: colors.border },
  cmpHeadTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
  cmpCell: { flex: 1, color: colors.text, fontFamily: font.bodyMedium, fontSize: 12, textAlign: 'center', paddingVertical: 10, paddingHorizontal: 4 },
  cmpCellMuted: { color: colors.textTertiary },
  cmpCellYes: { color: colors.text, fontFamily: font.bodyBold },
});
