/**
 * /admin/diagnostics — in-app debug screen that shows the resolved
 * backend URL on the actual device.
 *
 * Why this exists (May 2026):
 *   We've been chasing a production-build "blank thumbnails" bug
 *   across multiple rounds. Each round we ship a fix and the user
 *   says "still broken". The root mystery: WHICH layer of the
 *   triple-fallback chain is actually firing in their EAS build?
 *   Without console access on the device, we've been blind.
 *
 *   This page renders the answer directly in the UI:
 *     • backend_env       (Metro-inlined process.env)
 *     • backend_extra     (Constants.expoConfig.extra mirror)
 *     • backend_hardcoded (the Layer 3 fallback)
 *     • backend_resolved  (what the helper actually returns)
 *
 *   Plus a live <Image> rendering a sample proxied URL — if the
 *   sample renders, the runtime URL resolution is OK and the issue
 *   is data-side. If the sample is blank, the helper is wrong and
 *   we know to inspect the build env/extra values shown on screen.
 *
 *   Restricted to admin + super_admin so regular users never see it.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { ChevronLeft, RefreshCw, Copy } from 'lucide-react-native';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import { resolveBackendUrl, resolveWebBaseUrl, PRODUCTION_BACKEND_URL, PRODUCTION_WEB_BASE_URL } from '../../src/constants/config';

export default function AdminDiagnosticsScreen() {
  const { user } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);

  const diagnostics = useMemo(() => {
    const fromEnv = (process.env.EXPO_PUBLIC_BACKEND_URL as string | undefined) || '';
    const fromExtra = (Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL as string | undefined) || '';
    const fromExpoConfig = !!Constants.expoConfig;
    const fromManifest = !!(Constants as any)?.manifest;
    const fromManifest2 = !!(Constants as any)?.manifest2;
    const fromAppOwnership = (Constants as any)?.appOwnership || '(none)';
    const fromExecutionEnvironment = (Constants as any)?.executionEnvironment || '(none)';
    const resolved = resolveBackendUrl();
    const resolvedWeb = resolveWebBaseUrl();
    return {
      fromEnv: fromEnv || '(empty)',
      fromExtra: fromExtra || '(empty)',
      fromHardcoded: PRODUCTION_BACKEND_URL,
      resolved,
      resolvedWeb,
      hardcodedWeb: PRODUCTION_WEB_BASE_URL,
      hasExpoConfig: fromExpoConfig,
      hasManifest: fromManifest,
      hasManifest2: fromManifest2,
      appOwnership: fromAppOwnership,
      executionEnvironment: fromExecutionEnvironment,
      platform: Platform.OS,
      bundleId: (Constants.expoConfig?.ios?.bundleIdentifier
        || Constants.expoConfig?.android?.package
        || '(unknown)'),
      version: Constants.expoConfig?.version || '(unknown)',
      runtimeVersion:
        (Constants.expoConfig as any)?.runtimeVersion?.policy
        || (Constants.expoConfig as any)?.runtimeVersion
        || '(unknown)',
      newArchEnabled: !!(Constants.expoConfig as any)?.newArchEnabled
        || !!Constants.expoConfig?.ios?.newArchEnabled
        || !!Constants.expoConfig?.android?.newArchEnabled,
    };
    // refreshKey forces re-eval when user taps Refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Sample image URL used to verify image rendering end-to-end. Pulls
  // a stable Pexels photo through the proxy at the same resolved
  // backend URL. If this <Image> goes blank, the runtime backend URL
  // resolution is wrong; if it renders, the helper is OK.
  const sampleImgUrl = `${diagnostics.resolved}/api/img?u=${encodeURIComponent('https://images.pexels.com/photos/355465/pexels-photo-355465.jpeg?w=1200')}&w=560&q=70`;

  // Authorize: admin + super_admin only.
  useEffect(() => {
    if (user && !['admin', 'super_admin'].includes(user.role || '')) {
      router.replace('/');
    }
  }, [user]);

  if (!user || !['admin', 'super_admin'].includes(user.role || '')) {
    return null;
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8} testID="diag-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.kicker}>Diagnostics</Text>
        <TouchableOpacity
          onPress={() => setRefreshKey((k) => k + 1)}
          style={styles.refreshBtn}
          hitSlop={8}
          testID="diag-refresh"
        >
          <RefreshCw size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>Build & Runtime</Text>

        <Section label="Resolved backend URL" value={diagnostics.resolved} highlight={diagnostics.resolved === PRODUCTION_BACKEND_URL ? 'ok' : (diagnostics.resolved ? 'ok' : 'fail')} />
        <Section label="process.env.EXPO_PUBLIC_BACKEND_URL" value={diagnostics.fromEnv} note={diagnostics.fromEnv === '(empty)' ? "Layer 1 inactive — eas.json `env` block didn't bake in" : 'Layer 1 active — Metro inlined at build time'} />
        <Section label="Constants.expoConfig.extra.EXPO_PUBLIC_BACKEND_URL" value={diagnostics.fromExtra} note={diagnostics.fromExtra === '(empty)' ? 'Layer 2 inactive — app.config.js extra not present' : 'Layer 2 active — extra mirror'} />
        <Section label="Hardcoded fallback (Layer 3)" value={diagnostics.fromHardcoded} note="Always present — guaranteed safety net" />
        <Section label="Resolved web origin" value={diagnostics.resolvedWeb} />

        <Text style={styles.title}>Runtime context</Text>
        <Section label="Platform" value={diagnostics.platform} />
        <Section label="Bundle / package" value={diagnostics.bundleId} />
        <Section label="App version" value={diagnostics.version} />
        <Section label="Runtime version" value={String(diagnostics.runtimeVersion)} />
        <Section label="New Architecture" value={diagnostics.newArchEnabled ? 'true' : 'false'} />
        <Section label="appOwnership" value={diagnostics.appOwnership} note={diagnostics.appOwnership === 'expo' ? 'Expo Go' : 'Standalone build'} />
        <Section label="executionEnvironment" value={diagnostics.executionEnvironment} />
        <Section label="Constants.expoConfig present" value={String(diagnostics.hasExpoConfig)} />
        <Section label="Constants.manifest present" value={String(diagnostics.hasManifest)} />
        <Section label="Constants.manifest2 present" value={String(diagnostics.hasManifest2)} />

        <Text style={styles.title}>Sample image (proxy round-trip)</Text>
        <Text style={styles.helper}>
          If this image is BLANK, the resolved backend URL is wrong or the
          /api/img proxy is unreachable. If it renders, the URL resolution is
          good and any blank thumbnails elsewhere are a data-side issue.
        </Text>
        <View style={styles.sampleWrap}>
          <Image
            source={{ uri: sampleImgUrl }}
            style={styles.sampleImg}
            onError={(e) => {
              // eslint-disable-next-line no-console
              console.warn('[diag] sample_image_error', { url: sampleImgUrl, error: e?.nativeEvent });
            }}
            onLoad={() => {
              // eslint-disable-next-line no-console
              console.log('[diag] sample_image_loaded', { url: sampleImgUrl });
            }}
          />
        </View>
        <View style={styles.urlBox}>
          <Text style={styles.urlBoxTxt} selectable>{sampleImgUrl}</Text>
        </View>

        <Text style={styles.footer}>
          Built {new Date().toISOString()}.
          Tap Refresh (top-right) to re-evaluate.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  label,
  value,
  note,
  highlight,
}: {
  label: string;
  value: string;
  note?: string;
  highlight?: 'ok' | 'fail';
}) {
  const valueColor = highlight === 'fail' ? '#ff5252' : highlight === 'ok' ? colors.success : colors.text;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, { color: valueColor }]} selectable>
        {value}
      </Text>
      {note ? <Text style={styles.rowNote}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingBottom: space.sm },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  refreshBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 'auto' },
  kicker: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', flex: 1, marginLeft: 4 },
  body: { paddingHorizontal: space.lg, paddingBottom: space.xxxl, gap: space.md },
  title: { color: colors.text, fontFamily: font.display, fontSize: 18, marginTop: space.md, marginBottom: 4 },
  helper: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17 },
  row: { gap: 4, padding: 12, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  rowLabel: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' },
  rowValue: { fontFamily: 'Menlo', fontSize: 12 },
  rowNote: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, fontStyle: 'italic' },
  sampleWrap: {
    width: '100%', aspectRatio: 16 / 9, borderRadius: radii.md, overflow: 'hidden',
    backgroundColor: colors.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  sampleImg: { width: '100%', height: '100%' },
  urlBox: { padding: 10, borderRadius: radii.sm, backgroundColor: colors.surface2 },
  urlBoxTxt: { fontFamily: 'Menlo', fontSize: 10, color: colors.textSecondary },
  footer: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, textAlign: 'center', marginTop: space.lg },
});
