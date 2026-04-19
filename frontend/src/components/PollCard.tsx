import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Check, BarChart3 } from 'lucide-react-native';
import { api, formatApiError } from '../api';
import { colors, font, space, radii } from '../theme';

type PollOption = { index: number; text: string; votes: number };
type Poll = { options: PollOption[]; total_votes: number; my_vote_index?: number | null };

export default function PollCard({
  postId,
  poll,
  onChange,
}: {
  postId: string;
  poll: Poll;
  onChange?: (poll: Poll) => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const total = poll.total_votes || 0;
  const hasVoted = poll.my_vote_index != null;

  const vote = async (idx: number) => {
    if (busy !== null) return;
    setBusy(idx);
    try {
      const r = await api.post(`/posts/${postId}/vote`, { option_index: idx });
      if (r?.poll) onChange?.(r.poll);
    } catch (e) {
      Alert.alert('Could not vote', formatApiError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrap}>
      {poll.options.map((o) => {
        const pct = total > 0 ? Math.round((o.votes / total) * 100) : 0;
        const selected = poll.my_vote_index === o.index;
        return (
          <TouchableOpacity
            key={o.index}
            disabled={busy !== null}
            onPress={() => vote(o.index)}
            activeOpacity={0.85}
            style={[styles.opt, selected && styles.optSelected]}
            testID={`poll-opt-${postId}-${o.index}`}
          >
            {hasVoted && (
              <View style={[styles.fill, { width: `${pct}%` }, selected && { backgroundColor: 'rgba(245,166,35,0.22)' }]} />
            )}
            <View style={styles.optInner}>
              <View style={styles.optLeft}>
                {selected && <Check size={14} color={colors.primary} />}
                <Text style={[styles.optTxt, selected && { color: colors.text, fontFamily: font.bodyBold }]} numberOfLines={2}>{o.text}</Text>
              </View>
              {hasVoted && (
                <Text style={[styles.pctTxt, selected && { color: colors.primary }]}>{pct}%</Text>
              )}
            </View>
          </TouchableOpacity>
        );
      })}
      <View style={styles.meta}>
        <BarChart3 size={11} color={colors.textTertiary} />
        <Text style={styles.metaTxt}>{total} {total === 1 ? 'vote' : 'votes'}{!hasVoted ? ' · Tap to vote' : ''}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: space.sm },
  opt: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface1, overflow: 'hidden', position: 'relative' },
  optSelected: { borderColor: colors.primary },
  fill: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: 'rgba(255,255,255,0.06)' },
  optInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10 },
  optLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  optTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13, flex: 1 },
  pctTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 12, marginLeft: 10 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  metaTxt: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
});
