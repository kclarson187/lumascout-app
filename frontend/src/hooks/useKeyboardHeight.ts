/**
 * useKeyboardHeight — track the on-screen keyboard's pixel height.
 *
 * Returns 0 when the keyboard is closed, otherwise the keyboard's
 * end-coordinates height in points. iOS uses `keyboardWillShow` for a
 * snappier transition; Android uses `keyboardDidShow` because Will
 * events are not emitted on Android.
 *
 * USAGE — bottom-pad a ScrollView so submit buttons are reachable:
 *   const kbHeight = useKeyboardHeight();
 *   <ScrollView contentContainerStyle={{
 *     paddingBottom: (Platform.OS === 'android' ? kbHeight : 0) + 32,
 *   }} />
 *
 * Why Android-only padding? On iOS we already use KeyboardAvoidingView
 * with behavior="padding" which shifts the whole view above the
 * keyboard. On Android with softwareKeyboardLayoutMode "resize" the
 * activity shrinks, but a ScrollView whose contentContainer has a
 * minHeight of 100% will also shrink — pushing bottom buttons against
 * the keyboard. Adding the kbHeight to paddingBottom guarantees there
 * is always enough scrollable space below the last input + button.
 */
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardHeight(): number {
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s1 = Keyboard.addListener(showEvt, (e: any) => {
      const h = e?.endCoordinates?.height;
      if (typeof h === 'number' && Number.isFinite(h) && h > 0) {
        setKbHeight(h);
      }
    });
    const s2 = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => {
      s1.remove();
      s2.remove();
    };
  }, []);
  return kbHeight;
}
