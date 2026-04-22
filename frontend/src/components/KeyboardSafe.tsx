/**
 * KeyboardSafe.tsx — canonical keyboard-safe wrapper for LumaScout.
 *
 * WHY THIS EXISTS
 * ---------------
 * Commit 7.6 (2026-04): every form screen in the app had its own bespoke
 * `KeyboardAvoidingView` block, with inconsistent `behavior` props (some
 * used `'height'` on Android, some passed `undefined` which is effectively
 * "do nothing"), and zero tap-outside-to-dismiss anywhere. Users reported
 * the on-screen keyboard covering inputs so they couldn't see what they
 * were typing — "makes the app feel broken/unpolished."
 *
 * This wrapper encapsulates the right pattern in one place so any screen
 * can adopt it by replacing its outer <View> with <KeyboardSafe>. No
 * hand-rolling, no drift over time.
 *
 * PATTERNS COVERED
 * ----------------
 *  - iOS uses `behavior="padding"` (adds padding equal to keyboard height).
 *  - Android uses `behavior="height"` in combination with the app.json
 *    `softwareKeyboardLayoutMode: "resize"` we set in Commit 7.5. Note
 *    that the app.json setting only applies to dev-client / standalone
 *    builds — Expo Go ignores it. If a user reports keyboard overlap
 *    while testing via Expo Go on Android, they need to test on a
 *    standalone/dev-client build before treating it as a real bug.
 *  - `keyboardShouldPersistTaps="handled"` lets children (like buttons and
 *    text links inside the scroll view) receive taps even when the
 *    keyboard is up, without swallowing outside-tap dismisses.
 *  - `TouchableWithoutFeedback` wraps the scroll content so tapping any
 *    blank area dismisses the keyboard. Inputs, buttons, and pressables
 *    still work normally.
 *  - `keyboardVerticalOffset` lets screens with a sticky header pass a
 *    pixel offset to compensate for the header height.
 *
 * USAGE
 * -----
 *   <KeyboardSafe>
 *     <Header />
 *     ...inputs and form content...
 *     <Footer />
 *   </KeyboardSafe>
 *
 * For screens with a custom header that shouldn't scroll, put the header
 * OUTSIDE the KeyboardSafe wrapper.
 *
 * For bottom-docked inputs (chat composer, etc.), use the <KeyboardSafeDocked>
 * variant below which keeps the input pinned above the keyboard without
 * scrolling the history.
 */

import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleProp,
  TouchableWithoutFeedback,
  Keyboard,
  View,
  ViewStyle,
  ScrollViewProps,
} from 'react-native';

export type KeyboardSafeProps = {
  children: React.ReactNode;
  /** Extra bottom padding below content so Save/Submit buttons are reachable. */
  bottomInset?: number;
  /** Pixel offset when the screen has a sticky header outside the wrapper. */
  keyboardVerticalOffset?: number;
  /** Outer container style (on the KeyboardAvoidingView). */
  style?: StyleProp<ViewStyle>;
  /** ScrollView content-container style. */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** If true, render without ScrollView (rare — for screens that scroll their own list). */
  withoutScroll?: boolean;
  /** Passed to ScrollView. Default: 'handled' (allows taps on children without swallowing outside-dismiss). */
  keyboardShouldPersistTaps?: ScrollViewProps['keyboardShouldPersistTaps'];
  /** Disable the tap-outside-to-dismiss wrapper (when inner children manage it themselves). */
  disableTapToDismiss?: boolean;
  /** ScrollView testID forwarding. */
  testID?: string;
};

export default function KeyboardSafe({
  children,
  bottomInset = 120,
  keyboardVerticalOffset = 0,
  style,
  contentContainerStyle,
  withoutScroll = false,
  keyboardShouldPersistTaps = 'handled',
  disableTapToDismiss = false,
  testID,
}: KeyboardSafeProps) {
  const behavior = Platform.OS === 'ios' ? 'padding' : 'height';

  const body = withoutScroll ? (
    <View style={{ flex: 1 }}>{children}</View>
  ) : (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[{ paddingBottom: bottomInset, flexGrow: 1 }, contentContainerStyle]}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      showsVerticalScrollIndicator={false}
      // iOS 14+ : auto-scrolls the currently-focused input into view so the
      // keyboard never covers what the user is typing. Harmless on older
      // iOS and ignored on Android (we rely on windowSoftInputMode=resize
      // + KeyboardAvoidingView behavior='height' there).
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="automatic"
      testID={testID}
    >
      {children}
    </ScrollView>
  );

  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior={behavior}
      keyboardVerticalOffset={keyboardVerticalOffset}
    >
      {disableTapToDismiss ? body : (
        // accessible={false} keeps the wrapper out of the accessibility tree
        // so VoiceOver doesn't announce it as tappable.
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={{ flex: 1 }}>{body}</View>
        </TouchableWithoutFeedback>
      )}
    </KeyboardAvoidingView>
  );
}

/**
 * Variant for screens where the input is docked at the BOTTOM (chat composer,
 * comment input) and the content above is a list that manages its own scroll.
 * Uses `behavior="padding"` on iOS so the docked input rises with the
 * keyboard, and a `keyboardVerticalOffset` you can pass to compensate for
 * a sticky header.
 */
export function KeyboardSafeDocked({
  children,
  keyboardVerticalOffset = 0,
  style,
}: {
  children: React.ReactNode;
  keyboardVerticalOffset?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={keyboardVerticalOffset}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
