/**
 * ReadReceipt — renders the per-message delivery / read state beneath
 * outbound bubbles.
 *
 * UX spec (May 2026 update — simplification pass)
 * ───────────────────────────────────────────────
 * Two visible states only, no timestamps:
 *
 *   ✓✓  Delivered → message reached the recipient's device(s).
 *                   `delivered_at` is stamped at insert time alongside
 *                   the push dispatch in /api/dm/threads/{id}/messages.
 *
 *   ✓✓  Read     → recipient OPENED THE THREAD that contains this
 *                   message. `seen_at` is stamped server-side by
 *                   /api/dm/threads/{id}/mark-read, which is called
 *                   only from the thread-detail screen's mount effect
 *                   (NOT from inbox preview, push-preview, badge poll,
 *                   background refresh, or any passive fetch path).
 *
 * What we deliberately removed in May 2026
 * ────────────────────────────────────────
 *   • The "Sent" (single ✓) state. UX feedback was that it surfaced
 *     a transient internal-state distinction users don't care about
 *     — every successful send instantly stamps `delivered_at` server-
 *     side, so the gap between "sent" and "delivered" is sub-second.
 *     If a true unsent state ever exists (network failure → retry),
 *     the bubble already shows a separate retry chip elsewhere.
 *
 *   • Visible timestamps on Delivered / Read. The bubble itself
 *     already shows `created_at` per the chat layout; surfacing a
 *     SECOND timestamp underneath made the receipt area noisy and
 *     inconsistent with how the rest of the conversation reads.
 *     The timestamps still exist server-side (`delivered_at`,
 *     `seen_at`) so any analytics / debugging that needs them is
 *     unaffected — only the visible bubble is simplified.
 *
 * Backend fields consumed
 * ───────────────────────
 *   deliveredAt → first device receipt; populated by
 *     /api/dm/threads/{id}/messages on insert.
 *   seenAt      → recipient opened the thread; populated by
 *     /api/dm/threads/{id}/mark-read which runs ONCE per thread open.
 *
 * Tier 1 Messaging Upgrade (2026-04). Simplification pass (2026-05).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CheckCheck } from 'lucide-react-native';
import { font } from '../theme';

export default function ReadReceipt({
  deliveredAt,
  seenAt,
  mine,
  // Tints kept as props so the chat screen can theme the receipts to
  // match the bubble color scheme without forking this component.
  mutedTint = 'rgba(255,255,255,0.55)',
  seenTint = '#7dd3fc', // soft sky blue — reads as "activated" on amber bubbles
}: {
  deliveredAt?: string | null;
  seenAt?: string | null;
  mine: boolean;
  mutedTint?: string;
  seenTint?: string;
}) {
  // Receipts only show on outbound messages — there's nothing the
  // recipient can learn from seeing their own message marked Read.
  if (!mine) return null;

  const isSeen = !!seenAt;
  const isDelivered = !!deliveredAt;

  // Read state — recipient has opened the thread.
  if (isSeen) {
    return (
      <View style={styles.row}>
        <CheckCheck size={11} color={seenTint} strokeWidth={2.5} />
        <Text style={[styles.txt, { color: seenTint }]}>Read</Text>
      </View>
    );
  }
  // Delivered state — message hit the recipient's device(s).
  if (isDelivered) {
    return (
      <View style={styles.row}>
        <CheckCheck size={11} color={mutedTint} strokeWidth={2} />
        <Text style={[styles.txt, { color: mutedTint }]}>Delivered</Text>
      </View>
    );
  }
  // Pre-delivery state — by spec we render NOTHING here. The bubble's
  // own retry/error UI (handled at the message level) covers any rare
  // case where delivery fails outright. Showing a "Sent" placeholder
  // here would just add visual noise for the sub-second window before
  // delivered_at gets stamped.
  return null;
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
