/**
 * ScoutAICard — reusable entry-point card for the Scout AI assistant.
 * Drops into Home / Explore / Saved / Spot-detail / Upload flows.
 * Every entry clearly labels Scout AI as an **Official AI** assistant.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Sparkles, ChevronRight } from 'lucide-react-native';
import ScoutAIAvatar from './ScoutAIAvatar';
import { colors, font, space, radii } from '../theme';

type Placement = 'home' | 'explore' | 'saved' | 'upload' | 'spot_detail';

type Props = {
  placement: Placement;
  prompt?: string;
  title?: string;
  subtitle?: string;
  spotId?: string;
  variant?: 'card' | 'row';
};

const COPY: Record<Placement, { title: string; subtitle: string; prompt: string }> = {
  home: {
    title: 'Ask Scout AI',
    subtitle: 'Find spots, plan shoots, explain scores.',
    prompt: 'Where should I shoot this weekend?',
  },
  explore: {
    title: 'Ask Scout AI for hidden gems nearby',
    subtitle: 'Describe the shoot type and Scout will suggest matches.',
    prompt: 'Find me low-crowd sunset portrait spots nearby',
  },
  saved: {
    title: "Which saved spot fits tonight's shoot?",
    subtitle: 'Scout AI compares your saves by time, distance, and fit.',
    prompt: "Which of my saved spots is best for tonight's golden hour?",
  },
  upload: {
    title: 'Scout AI can help with this upload',
    subtitle: 'Write the description, pick privacy, suggest notes.',
    prompt: 'Help me write a better description for this spot',
  },
  spot_detail: {
    title: 'Ask Scout AI about this spot',
    subtitle: 'Fit-for-shoot, best light, comparisons nearby.',
    prompt: 'Does this spot fit a family session?',
  },
};

export default function ScoutAICard({
  placement,
  prompt,
  title,
  subtitle,
  spotId,
  variant = 'card',
}: Props) {
  const copy = COPY[placement];
  const go = () => {
    const params: Record<string, string> = { placement };
    if (spotId) params.spot_id = spotId;
    if (prompt || copy.prompt) params.q = prompt || copy.prompt;
    router.push({ pathname: '/scout-ai', params } as any);
  };
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={go}
      style={[styles.card, variant === 'row' && styles.row]}
      testID={`scout-ai-${placement}`}
    >
      <View style={styles.avatarWrap}>
        <ScoutAIAvatar size={variant === 'row' ? 34 : 42} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{title || copy.title}</Text>
          <View style={styles.aiBadge}>
            <Sparkles size={9} color={colors.primary} />
            <Text style={styles.aiBadgeTxt}>OFFICIAL AI</Text>
          </View>
        </View>
        <Text style={styles.subtitle} numberOfLines={2}>{subtitle || copy.subtitle}</Text>
      </View>
      <ChevronRight size={16} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: space.md,
  },
  row: { paddingVertical: 10, borderRadius: radii.md },
  avatarWrap: { borderRadius: 999, overflow: 'hidden' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  title: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13, flexShrink: 1 },
  aiBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 5, paddingVertical: 1, borderRadius: radii.pill,
    backgroundColor: 'rgba(245,166,35,0.14)', borderWidth: 1, borderColor: colors.primary,
  },
  aiBadgeTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 8, letterSpacing: 0.6 },
  subtitle: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, lineHeight: 15, marginTop: 2 },
});
