import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { api } from './api';

/**
 * Ensure notification permissions are granted, fetch an Expo push token,
 * AND (iOS only, post-EAS-build) fetch the native APNs device token and
 * POST both to the backend. Silent on web or when permission is denied.
 * Safe to call multiple times — the server upserts by (user_id, token).
 *
 * Why register BOTH token types on iOS:
 *   • Expo token    → delivered via exp.host (easy path, works in Expo Go)
 *   • APNs device   → delivered directly via api.push.apple.com (our
 *                     backend signs a JWT with the .p8 in /app/secrets/)
 *                     Bypasses Expo's push service entirely. Used for
 *                     high-volume fanouts where Expo would rate-limit.
 *
 * `getDevicePushTokenAsync()` returns the OS-level token — on iOS this
 * is the APNs token; on Android this would be the FCM token. FCM
 * dispatch is not yet wired server-side, so we only register iOS
 * native tokens for now.
 */
export async function registerPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  if (!Device.isDevice) {
    // Emulators/simulators don't receive push tokens from Expo's server.
    return null;
  }
  try {
    const existing = await Notifications.getPermissionsAsync();
    let finalStatus = existing.status;
    if (finalStatus !== 'granted') {
      const ask = await Notifications.requestPermissionsAsync();
      finalStatus = ask.status;
    }
    if (finalStatus !== 'granted') return null;

    // Configure the Android notification channel.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ||
      // @ts-ignore — classic builds
      Constants.easConfig?.projectId;

    // 1) Expo-routed token (works in Expo Go + EAS builds).
    let expoToken: string | null = null;
    try {
      const tokenResp = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      );
      expoToken = tokenResp.data || null;
    } catch {
      // Expo Go on a fresh install can occasionally fail the first call.
      expoToken = null;
    }
    if (expoToken) {
      try {
        await api.post('/me/push-token', {
          token: expoToken,
          token_type: 'expo',
          platform: Platform.OS,
        });
      } catch {
        // registration failure is non-fatal; try again next launch.
      }
    }

    // 2) Native APNs device token (iOS only + EAS native builds only —
    //    Expo Go sandboxes notifications and does NOT expose the real
    //    APNs token). The call throws an ERR_NOTIFICATIONS_SERVER_ERROR
    //    style rejection in Expo Go; swallow silently.
    if (Platform.OS === 'ios') {
      try {
        const deviceTok = await Notifications.getDevicePushTokenAsync();
        // deviceTok.data is a hex string on iOS (APNs token).
        const rawApns = typeof deviceTok?.data === 'string' ? deviceTok.data : '';
        if (rawApns) {
          try {
            await api.post('/me/push-token', {
              token: rawApns,
              token_type: 'apns',
              platform: 'ios',
            });
          } catch {
            /* non-fatal */
          }
        }
      } catch {
        // Non-fatal — the user still has the Expo path. We'll re-try
        // on next launch once they're on an EAS build.
      }
    }

    return expoToken;
  } catch {
    return null;
  }
}

// Configure how notifications are shown while the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Wire up push-tap → deep link handling. Call once on app startup (root layout).
 * When a user taps a push that carries `data.deep_link`, we route there.
 */
export function installPushDeepLinkHandler(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    try {
      const data = response.notification.request.content.data as any;
      const deep = data?.deep_link || data?.url;
      if (typeof deep === 'string' && deep.startsWith('/')) {
        // Route on next tick so navigation is mounted.
        setTimeout(() => router.push(deep as any), 50);
      }
    } catch {}
  });
  // Also inspect the initial notification that may have cold-started the app.
  (async () => {
    try {
      const last = await Notifications.getLastNotificationResponseAsync();
      const data = last?.notification?.request?.content?.data as any;
      const deep = data?.deep_link || data?.url;
      if (typeof deep === 'string' && deep.startsWith('/')) {
        setTimeout(() => router.push(deep as any), 400);
      }
    } catch {}
  })();
  return () => {
    try { sub.remove(); } catch {}
  };
}
