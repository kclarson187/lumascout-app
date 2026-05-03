/**
 * Client-side EXIF orientation normalizer (Track C, May 2026).
 *
 * Why this exists:
 *   The backend's upload endpoint already calls `ImageOps.exif_transpose`
 *   and strips EXIF, so the file that gets PERSISTED is always pixel-
 *   correct. But between the moment the user picks a photo and the
 *   moment the server returns the hosted URL, we render the LOCAL URI
 *   as a preview (queue thumbnail, cover editor preview, etc.). That
 *   local URI on Android/web — and sometimes on iPhone HEIC — can
 *   carry an EXIF orientation tag which React Native's `<Image>`
 *   doesn't apply, resulting in previews that look sideways even
 *   though the server will store them correctly.
 *
 *   `expo-image-manipulator` applies the EXIF rotation as part of
 *   re-encoding, effectively "baking in" the correct orientation into
 *   the pixel data. We call it with no transform actions (just a
 *   JPEG re-save) so we don't double-resize — the backend still owns
 *   the canonical resize / quality pass as a safety net.
 */
import * as ImageManipulator from 'expo-image-manipulator';

export type NormalizedImage = {
  uri: string;
  width: number;
  height: number;
  mimeType: 'image/jpeg';
  fileName: string;
};

/**
 * Normalize a picked image's orientation by re-encoding it through
 * ImageManipulator. Returns a JPEG URI safe to preview locally and
 * upload to /api/uploads/image. Falls back to the original asset on
 * any manipulator error (very rare — usually corrupt HEIC).
 */
export async function normalizePickedImage(asset: {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  width?: number;
  height?: number;
}): Promise<NormalizedImage> {
  const fallback: NormalizedImage = {
    uri: asset.uri,
    width: asset.width ?? 0,
    height: asset.height ?? 0,
    mimeType: 'image/jpeg',
    fileName: asset.fileName || `upload_${Date.now()}.jpg`,
  };
  try {
    // Empty `actions` + JPEG re-save bakes the EXIF orientation into
    // pixels and strips metadata. Quality 0.92 preserves the picker's
    // fidelity — the backend still downscales to 2048 @ q=85 so we
    // aren't double-compressing noticeably.
    const result = await ImageManipulator.manipulateAsync(
      asset.uri,
      [],
      {
        compress: 0.92,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: false,
      },
    );
    return {
      uri: result.uri,
      width: result.width,
      height: result.height,
      mimeType: 'image/jpeg',
      fileName: (asset.fileName || `upload_${Date.now()}.jpg`).replace(/\.(heic|heif|png|webp)$/i, '.jpg'),
    };
  } catch (e) {
    // Swallow — the server's exif_transpose will still correct the
    // persisted file even if the preview is slightly off. We log so
    // we can spot patterns (HEIC versions that fail to decode, etc.).
    try {
       
      console.warn('[normalize-image] manipulator_failed', {
        name: (e as Error)?.name,
        message: (e as Error)?.message,
        uri: asset.uri?.slice(0, 40),
      });
    } catch {}
    return fallback;
  }
}

/** Normalize an array of picked assets, skipping any that fail. */
export async function normalizePickedImages(
  assets: {
    uri: string;
    mimeType?: string | null;
    fileName?: string | null;
    width?: number;
    height?: number;
  }[],
): Promise<NormalizedImage[]> {
  // Serial — EXIF manipulator is CPU-heavy on-device. Parallelism here
  // tends to spike memory and slow throughput vs. a clean sequence.
  const out: NormalizedImage[] = [];
  for (const a of assets) {
    out.push(await normalizePickedImage(a));
  }
  return out;
}
