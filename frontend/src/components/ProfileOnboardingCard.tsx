/**
 * ProfileOnboardingCard — Jun 2025 refresh.
 *
 * Lightweight, low-dominance "Set up your creator profile" card shown
 * on the Profile tab. Three single-purpose steps:
 *
 *   1. Profile image   — avatar upload
 *   2. Cover image     — banner upload
 *   3. Bio             — short blurb (>= 12 chars)
 *
 * Behaviour:
 *   • Each step row shows a small lucide icon inside a subtle gold
 *     tinted circle. Completed steps swap the icon for a Check and
 *     dim the row's typography.
 *   • Tapping an incomplete step calls the matching `on*` callback so
 *     the host screen can route to the right edit flow.
 *   • Once `hasProfileImage && hasCoverImage && hasBio` is true the
 *     component renders `null` (auto-hide) so the profile returns to
 *     clean content. No celebration state by design.
 *
 * Visual notes vs. previous version:
 *   • Removed the "Upload a spot" and "Share Profile" steps.
 *   • Smaller title, tighter padding, shorter icon circles, lighter
 *     border so the card no longer dominates the profile screen.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import {
  Camera,
  ImagePlus,
  PenLine,
  Check,
  ChevronRight,
} from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';

export interface ProfileOnboardingProps {
  /** Per-step completion flags (computed by the host screen). */
  hasProfileImage: boolean;
  hasCoverImage: boolean;
  hasBio: boolean;
  /** Step callbacks. Only called when the step is incomplete. */
  onAddProfileImage?: () => void;
  onAddCoverImage?: () => void;
  onWriteBio?: () => void;
}

type StepDef = {
  key: 'profile' | 'cover' | 'bio';
  title: string;
  sub: string;
  Icon: any;
  done: boolean;
  onPress?: () => void;
};

export function ProfileOnboardingCard({
  hasProfileImage,
  hasCoverImage,
  hasBio,
  onAddProfileImage,
  onAddCoverImage,
  onWriteBio,
}: ProfileOnboardingProps) {
  const steps: StepDef[] = [
    { key: 'profile', title: 'Profile image', sub: 'Upload a profile picture',    Icon: Camera,     done: hasProfileImage, onPress: onAddProfileImage },
    { key: 'cover',   title: 'Cover image',   sub: 'Add a banner for your page',  Icon: ImagePlus,  done: hasCoverImage,   onPress: onAddCoverImage },
    { key: 'bio',     title: 'Short bio',     sub: 'A line about your work',      Icon: PenLine,    done: hasBio,          onPress: onWriteBio },
  ];

  // Auto-hide entirely when the 3 required steps are complete.
  const isComplete = hasProfileImage && hasCoverImage && hasBio;
  if (isComplete) return null;

  const completed = steps.filter(s => s.done).length;
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

      <View style={styles.stepsList}>
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
          ? <Check size={12} color={colors.primary} />
          : <Icon size={12} color={colors.primary} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.stepTitle, done && styles.stepTitleDone]} numberOfLines={1}>{title}</Text>
        <Text style={[styles.stepSub, done && styles.stepSubDone]} numberOfLines={1}>{sub}</Text>
      </View>
      {!done && onPress ? (
        <ChevronRight size={14} color={colors.textTertiary} />
      ) : null}
    </C>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: space.xl,
    marginTop: space.md,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.16)',
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
    fontSize: 9,
    letterSpacing: 0.4,
  },
  title: {
    color: colors.text,
    fontFamily: font.bodySemibold,
    fontSize: 14,
    letterSpacing: -0.1,
    marginTop: 1,
  },
  progressBadge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(245,166,35,0.10)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.26)',
  },
  progressTxt: {
    color: colors.primary,
    fontFamily: font.bodySemibold,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  progressTrack: {
    marginTop: 10,
    height: 2,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 2,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  stepsList: {
    gap: 6,
    marginTop: 10,
  },

  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  stepRowDone: {
    backgroundColor: 'rgba(255,255,255,0.012)',
    borderColor: 'rgba(255,255,255,0.035)',
  },
  stepIconCircle: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.28)',
  },
  stepIconCircleDone: {
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderColor: 'rgba(245,166,35,0.18)',
  },
  stepTitle: {
    color: colors.text,
    fontFamily: font.bodySemibold,
    fontSize: 12.5,
  },
  stepTitleDone: {
    color: colors.textSecondary,
    textDecorationLine: 'line-through',
    textDecorationColor: 'rgba(255,255,255,0.25)',
  },
  stepSub: {
    color: colors.textTertiary,
    fontFamily: font.body,
    fontSize: 10.5,
    marginTop: 0,
  },
  stepSubDone: {
    color: colors.textTertiary,
  },
});

export default ProfileOnboardingCard;
