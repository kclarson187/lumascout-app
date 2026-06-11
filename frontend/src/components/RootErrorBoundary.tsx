/**
 * RootErrorBoundary — class-component error boundary mounted at the very
 * root of the Expo app.
 *
 * Why we need it:
 *   Without this, ANY uncaught render error (e.g. accessing `.length` on
 *   an undefined cached payload, a stale `user.plan` shape, a Reanimated
 *   worklet throwing) crashes the entire navigator to a blank black
 *   screen with no recovery path. Apple App Review rejects this.
 *
 * Phase B (Jun 2026) — TestFlight signup-crash investigation upgrade:
 *   • Always surfaces a `[ROOT_ERROR_BOUNDARY]` structured log line
 *     (visible in Xcode + macOS Console.app) so we can RCA TestFlight
 *     crashes without forcing __DEV__ on.
 *   • Production builds now display a collapsible "Details" panel with
 *     the error message, route, platform, and build number — enough
 *     for users to copy/paste back to support.
 *   • Adds a hard-recover path: if the boundary trips twice in a row
 *     within 60s, we offer "Sign out & restart" which clears the auth
 *     token and routes to /onboarding so a corrupt cached user object
 *     can't trap the user in an unrecoverable loop.
 */
import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform, Alert,
} from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { colors, font, space } from '../theme';

type Props = { children: React.ReactNode };
type State = {
  hasError: boolean;
  error?: Error;
  componentStack?: string;
  showDetails: boolean;
  /** Tracks repeat trips so we can offer the harder recovery path. */
  trips: number;
  lastTripAt: number;
};

const TRIP_WINDOW_MS = 60_000;

