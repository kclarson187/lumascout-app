/**
 * spot-detail/atoms.tsx
 * ─────────────────────
 *
 * Small leaf components for the spot-detail screen. Pulled out of
 * `app/spot/[id].tsx` on 2026-05-03 (v2.0.25 refactor) so the
 * parent file stays focused on orchestration + data flow.
 *
 * All three originally lived at the bottom of [id].tsx and were
 * module-private — no behavioural change, just a location move.
 * Shared style tokens come from `./styles` so visual changes remain
 * a single-file edit.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { styles } from './styles';

/**
 * Info grid cell — used 4-across in the "permit / fee / accessible /
 * crowd" quad-row underneath the scores grid. Tiny stat-card
 * primitive: icon + uppercase label + single-line value.
 */
export function InfoCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoCard}>
      {icon}
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

/**
 * Logistics row — the big amber-iconed rows under "Logistics" heading
 * (parking, drive-time, accessibility, etc.). Horizontal layout with
 * circular icon bubble on the left and a two-line text block on the
 * right (label uppercase / body sentence).
 */
export function LogisticsRow({
  icon,
  label,
  text,
}: {
  icon: React.ReactNode;
  label: string;
  text: string;
}) {
  return (
    <View style={styles.logRow}>
      <View style={styles.logIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.logLabel}>{label}</Text>
        <Text style={styles.logText}>{text}</Text>
      </View>
    </View>
  );
}

/**
 * Simple green pill badge — used for the "Permit", "Fee", "Dogs OK"
 * etc. summary chips in the spot-detail stats section.
 *
 * NOTE: named `Badge` for historical continuity inside this screen.
 * The global badge components (VerifiedBadge, FreshnessBadge, etc.)
 * live in `src/components/` and have richer prop shapes.
 */
export function Badge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}
