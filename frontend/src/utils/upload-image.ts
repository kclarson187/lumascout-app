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

/** Upload one picked asset. Returns the hosted URL (relative to origin). */
export async function uploadImageAsset(
  asset: { uri: string; mimeType?: string | null; fileName?: string | null },
): Promise<UploadedImage> {
  const form = new FormData();
  const filename = asset.fileName || `upload_${Date.now()}.jpg`;
  const mime = asset.mimeType || 'image/jpeg';
  // React Native's FormData file shape — { uri, name, type }
  form.append('file', {
    // @ts-expect-error RN FormData accepts this shape; DOM's doesn't.
    uri: asset.uri,
    name: filename,
    type: mime,
  });
  const url = `${backendBaseUrl()}/api/uploads/image`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      ...(await authHeader()),
      // NOTE: do NOT set Content-Type manually — RN's fetch adds the
      // correct multipart boundary automatically. Setting it here
      // breaks the boundary negotiation on Android.
    },
    body: form,
  });
  if (!res.ok) {
    let detail = 'Upload failed';
    try {
      const j = await res.json();
      detail = j?.detail || detail;
    } catch {}
    throw new Error(detail);
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
