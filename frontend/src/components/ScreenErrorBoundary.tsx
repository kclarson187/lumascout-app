/**
 * ScreenErrorBoundary — Batch #8 (May 2026)
 *
 * Per-screen error boundary so a single screen's render crash doesn't nuke
 * the whole app (which is RootErrorBoundary's job, but that's a
 * last-resort net). This one is scoped — wrap it around each top-level
 * tab / stack screen so the tab bar, drawer, and peers stay alive while
 * just that one view recovers.
 *
 * Why we don't reuse RootErrorBoundary: Root takes over the entire
 * app UI with its own full-screen "Something went wrong" view. That's
 * correct for a catastrophic crash but wrong for, say, a Community-tab
 * crash where the user should still be able to pop to Home, Explore,
 * or Profile via the tab bar.
 *
 * API mirrors RN's ErrorBoundary idioms:
 *   <ScreenErrorBoundary label="Community">
 *     <CommunityScreen />
 *   </ScreenErrorBoundary>
 *
 * Premium UX:
 *   • Calm dark surface with a single icon + title + body + two CTAs.
 *   • "Try again" resets internal state, re-mounts children.
 *   • "Back to home" routes to /.
 *   • Raw error message hidden except in __DEV__ where it helps debugging.
 *   • Logs real error + component stack to console.error so EAS / Sentry
 *     ingestors capture it.
 *   • Touch targets are 48+pt. Text uses LumaScout theme tokens.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { router } from 'expo-router';
import { AlertTriangle, ArrowLeft, RotateCcw } from 'lucide-react-native';
import { colors, radii, space, font } from '../theme';

type Props = {
  children: React.ReactNode;
  /** Used in the user-facing title + log tag. e.g. "Community", "Admin". */
  label: string;
  /** Optional override for the home action target. Defaults to '/'. */
  homeHref?: string;
  /** Hide the "Back to home" CTA (e.g. if already in a modal flow). */
  hideHomeAction?: boolean;
};
type State = { hasError: boolean; error?: Error };

export default class ScreenErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(
      `[ScreenErrorBoundary:${this.props.label}] render crash:`,
      error,
      info?.componentStack,
    );
  }

  reset = () => this.setState({ hasError: false, error: undefined });

  render() {
    if (!this.state.hasError) return this.props.children;

    const goHome = () => {
      try { router.replace((this.props.homeHref as any) || '/'); } catch { /* noop */ }
      this.reset();
    };

    return (
      <View style={styles.wrap} testID="screen-error-boundary">
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.iconWrap}>
            <AlertTriangle size={30} color={colors.primary} strokeWidth={1.5} />
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {this.props.label} hit a snag
          </Text>
          <Text style={styles.body}>
            Something on this screen ran into an unexpected error. You can try
            again or head back — the rest of LumaScout is still running.
          </Text>

          {/* Minimal error detail in dev only — production shows zero tech copy. */}
          {__DEV__ && this.state.error ? (
            <View style={styles.devBox}>
              <Text style={styles.devLabel}>DEV DETAILS</Text>
              <Text style={styles.devMsg}>{String(this.state.error.message || this.state.error)}</Text>
            </View>
          ) : null}

          <View style={styles.ctas}>
            <TouchableOpacity
              onPress={this.reset}
              style={[styles.btn, styles.btnPrimary]}
              accessibilityRole="button"
              testID="screen-error-retry"
            >
              <RotateCcw size={15} color={colors.textInverse} />
              <Text style={styles.btnPrimaryTxt}>Try again</Text>
            </TouchableOpacity>

            {!this.props.hideHomeAction ? (
              <TouchableOpacity
                onPress={goHome}
                style={[styles.btn, styles.btnGhost]}
                accessibilityRole="button"
                testID="screen-error-home"
              >
                <ArrowLeft size={15} color={colors.text} />
                <Text style={styles.btnGhostTxt}>Back to home</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.background },
  scroll: {
    flexGrow: 1, justifyContent: 'center', alignItems: 'center',
    padding: space.xl,
    gap: space.md },
  iconWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.35)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: space.md },
  title: {
    color: colors.text, fontFamily: font.headline, fontSize: 20,
    textAlign: 'center', marginTop: space.sm },
  body: {
    color: colors.textSecondary, fontFamily: font.body, fontSize: 14,
    lineHeight: 21, textAlign: 'center', maxWidth: 320 },
  devBox: {
    marginTop: space.lg,
    padding: space.md,
    backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.md,
    maxWidth: 360, width: '100%' },
  devLabel: {
    color: colors.textTertiary, fontFamily: font.bodyMedium,
    fontSize: 10 },
  devMsg: {
    color: colors.textSecondary, fontFamily: font.body,
    fontSize: 12, lineHeight: 17, marginTop: 4 },
  ctas: {
    flexDirection: 'row', gap: space.sm, marginTop: space.lg,
    flexWrap: 'wrap', justifyContent: 'center' },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    minHeight: Platform.OS === 'ios' ? 44 : 48,
    paddingHorizontal: space.lg,
    borderRadius: radii.pill },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryTxt: {
    color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },
  btnGhost: {
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border },
  btnGhostTxt: {
    color: colors.text, fontFamily: font.bodyMedium, fontSize: 14 } });
