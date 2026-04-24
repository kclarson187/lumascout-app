/**
 * SwipeableThreadRow — inbox row wrapped in a react-native-gesture-handler
 * Swipeable so users get native iMessage-style side actions.
 *
 *   Swipe LEFT  → Archive (amber)
 *   Swipe RIGHT → Pin / Unpin (gold)
 *
 * Tier 2 Messaging Upgrade (2026-04).
 */
import React, { useRef } from 'react';
import { View, Text, StyleSheet, Animated, Pressable } from 'react-native';
import { Swipeable, RectButton } from 'react-native-gesture-handler';
import { Archive, Pin, PinOff } from 'lucide-react-native';
import { font } from '../theme';

export default function SwipeableThreadRow({
  children,
  isPinned,
  onArchive,
  onTogglePin,
  testID,
}: {
  children: React.ReactNode;
  isPinned?: boolean;
  onArchive?: () => void;
  onTogglePin?: () => void;
  testID?: string;
}) {
  const ref = useRef<Swipeable | null>(null);
  const close = () => ref.current?.close();

  const renderRight = (_progress: Animated.AnimatedInterpolation<number>, dragX: Animated.AnimatedInterpolation<number>) => {
    const scale = dragX.interpolate({
      inputRange: [-120, 0],
      outputRange: [1, 0.6],
      extrapolate: 'clamp',
    });
    return (
      <RectButton
        style={[s.action, s.actionArchive]}
        onPress={() => { close(); onArchive?.(); }}
        testID={testID ? `${testID}-swipe-archive` : undefined}
      >
        <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
          <Archive size={18} color="#fff" />
          <Text style={s.actionTxt}>Archive</Text>
        </Animated.View>
      </RectButton>
    );
  };

  const renderLeft = (_progress: Animated.AnimatedInterpolation<number>, dragX: Animated.AnimatedInterpolation<number>) => {
    const scale = dragX.interpolate({
      inputRange: [0, 120],
      outputRange: [0.6, 1],
      extrapolate: 'clamp',
    });
    return (
      <RectButton
        style={[s.action, s.actionPin]}
        onPress={() => { close(); onTogglePin?.(); }}
        testID={testID ? `${testID}-swipe-pin` : undefined}
      >
        <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
          {isPinned ? <PinOff size={18} color="#1a1300" /> : <Pin size={18} color="#1a1300" />}
          <Text style={[s.actionTxt, { color: '#1a1300' }]}>{isPinned ? 'Unpin' : 'Pin'}</Text>
        </Animated.View>
      </RectButton>
    );
  };

  return (
    <Swipeable
      ref={ref}
      renderRightActions={onArchive ? renderRight : undefined}
      renderLeftActions={onTogglePin ? renderLeft : undefined}
      overshootLeft={false}
      overshootRight={false}
      friction={2}
      rightThreshold={40}
      leftThreshold={40}
    >
      <View>{children}</View>
    </Swipeable>
  );
}

const s = StyleSheet.create({
  action: {
    width: 96,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionArchive: {
    backgroundColor: '#d97706', // amber-600
  },
  actionPin: {
    backgroundColor: '#f5a623', // gold
  },
  actionTxt: {
    color: '#fff',
    fontFamily: font.bodyBold,
    fontSize: 11,
    marginTop: 4,
    letterSpacing: 0.4,
  },
});
