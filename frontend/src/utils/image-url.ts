/**
 * Image URL resolver (Apr 2026).
 *
 * React Native's <Image> cannot render relative URLs — on iOS / Android
 * the app has no "current origin" to resolve them against. The backend
 * returns `/api/uploads/2026/04/<uuid>.jpg` when a user uploads a photo;
 * unless we prefix it with the backend URL, the <Image> tag silently
 * fails and the slot stays blank. That was the bug where newly-uploaded
 * spot photos appeared to upload but never rendered.
 *
 * We centralise the resolve step here so every call-site (thumbnails,
 * hero carousel, SpotCard cover, saved list, edit-request picker, ...)
 * can wrap its URL in `resolveImageUrl(url)` and "just work" whether
 * the stored value is already absolute, app-relative, or fully-qualified.
 */
import Constants from 'expo-constants';

function backendBaseUrl(): string {
  const raw =
    (process.env.EXPO_PUBLIC_BACKEND_URL as string | undefined) ||
    (Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL as string | undefined) ||
    '';
  return raw.replace(/\/+$/, '');
}

export function resolveImageUrl(url: string | null | undefined): string | undefined {
  if (!url || typeof url !== 'string') return undefined;
  // Absolute http(s) — pass through untouched.
  if (/^https?:\/\//i.test(url)) return url;
  // data: URIs (legacy / inline) — pass through too.
  if (url.startsWith('data:')) return url;
  // App-relative (`/api/...` or `/uploads/...`) — prefix with the
  // backend URL so React Native can fetch it on native.
  if (url.startsWith('/')) {
    const base = backendBaseUrl();
    return base ? `${base}${url}` : url;
  }
  // Bare path without leading slash (rare but we defend anyway).
  return url;
}

/** Same semantics, but returns a usable Image source object. */
export function resolveImageSource(url: string | null | undefined) {
  const resolved = resolveImageUrl(url);
  return resolved ? { uri: resolved } : undefined;
}
