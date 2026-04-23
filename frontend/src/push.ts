import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { api } from './api';

/**
 * Ensure notification permissions are granted, fetch an Expo push token, and
 * POST it to the backend. Silent on web or when permission is denied.
 * Safe to call multiple times — the server upserts by (user_id, token).
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
    const tokenResp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResp.data;
    if (!token) return null;
    try {
      await api.post('/me/push-token', { token, platform: Platform.OS });
    } catch {
      // registration failure is non-fatal; try again next launch.
    }
    return token;
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
