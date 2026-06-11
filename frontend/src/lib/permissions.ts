/**
 * src/lib/permissions.ts — Pre-permission priming + native request helpers.
 *
 * Why this exists (June 2026 App Store / Play Store hygiene pass):
 * ────────────────────────────────────────────────────────────────
 * Apple and Google both penalize apps that fire raw permission prompts
 * without context. The platform reviewer-pass rate jumps significantly
 * (and end-user opt-in rates jump 30–50%) when we show a custom
 * "why we're asking" sheet BEFORE the OS dialog. This module is the
 * single source of truth for that flow:
 *
 *   1. Check current permission status (`getPermissionsAsync`).
 *   2. If `granted` → return immediately. No need to bother the user.
 *   3. If `denied` AND `canAskAgain === false` → the OS will silently
 *      reject any further `requestPermissionsAsync()` calls. Show a
 *      tailored sheet that offers "Open Settings" via Linking.openSettings.
 *   4. If `undetermined` (first-time) OR `denied + canAskAgain === true` →
 *      show our custom priming sheet first ("LumaScout needs … because …"),
 *      then on tap-Allow, fire the native `requestPermissionsAsync()`.
 *
 * The actual sheet UI is rendered by <PermissionPrimeHost />, mounted
 * once at the root layout. This module talks to the host via a
 * module-level subject (no React Context required, so any non-React
 * helper can call it).
 *
 * Usage:
 *   ```
 *   import { primeAndRequestLocation } from '@/src/lib/permissions';
 *   const ok = await primeAndRequestLocation();
 *   if (!ok) return; // user opted out — degrade gracefully
 *   const loc = await Location.getCurrentPositionAsync({});
 *   ```
 *
 * Critical contract (see <handle_permissions_contract> in the
 * platform spec):
 *   • NEVER dead-end the user. If they deny, the calling screen MUST
 *     still let them complete a degraded version of the task.
 *   • Ask each permission ONCE per session, at the point of clear
 *     user intent (tap-to-add-spot, tap-to-upload, etc.).
 *   • Respect `canAskAgain === false` — switch to Open-Settings flow.
 */

import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';

// ─────────────────────────────────────────────────────────────────
// Prime-sheet subject — communication channel from this module to
// the <PermissionPrimeHost /> mounted at app root.
// ─────────────────────────────────────────────────────────────────

export type PermissionPrimeKind = 'location' | 'mediaLibrary' | 'camera';

export type PermissionPrimePayload = {
  kind: PermissionPrimeKind;
  /** Headline shown big at the top of the sheet. */
  title: string;
  /** One-sentence framing of the ask. */
  subtitle: string;
  /** Up to 4 short benefit bullets. */
  bullets: string[];
  /**
   * Variant: 'first-time' shows "Allow Location" CTA;
   * 'blocked' shows "Open Settings" CTA (perm previously denied
   * with canAskAgain=false).
   */
  variant: 'first-time' | 'blocked';
};

type PrimeHandler = (payload: PermissionPrimePayload) => Promise<boolean>;

let primeHandler: PrimeHandler | null = null;

/**
 * Called by <PermissionPrimeHost /> on mount to register itself.
 * The host swaps in a real handler that resolves on user tap.
 */
export function _registerPrimeHandler(handler: PrimeHandler | null): void {
  primeHandler = handler;
}

/**
 * Show the priming sheet. Resolves with true if the user tapped the
 * primary CTA (Allow / Open Settings); false if they skipped or
 * dismissed. When the host isn't mounted yet (very early boot,
 * Storybook, tests), we fall through to true so the native prompt
 * fires anyway — never block the flow on missing priming UI.
 */
