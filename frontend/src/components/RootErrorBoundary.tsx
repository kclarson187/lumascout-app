/**
 * RootErrorBoundary — class-component error boundary mounted at the very
 * root of the Expo app.
 *
 * Why we need it:
 *   Without this, ANY uncaught render error (e.g. accessing `.length` on an
 *   undefined cached payload, a stale `user.plan` shape, a Reanimated worklet
 *   throwing) crashes the entire navigator to a blank black screen with no
 *   recovery path. Apple App Review rejects this.
 *
 * Behavior:
 *   • Catches errors during render, lifecycle, and constructors of children.
 *   • Shows a calm dark-mode "Something went wrong" screen with a retry
 *     button that re-mounts the children by resetting internal state.
 *   • In __DEV__ shows the error message to make local debugging easier.
 *   • Logs to console.error so EAS / Sentry style ingestors can pick it up.
 *
 * Notes:
 *   • Only render-time errors are caught. Async rejections in event handlers
 *     and useEffect promises still need their own try/catch (most call
 *     sites already do this via formatApiError).
 *   • Reset is a *full state reset* — the user lands back on whatever the
 *     auth-gate sends them to (usually Home).
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { colors, font, space } from '../theme';

type Props = { children: React.ReactNode };
type State = { hasError: boolean; error?: Error };

export default class RootErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[RootErrorBoundary] Uncaught render error:', error, info?.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.root} testID="root-error-boundary">
        <ScrollView contentContainerStyle={styles.inner} showsVerticalScrollIndicator={false}>
          <Text style={styles.emoji}>⚠️</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.sub}>
            We hit an unexpected hiccup. Tap retry to try again — your data is safe.
          </Text>
          {__DEV__ && this.state.error ? (
            <Text style={styles.devErr} selectable>
              {String(this.state.error?.message || this.state.error)}
            </Text>
          ) : null}
          <TouchableOpacity onPress={this.reset} style={styles.btn} testID="root-error-retry">
            <Text style={styles.btnTxt}>Retry</Text>
          </TouchableOpacity>
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
  devErr: {
    color: '#ff8c8c',
    fontFamily: font.body,
    fontSize: 12,
    textAlign: 'center',
    marginTop: space.lg,
    paddingHorizontal: space.md,
  },
  btn: {
    marginTop: space.xxl,
    paddingHorizontal: space.xxxl,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  btnTxt: {
    color: colors.textInverse,
    fontFamily: font.bodyBold,
    fontSize: 15,
    letterSpacing: 0.3,
  },
});
