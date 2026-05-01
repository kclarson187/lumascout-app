/**
 * SectionErrorBoundary — May 2026.
 *
 * Lightweight, scoped error boundary that wraps individual Spot Detail
 * subsections (hero carousel, owner block, conditions, weather, reviews,
 * similar spots, rails, recent photos, etc.) so a single subsection
 * crash does NOT take down the entire spot detail screen.
 *
 * Behavior:
 *   • If the wrapped subtree throws during render, this boundary
 *     swallows the error and renders either a tiny inline placeholder
 *     ("This section is temporarily unavailable.") OR null when
 *     `hideOnError` is true (most cases — we'd rather hide a broken
 *     widget than draw attention to it).
 *   • Logs `[SectionErrorBoundary:{label}]` + the error + component
 *     stack to console.error so production crash reports / dev
 *     debugging can pinpoint which section died.
 *   • Does NOT navigate, does NOT reset state — the user can retry
 *     by pulling-to-refresh / re-opening the page.
 *
 * Why not reuse ScreenErrorBoundary?
 *   ScreenErrorBoundary takes over the entire screen with the
 *   "X hit a snag" full-bleed surface, which is the OPPOSITE of what
 *   we want here — we want the rest of the spot page to keep working.
 *
 * Usage:
 *   <SectionErrorBoundary label="hero-carousel">
 *     <HeroCarousel ... />
 *   </SectionErrorBoundary>
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, font, radii, space } from '../theme';

type Props = {
  children: React.ReactNode;
  /** Used in console.error tag and dev placeholder text. */
  label: string;
  /** Hide the placeholder entirely on error (returns null). Default true. */
  hideOnError?: boolean;
  /** Optional custom fallback to render in place of the default placeholder. */
  fallback?: React.ReactNode;
};
type State = { hasError: boolean; error?: Error };

export default class SectionErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(
      `[SectionErrorBoundary:${this.props.label}] subtree crash:`,
      error,
      info?.componentStack,
    );
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    if (this.props.hideOnError !== false) return null;
    return (
      <View style={s.placeholder}>
        <Text style={s.placeholderTxt}>This section is temporarily unavailable.</Text>
      </View>
    );
  }
}

const s = StyleSheet.create({
  placeholder: {
    marginVertical: space.sm,
    paddingVertical: 12,
    paddingHorizontal: space.md,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  placeholderTxt: {
    color: colors.textTertiary,
    fontFamily: font.body,
    fontSize: 12,
    textAlign: 'center',
  },
});
