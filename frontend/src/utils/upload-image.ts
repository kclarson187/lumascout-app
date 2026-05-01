/**
 * Shared image-upload helper (Apr 2026).
 *
 * Replaces the old pattern of base64-encoding images and shipping them
 * inside spot JSON. Instead: picks from the library (or uses an asset
 * already picked), POSTs the local file as multipart/form-data to
 * /api/uploads/image, and returns the hosted public URL that the
 * caller stores in its own payload.
 *
 * Why a helper:
 *   • Every upload surface (upload.tsx, add.tsx, cover editor,
 *     eventually DM attachments) should use exactly the same contract.
 *   • Any improvement — HEIC conversion, retry-with-backoff, progress
 *     UI — lands here once and benefits all callers.
 */
import * as ImagePicker from 'expo-image-picker';
import { Alert, Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Resolved backend base URL. EXPO_PUBLIC_BACKEND_URL is the source of
 * truth — preview + production both set it. The empty fallback is
 * defensive: axios + our /api prefix still works on Emergent's preview
 * where `/api/*` is rewritten at the edge to port 8001.
 */
function backendBaseUrl(): string {
  const raw = (process.env.EXPO_PUBLIC_BACKEND_URL as string | undefined)
    || (Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL as string | undefined)
    || '';
  return raw.replace(/\/+$/, '');
}

export type UploadedImage = {
  image_url: string;
  width: number;
  height: number;
  bytes: number;
  mime: string;
};

async function authHeader(): Promise<Record<string, string>> {
  try {
    const { api } = await import('../api');
    const token = await api.getTokenFromStorage();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/** Upload one picked asset. Returns the hosted URL (relative to origin).
 *
 * Error categorization (June 2025): we now throw rich `Error` instances
 * whose `name` carries the failure category — `'TimeoutError'`, `'NetworkError'`,
 * `'AuthError'`, `'PayloadTooLargeError'`, `'UnsupportedMediaError'`,
 * `'ServerError'`, or `'UnknownError'` — so the calling screen can
 * render a precise user-facing message instead of "Upload failed".
 *
 * The thrown error's `message` is ALWAYS user-friendly text (never the
 * raw axios/fetch traceback) so it can be safely used as the alert body.
 */
export async function uploadImageAsset(
  asset: { uri: string; mimeType?: string | null; fileName?: string | null },
): Promise<UploadedImage> {
  const form = new FormData();
  const filename = asset.fileName || `upload_${Date.now()}.jpg`;
  // Default to the picker-reported MIME, fall back to JPEG. iPhone HEIC
  // photos arrive as `image/heic` and the backend now decodes them via
  // pillow-heif (registered at startup) — no client-side conversion
  // needed.
  const mime = asset.mimeType || 'image/jpeg';
  // React Native's FormData file shape — { uri, name, type }
  form.append('file', {
    // @ts-expect-error RN FormData accepts this shape; DOM's doesn't.
    uri: asset.uri,
    name: filename,
    type: mime,
  });
  const url = `${backendBaseUrl()}/api/uploads/image`;

  // Per-asset 60s timeout — large iPhone photos on slow cellular can
  // take 30–45s including the server-side Pillow re-encode.
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), 60000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...(await authHeader()),
        // NOTE: do NOT set Content-Type manually — RN's fetch adds the
        // correct multipart boundary automatically. Setting it here
        // breaks the boundary negotiation on Android.
      },
      body: form,
      signal: ac.signal,
    });
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e?.name === 'AbortError') {
      const err = new Error(
        'Photo upload timed out. Please check your connection and try again.',
      );
      err.name = 'TimeoutError';
      throw err;
    }
    const err = new Error(
      'We couldn\'t reach the server. Please check your internet and try again.',
    );
    err.name = 'NetworkError';
    throw err;
  }
  clearTimeout(timeoutId);

  if (!res.ok) {
    // Pull server-provided detail (now user-friendly thanks to
    // routes/uploads.py improvements) + categorize by HTTP status so
    // the caller can reason about it.
    let detail = '';
    try {
      const j = await res.json();
      detail = (j?.detail || '').toString().trim();
    } catch {}
    const status = res.status;
    let name = 'UnknownError';
    let fallback = 'We couldn\'t upload this photo. Please try again.';
    if (status === 401 || status === 403) {
      name = 'AuthError';
      fallback = 'Your session has expired. Please log in again.';
    } else if (status === 408) {
      name = 'TimeoutError';
      fallback = 'Photo upload timed out. Please try again.';
    } else if (status === 413) {
      name = 'PayloadTooLargeError';
      fallback = 'This photo is too large. Please choose a smaller image.';
    } else if (status === 415) {
      name = 'UnsupportedMediaError';
      fallback =
        'This image format isn\'t supported. Please pick a JPEG, PNG, or HEIC photo.';
    } else if (status === 429) {
      name = 'RateLimitError';
      fallback = 'Slow down a moment — please wait a few seconds and try again.';
    } else if (status >= 500) {
      name = 'ServerError';
      fallback = 'Our server hit a snag. Please try again in a moment.';
    } else if (status >= 400) {
      name = 'ClientError';
    }
    const err = new Error(detail || fallback);
    err.name = name;
    throw err;
  }
  const j = (await res.json()) as UploadedImage;
  // CRITICAL (Apr 2026): the backend returns `/api/uploads/...` which
  // is a relative URL. React Native's <Image> on iOS / Android cannot
  // resolve relative URLs — the slot silently renders blank. We
  // absolutise here so every caller gets a URL that's immediately
  // usable in `<Image source={{ uri }} />`, and so MongoDB stores the
  // fully-qualified URL (no render-time surprises).
  const absolute = j.image_url && j.image_url.startsWith('/')
    ? `${backendBaseUrl()}${j.image_url}`
    : j.image_url;
  return { ...j, image_url: absolute };
}

/** Upload many picked assets in parallel with a sane concurrency cap. */
export async function uploadImageAssets(
  assets: Array<{ uri: string; mimeType?: string | null; fileName?: string | null }>,
  concurrency = 3,
): Promise<UploadedImage[]> {
  const out: UploadedImage[] = new Array(assets.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, assets.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= assets.length) return;
      out[i] = await uploadImageAsset(assets[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * One-shot helper for screens that just want "open picker, upload,
 * hand me back URLs". Handles permissions + pickers so callers don't
 * repeat the dance.
 */
export async function pickAndUploadImages(options?: {
  selectionLimit?: number;
  quality?: number;
}): Promise<UploadedImage[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (perm.status !== 'granted') {
    Alert.alert('Permission needed', 'Allow photo library access to share photos.');
    return [];
  }
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: (options?.selectionLimit ?? 1) > 1,
    // base64: false — the whole point of this refactor. Multipart upload
    // to our backend is orders of magnitude smaller on the wire than
    // inlining base64 into a JSON payload.
    base64: false,
    quality: options?.quality ?? 0.85,
    selectionLimit: options?.selectionLimit ?? 1,
  });
  if (r.canceled || !r.assets?.length) return [];
  return uploadImageAssets(
    r.assets.map((a) => ({ uri: a.uri, mimeType: a.mimeType, fileName: a.fileName })),
  );
}

// A small helper so callers can quickly test the module without typing
// checks (the Platform import is unused below; keep it for future
// web-specific branching if we ever need it).
export const __rn_platform = Platform.OS;
