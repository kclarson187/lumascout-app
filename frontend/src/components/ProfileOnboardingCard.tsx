/**
 * ProfileOnboardingCard — Jun 2025 redesign.
 *
 * Replaces the older character-count "Complete your profile" progress
 * card on the Profile tab. Four clear, single-purpose steps a creator
 * can actually finish in the first session:
 *
 *   1. Add Photo      — avatar / banner image
 *   2. Write Bio      — short blurb (>= 12 chars)
 *   3. Upload a Spot  — first contribution
 *   4. Share Profile  — first share tap (local AsyncStorage flag)
 *
 * Behaviour:
 *   • Each step row shows a lucide icon inside a subtle gold-tinted
 *     circle. Completed steps swap the icon for a Check and dim the
 *     row's typography for a "done" feel.
 *   • Tapping an incomplete step calls the matching `on*` callback
 *     so the host screen can route to upload / bio / share flow.
 *   • Once all 4 steps are complete, the component renders `null` so
 *     the screen returns to clean profile content (no celebration
 *     state per design ask).
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import {
  Camera,
  PenLine,
  MapPinPlus,
  Share2,
  Check,
  ChevronRight,
} from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';

export interface ProfileOnboardingProps {
  /** Per-step completion flags (computed by the host screen). */
  hasAvatar: boolean;
  hasBio: boolean;
  hasSpot: boolean;
  hasShared: boolean;
  /** Step callbacks. Only called when the step is incomplete. */
  onAddPhoto?: () => void;
  onWriteBio?: () => void;
  onUploadSpot?: () => void;
  onShareProfile?: () => void;
}

type StepDef = {
  key: 'photo' | 'bio' | 'spot' | 'share';
  title: string;
  sub: string;
  Icon: any;
  done: boolean;
  onPress?: () => void;
};

export function ProfileOnboardingCard({
  hasAvatar,
  hasBio,
  hasSpot,
  hasShared,
  onAddPhoto,
  onWriteBio,
  onUploadSpot,
  onShareProfile,
}: ProfileOnboardingProps) {
  const steps: StepDef[] = [
    { key: 'photo', title: 'Add photo',      sub: 'Upload a profile picture',     Icon: Camera,     done: hasAvatar, onPress: onAddPhoto },
    { key: 'bio',   title: 'Write bio',      sub: 'A short line about your work', Icon: PenLine,    done: hasBio,    onPress: onWriteBio },
    { key: 'spot',  title: 'Upload a spot',  sub: 'Share your first location',    Icon: MapPinPlus, done: hasSpot,   onPress: onUploadSpot },
    { key: 'share', title: 'Share profile',  sub: 'Invite people to discover you',Icon: Share2,     done: hasShared, onPress: onShareProfile },
  ];

  // Hide entirely when complete — per design, do not show a celebration
  // state; let the profile return to its normal content.
  const completed = steps.filter(s => s.done).length;
  if (completed === steps.length) return null;

  const pct = Math.round((completed / steps.length) * 100);

  return (
    <View style={styles.card} testID="profile-onboarding-card">
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Get started</Text>
          <Text style={styles.title}>Set up your creator profile</Text>
        </View>
        <View style={styles.progressBadge}>
          <Text style={styles.progressTxt}>{completed}/{steps.length}</Text>
        </View>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>

      <View style={{ gap: 8, marginTop: 14 }}>
        {steps.map((s) => (
          <StepRow key={s.key} step={s} />
        ))}
      </View>
    </View>
  );
}

function StepRow({ step }: { step: StepDef }) {
  const { Icon, title, sub, done, onPress } = step;
  const C: any = !done && onPress ? TouchableOpacity : View;

  return (
    <C
      onPress={!done ? onPress : undefined}
      style={[styles.stepRow, done && styles.stepRowDone]}
      activeOpacity={0.85}
      testID={`profile-onboarding-step-${step.key}`}
    >
      <View style={[styles.stepIconCircle, done && styles.stepIconCircleDone]}>
        {done
          ? <Check size={14} color={colors.primary} />
          : <Icon size={14} color={colors.primary} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.stepTitle, done && styles.stepTitleDone]} numberOfLines={1}>{title}</Text>
        <Text style={[styles.stepSub, done && styles.stepSubDone]} numberOfLines={1}>{sub}</Text>
      </View>
      {!done && onPress ? (
        <ChevronRight size={16} color={colors.textTertiary} />
      ) : null}
    </C>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: space.xl,
    marginTop: space.lg,
    padding: space.lg,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.22)',
    borderRadius: radii.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  kicker: {
    color: colors.kicker,
    fontFamily: font.bodySemibold,
    fontSize: 10,
    letterSpacing: 0.4,
  },
  title: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 20,
    letterSpacing: -0.3,
    marginTop: 2,
  },
  progressBadge: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.32)',
  },
  progressTxt: {
    color: colors.primary,
    fontFamily: font.bodySemibold,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  progressTrack: {
    marginTop: 12,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },

  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  stepRowDone: {
    backgroundColor: 'rgba(255,255,255,0.015)',
    borderColor: 'rgba(255,255,255,0.04)',
  },
  stepIconCircle: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.32)',
  },
  stepIconCircleDone: {
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderColor: 'rgba(245,166,35,0.22)',
  },
  stepTitle: {
    color: colors.text,
    fontFamily: font.bodySemibold,
    fontSize: 13.5,
  },
  stepTitleDone: {
    color: colors.textSecondary,
    textDecorationLine: 'line-through',
    textDecorationColor: 'rgba(255,255,255,0.25)',
  },
  stepSub: {
    color: colors.textTertiary,
    fontFamily: font.body,
    fontSize: 11.5,
    marginTop: 1,
  },
  stepSubDone: {
    color: colors.textTertiary,
  },
});

export default ProfileOnboardingCard;
