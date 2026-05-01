/**
 * ExploreErrorBoundary (Apr 2026 — Explore-tab hardening pass).
 *
 * Wraps the entire Explore tab content (search bar, filter sheet, map,
 * markers, bottom sheets, list — everything below the route header) so
 * that a single bad pin, malformed spot, or runaway filter computation
 * NEVER blanks the whole tab. Instead the user gets a tasteful
 * "Something went wrong" card with a "Reload Explore" button that
 * resets the boundary and re-mounts the children.
 *
 * Why a dedicated boundary (vs. the global RootErrorBoundary)
 * -----------------------------------------------------------
 * The root boundary catches truly fatal errors and shows a global
 * fallback that requires a force-quit. For Explore — the most heavily
 * trafficked screen — we want a SOFT recovery that:
 *   · keeps the tab bar visible,
 *   · keeps the user logged in,
 *   · lets them switch tabs and come back without re-launching,
 *   · and crucially, lets them tap "Reload Explore" to retry without
 *     losing other app state.
 *
 * Telemetry
 * ---------
 * On catch, logs a structured breadcrumb to console (will be picked up
 * by Sentry once SENTRY_DSN is configured) including:
 *   · error.message + componentStack
 *   · `spotsCount` (provided by the parent via prop)
 *   · `activeFilters` (provided by the parent via prop)
 * This lets us correlate crashes with specific data shapes without
 * shipping a full breadcrumb library yet.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { AlertTriangle, RotateCcw } from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';
import { api } from '../api';

type Telemetry = {
  spotsCount?: number;
  activeFilters?: Record<string, any> | null;
};

type Props = React.PropsWithChildren<Telemetry & {
  /**
   * Optional onReset callback — the parent may want to refetch /spots
   * before remounting children so a stale-data crash doesn't loop.
   */
  onReset?: () => void;
}>;

type State = { hasError: boolean; message: string };

export default class ExploreErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || 'Unknown error' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Structured breadcrumb so a Sentry hook (when added) can pick it
    // up automatically AND a plain console reader can grep for it.
    // Only the FIRST level of `activeFilters` is logged to avoid
    // accidentally spilling user data — we just need the keys + truthy
    // values to identify which combination tripped the bug.
    const { spotsCount, activeFilters } = this.props;
    const filterKeys = activeFilters
      ? Object.entries(activeFilters)
          .filter(([, v]) => v != null && v !== false && v !== '')
          .map(([k]) => k)
      : [];
    // eslint-disable-next-line no-console
    console.error('[Explore] caught render error', {
      message: error?.message,
      stack: (error?.stack || '').split('\n').slice(0, 5).join('\n'),
      componentStack: (info?.componentStack || '').split('\n').slice(0, 8).join('\n'),
      spotsCount: typeof spotsCount === 'number' ? spotsCount : -1,
      activeFilterKeys: filterKeys,
    });
    // CR #1 · Ticket #6 — fire-and-forget POST to our own backend so
    // we have server-side visibility of /explore crashes during the
    // 48-hour staging soak. Never await, never throw: telemetry must
    // not affect the fallback UI's ability to render.
    try {
      api.post('/errors', {
        surface: 'explore',
        message: error?.message || 'Unknown error',
        stack: (error?.stack || '').split('\n').slice(0, 20).join('\n'),
        component_stack: (info?.componentStack || '').split('\n').slice(0, 20).join('\n'),
        context: {
          spotsCount: typeof spotsCount === 'number' ? spotsCount : -1,
          activeFilterKeys: filterKeys,
        },
        route: '/explore',
        platform: Platform.OS,
      }).catch(() => {});
    } catch {}
    // If a Sentry SDK is mounted globally (set up in _layout.tsx in the
    // future), forward the breadcrumb so we get web-side reports too.
    try {
      const w = globalThis as any;
      if (w?.Sentry?.captureException) {
        w.Sentry.captureException(error, {
          tags: { surface: 'explore' },
          extra: { spotsCount, activeFilterKeys: filterKeys },
        });
      }
    } catch {}
  }

  reset = () => {
    this.setState({ hasError: false, message: '' });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.hasError) return this.props.children as any;
    return (
      <View style={styles.wrap}>
        <View style={styles.iconBubble}>
          <AlertTriangle size={22} color={colors.warning} />
        </View>
        <Text style={styles.title}>Explore had a hiccup</Text>
        <Text style={styles.body} numberOfLines={4}>
          We caught the issue before it crashed the app. Tap below to reload.
        </Text>
        {!!this.state.message && (
          <Text style={styles.detail} numberOfLines={3}>
            {this.state.message}
          </Text>
        )}
        <Pressable onPress={this.reset} style={styles.btn} testID="explore-error-reset">
          <RotateCcw size={15} color="#000" />
          <Text style={styles.btnTxt}>Reload Explore</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: space.xl, gap: 12, backgroundColor: colors.bg,
  },
  iconBubble: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(251,191,36,0.14)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.warning,
  },
  title: { color: colors.text, fontFamily: font.display, fontSize: 18 },
  body: {
    color: colors.textSecondary, fontFamily: font.body,
    fontSize: 13, lineHeight: 18, textAlign: 'center',
  },
  detail: {
    color: colors.textTertiary, fontFamily: font.body,
    fontSize: 11, lineHeight: 15, textAlign: 'center',
  },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: colors.primary, borderRadius: radii.pill,
    marginTop: 4,
  },
  btnTxt: { color: '#000', fontFamily: font.bodyBold, fontSize: 13 },
});
