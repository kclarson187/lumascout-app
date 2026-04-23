/**
 * Purchase success page (Stripe Checkout return).
 * Path: /marketplace/purchase-success?purchase_id=...&session_id=...
 *
 * Shows a celebratory confirmation and polls the purchase status for up
 * to ~15s (webhook normally finalizes within 2-3s). Once status='completed'
 * we deep-link into the library.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { CheckCircle, ShoppingBag, Download } from 'lucide-react-native';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';

export default function PurchaseSuccess() {
  const { purchase_id } = useLocalSearchParams<{ purchase_id?: string }>();
  const [status, setStatus] = useState<'polling' | 'completed' | 'timeout'>('polling');
  const [productId, setProductId] = useState<string | null>(null);

  useEffect(() => {
    let attempts = 0;
    let interval: any = null;
    async function tick() {
      attempts++;
      try {
        const lib = await api.get('/me/marketplace/library');
        const match = (lib.items || []).find((it: any) => it.purchase_id === purchase_id);
        if (match) {
          setStatus('completed');
          setProductId(match.product.product_id);
          clearInterval(interval);
          return;
        }
      } catch {}
      if (attempts >= 10) {
        setStatus('timeout');
        clearInterval(interval);
      }
    }
    interval = setInterval(tick, 1500);
    tick();
    return () => clearInterval(interval);
  }, [purchase_id]);

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.center}>
        {status === 'polling' ? (
          <>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.title}>Finalizing your purchase…</Text>
            <Text style={styles.sub}>Stripe is confirming the payment. This takes a couple of seconds.</Text>
          </>
        ) : status === 'completed' ? (
          <>
            <View style={styles.iconRing}>
              <CheckCircle size={44} color={colors.success} strokeWidth={2} />
            </View>
            <Text style={styles.title}>Purchase complete 🎉</Text>
            <Text style={styles.sub}>Your pack is unlocked. Jump into the library to download.</Text>
            <TouchableOpacity style={styles.cta} onPress={() => router.replace('/me/library' as any)}>
              <Download size={14} color={colors.textInverse} />
              <Text style={styles.ctaTxt}>Go to My Purchases</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.replace('/marketplace' as any)} style={{ marginTop: 12 }}>
              <Text style={styles.secondaryLink}>Keep browsing</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.title}>Still processing…</Text>
            <Text style={styles.sub}>
              Your payment went through, but the confirmation is taking longer than
              expected. Check My Purchases in a minute — it'll show up automatically.
            </Text>
            <TouchableOpacity style={styles.cta} onPress={() => router.replace('/me/library' as any)}>
              <ShoppingBag size={14} color={colors.textInverse} />
              <Text style={styles.ctaTxt}>Open My Purchases</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: 14 },
  iconRing: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: 'rgba(16,185,129,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: colors.text, fontFamily: font.display, fontSize: 24, textAlign: 'center' },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, textAlign: 'center', lineHeight: 20, maxWidth: 320 },
  cta: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 13, paddingHorizontal: 22, backgroundColor: colors.primary, borderRadius: radii.md },
  ctaTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },
  secondaryLink: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 13 },
});