export default class RootErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, showDetails: false, trips: 0, lastTripAt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const now = Date.now();
    const within = now - this.state.lastTripAt < TRIP_WINDOW_MS;
    const trips = within ? this.state.trips + 1 : 1;
    this.setState({ trips, lastTripAt: now, componentStack: info?.componentStack || '' });

    // Structured log (visible in Xcode + Console.app, plus any
    // remote log ingestion). NEVER include secrets here.
    try {
      const ctx = {
        name: error?.name,
        message: error?.message,
        stack: typeof error?.stack === 'string'
          ? error.stack.split('\n').slice(0, 12).join('\n')
          : undefined,
        componentStack: typeof info?.componentStack === 'string'
          ? info.componentStack.split('\n').slice(0, 10).join('\n')
          : undefined,
        platform: Platform.OS,
        osVersion: Platform.Version,
        appVersion: (Constants as any).expoConfig?.version
          || (Constants as any).nativeAppVersion,
        buildNumber: (Constants as any).expoConfig?.ios?.buildNumber
          || (Constants as any).nativeBuildVersion,
        appOwnership: (Constants as any).appOwnership,
        trips,
        timestamp: new Date().toISOString(),
      };
      // eslint-disable-next-line no-console
      console.error('[ROOT_ERROR_BOUNDARY] render_crash', ctx);
    } catch {}
  }

  /** Soft retry — just re-mount children. Used for transient render hiccups. */
  reset = () => {
    this.setState({ hasError: false, error: undefined, componentStack: undefined, showDetails: false });
  };

  /**
   * Hard recover — clears the auth token from SecureStore and routes
   * to /onboarding. Used when the same render crash repeats inside the
   * 60s window, which means a corrupt cached user/token is the cause.
   */
  hardRecover = async () => {
    try { await SecureStore.deleteItemAsync('auth_token'); } catch {}
    try { await SecureStore.deleteItemAsync('token'); } catch {}
    try {
      // Best-effort sign-out of RC so the next user doesn't inherit
      // this account's iOS subscription state on a shared device.
      const { logoutRevenueCatUser } = await import('../lib/revenuecat');
      await logoutRevenueCatUser();
    } catch {}
    this.setState({ hasError: false, error: undefined, componentStack: undefined, trips: 0, showDetails: false });
    try { router.replace('/onboarding' as any); } catch {}
  };

  copyErr = () => {
    // We don't pull in @react-native-clipboard/clipboard for a single use.
    // Instead, surface an Alert the user can long-press to copy from.
    const e = this.state.error;
    const body = [
      `Error: ${e?.name || 'Error'}: ${e?.message || ''}`,
      Platform.OS === 'ios' ? `iOS ${Platform.Version}` : `${Platform.OS} ${Platform.Version}`,
      `App ${(Constants as any).expoConfig?.version} (${(Constants as any).expoConfig?.ios?.buildNumber || 'dev'})`,
    ].join('\n');
    Alert.alert('Error details', body);
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const err = this.state.error;
    const looping = this.state.trips >= 2;
    const errMsg = String(err?.message || err || 'Unknown error');
    const errName = String(err?.name || 'Error');
    const appVer = (Constants as any).expoConfig?.version || '?';
    const buildNum = (Constants as any).expoConfig?.ios?.buildNumber
      || (Constants as any).nativeBuildVersion || 'dev';

    return (
      <View style={styles.root} testID="root-error-boundary">
        <ScrollView contentContainerStyle={styles.inner} showsVerticalScrollIndicator={false}>
          <Text style={styles.emoji}>⚠️</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.sub}>
            We hit an unexpected hiccup. Tap retry to try again — your data is safe.
          </Text>

          {looping ? (
            <Text style={styles.warn}>
              We've tried twice and it kept hiccuping. Sign out and restart usually clears this up.
            </Text>
          ) : null}

          <TouchableOpacity
            onPress={this.reset}
            style={styles.btn}
            testID="root-error-retry"
            activeOpacity={0.85}
          >
            <Text style={styles.btnTxt}>Retry</Text>
          </TouchableOpacity>

          {looping ? (
            <TouchableOpacity
              onPress={this.hardRecover}
              style={[styles.btn, styles.btnDanger]}
              testID="root-error-hard-recover"
              activeOpacity={0.85}
            >
              <Text style={styles.btnDangerTxt}>Sign out & restart</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            onPress={() => this.setState((s) => ({ showDetails: !s.showDetails }))}
            style={styles.detailsToggle}
            testID="root-error-toggle-details"
          >
            <Text style={styles.detailsToggleTxt}>
              {this.state.showDetails ? 'Hide details' : 'Show details'}
            </Text>
          </TouchableOpacity>

          {this.state.showDetails ? (
            <View style={styles.detailsBox}>
              <Text style={styles.detailsLabel}>Error</Text>
              <Text style={styles.detailsValue} selectable>
                {errName}: {errMsg}
              </Text>
              <Text style={styles.detailsLabel}>App</Text>
              <Text style={styles.detailsValue} selectable>
                LumaScout v{appVer} (build {buildNum}) · {Platform.OS} {Platform.Version}
              </Text>
              {this.state.componentStack ? (
                <>
                  <Text style={styles.detailsLabel}>Component stack</Text>
                  <Text style={styles.detailsStack} selectable>
                    {this.state.componentStack.split('\n').slice(0, 8).join('\n').trim()}
                  </Text>
                </>
              ) : null}
              {err?.stack ? (
                <>
                  <Text style={styles.detailsLabel}>Stack</Text>
                  <Text style={styles.detailsStack} selectable>
                    {err.stack.split('\n').slice(0, 8).join('\n').trim()}
                  </Text>
                </>
              ) : null}
              <TouchableOpacity onPress={this.copyErr} style={styles.copyBtn}>
                <Text style={styles.copyBtnTxt}>Show in alert (long-press to copy)</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  inner: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
  },
  emoji: { fontSize: 48, marginBottom: space.md },
  title: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 26,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  sub: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 15,
    textAlign: 'center',
    marginTop: space.sm,
    maxWidth: 320,
  },
  warn: {
    color: '#ffcc66',
    fontFamily: font.body,
    fontSize: 12.5,
    textAlign: 'center',
    marginTop: space.md,
    maxWidth: 320,
  },
  btn: {
    marginTop: space.xxl,
    paddingHorizontal: space.xxxl,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
    minWidth: 200,
    alignItems: 'center',
  },
  btnTxt: {
    color: colors.textInverse,
    fontFamily: font.bodyBold,
    fontSize: 15,
    letterSpacing: 0.3,
  },
  btnDanger: {
    marginTop: space.md,
    backgroundColor: 'rgba(208,72,72,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(208,72,72,0.55)',
  },
  btnDangerTxt: {
    color: '#ff8c8c',
    fontFamily: font.bodyBold,
    fontSize: 14,
  },
  detailsToggle: {
    marginTop: space.lg,
    paddingVertical: 6,
  },
  detailsToggleTxt: {
    color: colors.textTertiary,
    fontFamily: font.bodyMedium,
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  detailsBox: {
    marginTop: space.md,
    width: '100%',
    maxWidth: 460,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderRadius: 10,
    padding: space.md,
    gap: 4,
  },
  detailsLabel: {
    color: colors.textTertiary,
    fontFamily: font.bodyBold,
    fontSize: 9,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: space.sm,
  },
  detailsValue: {
    color: '#ff9696',
    fontFamily: font.body,
    fontSize: 12,
  },
  detailsStack: {
    color: colors.textSecondary,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 10.5,
    lineHeight: 14,
  },
  copyBtn: {
    marginTop: space.md,
    paddingVertical: 8,
    alignItems: 'center',
  },
  copyBtnTxt: {
    color: colors.primary,
    fontFamily: font.bodyBold,
    fontSize: 11,
    letterSpacing: 0.4,
  },
});
