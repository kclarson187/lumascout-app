/**
 * Unified share helper — CR Items 7 & 8 (May 2026).
 *
 * Replaces every ad-hoc `Share.share({ url: 'LumaScout.app', message: ... })`
 * call in the codebase. Centralises:
 *   1. The smart-link URL (server-side at /api/share/{type}/{id} which
 *      detects User-Agent and routes to App Store / Play Store / web).
 *   2. The context-aware share text (spot vs profile vs post vs app).
 *   3. The native iOS/Android share sheet invocation (Apple's
 *      UIActivityViewController / Android Intent.ACTION_SEND).
 *
 * Why a smart link instead of separate per-platform URLs:
 * The product spec calls for a SINGLE share URL the recipient can paste
 * anywhere. The server-side redirect at /api/share/{type}/{id} handles
 * platform routing, so we don't have to ask the sender what platform
 * the recipient is on. iMessage / SMS / WhatsApp / Slack / Discord /
 * Twitter all paste cleanly.
 *
 * Open Graph metadata is embedded server-side so link previews show a
 * real card with the spot/user banner image, title, and description —
 * not a bare URL.
 *
 * App Store / Play Store fallback: If the app isn't installed, the
 * server-side HTML attempts a `lumascout://` deeplink with a 250 ms
 * timeout, then falls through to App Store on iOS or Play Store on
 * Android. Desktop users see a "Continue on the web" CTA.
 */
import { Platform, Share } from 'react-native';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';

function backendBase(): string {
  const raw =
    (process.env.EXPO_PUBLIC_BACKEND_URL as string | undefined) ||
    (Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL as string | undefined) ||
    '';
  return raw.replace(/\/+$/, '');
}

function smartLink(kind: 'spot' | 'user' | 'post' | 'app', id?: string): string {
  const base = backendBase();
  if (kind === 'app') return `${base}/api/share/get`;
  return `${base}/api/share/${kind}/${encodeURIComponent(id || '')}`;
}

async function present(message: string, url: string, dialogTitle?: string) {
  try {
    Haptics.selectionAsync().catch(() => {});
  } catch {}
  // iOS prefers the `url` field separately from the `message` so the
  // share sheet shows a clickable link cell. Android merges both into
  // a single text intent. We always include the URL in the message so
  // text-only paste targets (Notes, email body) get the link too.
  const merged = `${message}\n\n${url}`;
  if (Platform.OS === 'ios') {
    await Share.share({ message: merged, url, title: dialogTitle });
  } else {
    await Share.share({ message: merged, title: dialogTitle });
  }
}

// ── Public API ─────────────────────────────────────────────────────

/** Share a spot. Works from Map preview, list cards, and Spot Detail. */
export async function shareSpot(spot: { spot_id?: string; id?: string; title?: string }) {
  const id = spot.spot_id || spot.id || '';
  if (!id) return;
  const title = spot.title || 'this spot';
  const message = `${title} on LumaScout`;
  const url = smartLink('spot', id);
  await present(message, url, 'Share spot');
}

/**
 * Share a user/photographer profile. Wires the previously broken
 * "Share Profile" button (Item #8) to a real working URL with Open
 * Graph metadata so the recipient sees a banner card preview.
 */
export async function shareProfile(user: {
  user_id?: string;
  id?: string;
  display_name?: string;
  username?: string;
  specialty?: string;
}) {
  const id = user.user_id || user.id || '';
  if (!id) return;
  const name = user.display_name || user.username || 'this photographer';
  const specialty = user.specialty ? ` · ${user.specialty}` : '';
  const message = `Check out ${name}'s photography${specialty} on LumaScout`;
  const url = smartLink('user', id);
  await present(message, url, 'Share profile');
}

/** Share a community post. */
export async function sharePost(post: { post_id?: string; id?: string; title?: string }) {
  const id = post.post_id || post.id || '';
  if (!id) return;
  const title = post.title || 'this post';
  const message = `${title} on LumaScout`;
  const url = smartLink('post', id);
  await present(message, url, 'Share post');
}

/** Share the app itself (no entity). */
export async function shareApp() {
  const message = 'Find premium photo locations near you on LumaScout';
  const url = smartLink('app');
  await present(message, url, 'Share LumaScout');
}