async function showPrime(payload: PermissionPrimePayload): Promise<boolean> {
  if (!primeHandler) return true;
  try {
    return await primeHandler(payload);
  } catch {
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────
// Location — foreground GPS access.
// ─────────────────────────────────────────────────────────────────

const LOCATION_BULLETS = [
  'Auto-tag your spots with precise GPS coordinates',
  'Find golden-hour spots near where you are',
  'Show distance + drive time to every saved location',
  'You can always set the pin manually instead',
];

export async function primeAndRequestLocation(): Promise<boolean> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return true;

  // Already permanently denied — short-circuit to settings sheet.
  if (current.status === 'denied' && current.canAskAgain === false) {
    const ok = await showPrime({
      kind: 'location',
      title: 'Location is off',
      subtitle:
        'You blocked location access for LumaScout earlier. Open Settings to turn it back on, or keep using manual pin entry.',
      bullets: LOCATION_BULLETS,
      variant: 'blocked',
    });
    if (ok) await Linking.openSettings().catch(() => undefined);
    return false;
  }

  // First-time or soft-denied — show the priming sheet, then fire the
  // native prompt only if the user opts in.
  const wantsToContinue = await showPrime({
    kind: 'location',
    title: 'Pinpoint your spot',
    subtitle:
      'LumaScout uses your location to auto-tag spots and surface nearby ones at golden hour.',
    bullets: LOCATION_BULLETS,
    variant: 'first-time',
  });
  if (!wantsToContinue) return false;

  const next = await Location.requestForegroundPermissionsAsync();
  return next.status === 'granted';
}

// ─────────────────────────────────────────────────────────────────
// Media Library — photo picker access (spot photos, profile, banner).
// ─────────────────────────────────────────────────────────────────

const MEDIA_BULLETS = [
  'Attach photos to your spots and posts',
  'Set a profile photo and banner image',
  'Photos stay private until you publish',
  'iOS 14+: pick "Selected Photos" for tighter access',
];

export async function primeAndRequestMediaLibrary(): Promise<boolean> {
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (current.granted) return true;

  if (current.status === 'denied' && current.canAskAgain === false) {
    const ok = await showPrime({
      kind: 'mediaLibrary',
      title: 'Photo access is off',
      subtitle:
        'You previously blocked LumaScout from your photo library. Open Settings to allow access and continue uploading.',
      bullets: MEDIA_BULLETS,
      variant: 'blocked',
    });
    if (ok) await Linking.openSettings().catch(() => undefined);
    return false;
  }

  const wantsToContinue = await showPrime({
    kind: 'mediaLibrary',
    title: 'Pick the photos to share',
    subtitle:
      'LumaScout needs access to your photo library so you can attach images to spots, posts, and your profile.',
    bullets: MEDIA_BULLETS,
    variant: 'first-time',
  });
  if (!wantsToContinue) return false;

  const next = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return next.status === 'granted';
}

// ─────────────────────────────────────────────────────────────────
// Camera — live capture for spot photos + profile self-shots.
// ─────────────────────────────────────────────────────────────────

const CAMERA_BULLETS = [
  'Capture spots on-site with one tap',
  'Auto-tag the shot with current GPS',
  'Goes straight into your draft — no app-switching',
  'You can always upload from your library instead',
];

export async function primeAndRequestCamera(): Promise<boolean> {
  const current = await ImagePicker.getCameraPermissionsAsync();
  if (current.granted) return true;

  if (current.status === 'denied' && current.canAskAgain === false) {
    const ok = await showPrime({
      kind: 'camera',
      title: 'Camera is off',
      subtitle:
        'You previously blocked LumaScout from using your camera. Open Settings to capture spots in-app.',
      bullets: CAMERA_BULLETS,
      variant: 'blocked',
    });
    if (ok) await Linking.openSettings().catch(() => undefined);
    return false;
  }

  const wantsToContinue = await showPrime({
    kind: 'camera',
    title: 'Capture the moment',
    subtitle:
      'LumaScout uses your camera to grab spot photos on-site, auto-tagged with GPS — no app-switching required.',
    bullets: CAMERA_BULLETS,
    variant: 'first-time',
  });
  if (!wantsToContinue) return false;

  const next = await ImagePicker.requestCameraPermissionsAsync();
  return next.status === 'granted';
}
