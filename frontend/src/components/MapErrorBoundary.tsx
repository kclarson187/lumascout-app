/**
 * MapErrorBoundary — local React error boundary for the Map subtree.
 *
 * Stability requirement (Nov 2026): map crashes must not take down
 * the whole Explore tab. This boundary wraps ONLY the MapView region
 * (and its markers); the list view, header, filters, etc. live OUTSIDE.
 *
 * Fallback UI:
 *   Title:    "Map could not be loaded."
 *   Subtitle: "Try again or switch back to list view."
 *   Buttons:  [Try Again] [View List]
 *
 *   • Try Again → bumps an internal `key`, remounting the map subtree.
 *   • View List → calls onViewList prop (Explore screen toggles mode).
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';

type Props = {
  children: React.ReactNode;
  onViewList?: () => void;
};

type State = {
  hasError: boolean;
  key: number;
};

export class MapErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, key: 0 };

  static getDerivedStateFromError(_err: Error): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Dev-only: surface the stack so the engineer sees what blew up.
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[MapErrorBoundary] map crashed:', error?.message, info?.componentStack);
    }
  }

  tryAgain = () => {
    // Bump key → React unmounts the previous map subtree and mounts a
    // fresh instance. Combined with the validator + cap, this typically
    // recovers from transient native errors (e.g. a region with NaN).
    this.setState((s) => ({ hasError: false, key: s.key + 1 }));
  };

  viewList = () => {
    this.setState({ hasError: false });
    this.props.onViewList?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.wrap}>
          <View style={styles.iconWrap}>
            <AlertTriangle size={22} color={colors.warning} />
          </View>
          <Text style={styles.title}>Map could not be loaded.</Text>
          <Text style={styles.sub}>Try again or switch back to list view.</Text>
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.btnGhost} onPress={this.viewList} testID="map-eb-viewlist">
              <Text style={styles.btnGhostTxt}>View List</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnPrimary} onPress={this.tryAgain} testID="map-eb-retry">
              <Text style={styles.btnPrimaryTxt}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    // The `key` triggers a clean remount of the map subtree on Try Again.
    return <React.Fragment key={this.state.key}>{this.props.children}</React.Fragment>;
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: space.xl, gap: 10,
    backgroundColor: colors.bg,
  },
  iconWrap: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(251,191,36,0.16)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  title: { color: colors.text, fontFamily: font.display, fontSize: 18, textAlign: 'center' },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center', maxWidth: 280 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  btnGhost: {
    paddingHorizontal: 18, paddingVertical: 11, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  btnGhostTxt: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  btnPrimary: {
    paddingHorizontal: 18, paddingVertical: 11, borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  btnPrimaryTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 13 },
});

export default MapErrorBoundary;
