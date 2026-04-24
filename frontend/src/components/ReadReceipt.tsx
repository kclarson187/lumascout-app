/**
 * ReadReceipt — renders the per-message read state beneath outbound
 * bubbles. Three visual states per the UX spec:
 *
 *   ✓        → Sent (delivered_at is null — the message hasn't hit the
 *                recipient's device; in practice rare because we stamp
 *                delivered_at at insert time alongside the push dispatch).
 *   ✓✓       → Delivered (delivered_at stamped, seen_at still null).
 *   Seen <t> → seen_at stamped. Ticks become blue-ish accent.
 *
 * Renders the timestamp on the Seen state only (per PRD: "Seen 2:14 PM").
 * Other states fall back to the bubble's created_at timestamp handled
 * outside this component.
 *
 * Tier 1 Messaging Upgrade (2026-04).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Check, CheckCheck } from 'lucide-react-native';
import { font } from '../theme';

function fmtClock(iso?: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function ReadReceipt({
  deliveredAt,
  seenAt,
  mine,
  onTint = 'rgba(255,255,255,0.85)',
  mutedTint = 'rgba(255,255,255,0.55)',
  seenTint = '#7dd3fc', // soft sky blue — reads as "activated" on amber bubbles
  showSeenTimestamp = true,
}: {
  deliveredAt?: string | null;
  seenAt?: string | null;
  mine: boolean;
  onTint?: string;
  mutedTint?: string;
  seenTint?: string;
  showSeenTimestamp?: boolean;
}) {
  if (!mine) return null; // read receipts only shown on outbound messages
  const isSeen = !!seenAt;
  const isDelivered = !!deliveredAt;

  if (isSeen) {
    return (
      <View style={styles.row}>
        <CheckCheck size={11} color={seenTint} strokeWidth={2.5} />
        <Text style={[styles.txt, { color: seenTint }]}>
          {showSeenTimestamp ? `Seen ${fmtClock(seenAt)}` : 'Seen'}
        </Text>
      </View>
    );
  }
  if (isDelivered) {
    return (
      <View style={styles.row}>
        <CheckCheck size={11} color={mutedTint} strokeWidth={2} />
        <Text style={[styles.txt, { color: mutedTint }]}>Delivered</Text>
      </View>
    );
  }
  return (
    <View style={styles.row}>
      <Check size={11} color={mutedTint} strokeWidth={2} />
      <Text style={[styles.txt, { color: mutedTint }]}>Sent</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
    alignSelf: 'flex-end',
  },
  txt: {
    fontFamily: font.bodyMedium,
    fontSize: 10,
  },
});
