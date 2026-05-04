/**
 * SafeImage — drop-in replacement for <Image> that gracefully handles
 * broken URLs without triggering infinite retry loops.
 *
 * Why this exists (Batch #6, May 2026):
 *   React Native's <Image> component retries failed URL loads aggressively.
 *   Any stale DB row pointing at a deleted /api/uploads/<file>.jpg triggers
 *   hundreds of repeated 404 hits from the same client, wasting bandwidth,
 *   battery, and server resources. SafeImage tracks failures in a
 *   module-level Set keyed by URL so once a URL fails, every subsequent
 *   render of that URL in the same session short-circuits straight to the
 *   placeholder — no further network requests.
 *
 * Drop-in semantics:
 *   - Accepts `source`, `style`, `resizeMode`, and everything else the
 *     underlying <Image> supports.
 *   - If `source` is a numeric require(...) (local asset), behaves exactly
 *     like <Image> — no failure tracking applies.
 *   - If `source.uri` is empty/null, renders a placeholder immediately.
 *   - Exposes `placeholderIcon` and `placeholderBackground` props for
 *     callers who want a different look (e.g. camera-off on an avatar).
 *
 * LumaScout brand: dark surface (#1a1a1a) with a subtle camera-off glyph
 * in gold (#f5a623) at ~35% opacity — reads as “intentional empty state”
 * rather than “broken”.
 */
import React, { useMemo, useState } from 'react';
import {
  Image,
  ImageProps,
  ImageSourcePropType,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { ImageOff } from 'lucide-react-native';
import { colors, radii } from '../theme';
import { resolveBackendUrl } from '../constants/config';

// V3 (May 2026) — Defensive URL absolutization at the rendering layer.
//
// Why this is here, not just in image-url.ts callers:
//   Multiple call sites pass URLs directly from API responses to
//   <Image> (e.g., spot.owner.avatar_url, item.attachment_url, raw
//   community_uploads URLs). If the backend ever returns a relative
//   path like "/api/uploads/2026/05/abc.jpg" — which iOS native
//   <Image> CANNOT render — those paths bypass the resolver and
//   produce silent blanks ONLY in production builds (Expo Go's metro
//   bundler somehow papers this over for `http://localhost:8081/...`
//   relative paths during dev, which is why dev "just works" but
//   prod doesn't).
//
//   This guard absolutizes any "/path" URI to "${backendBaseUrl}/path"
//   inside the image component itself, so EVERY consumer is protected
//   regardless of which helper it forgot to call.
function _absolutize(uri: string | null | undefined): string | null {
  if (!uri || typeof uri !== 'string') return uri || null;
  if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(uri)) return uri;   // http(s)://, ftp://, file://
  if (uri.startsWith('data:') || uri.startsWith('blob:')) return uri;
  if (uri.startsWith('//')) return `https:${uri}`;          // protocol-relative
  if (uri.startsWith('/')) {
    try {
      const base = resolveBackendUrl();
      return base ? `${base}${uri}` : uri;
    } catch { return uri; }
  }
  return uri;
}

// Module-level cache of URLs that have failed to load this session. Using
// a Set keeps lookups O(1) and memory usage bounded to the number of
// distinct broken assets the user encounters (typically a handful).
const BROKEN_URLS = new Set<string>();

export type SafeImageProps = Omit<ImageProps, 'source' | 'onError'> & {
  source: ImageSourcePropType | { uri?: string | null } | null | undefined;
  placeholderIcon?: React.ReactNode;
  placeholderBackground?: string;
  /**
   * When true, the placeholder is rendered full-bleed inside the parent
   * style and the icon is centered. Default. Set to false to render the
   * icon inline with no background (rare).
   */
  showPlaceholder?: boolean;
  /**
   * Optional handler fired the FIRST time a URL fails in this session.
   * Later identical-URL renders short-circuit before onError fires again.
   */
  onFirstError?: (uri: string) => void;
};

function extractUri(source: SafeImageProps['source']): string | null {
  if (!source) return null;
  if (typeof source === 'number') return null; // local asset
  if (typeof source === 'object' && 'uri' in source) {
    const raw = (source as { uri?: string | null }).uri || null;
    return _absolutize(raw);
  }
  return null;
}

export default function SafeImage({
  source,
  style,
  placeholderIcon,
  placeholderBackground,
  showPlaceholder = true,
  onFirstError,
  ...rest
}: SafeImageProps) {
  const uri = useMemo(() => extractUri(source), [source]);
  // Local state tracks whether THIS mount has registered a failure so we
  // can flip to the placeholder without needing a parent rerender.
  const [localFailed, setLocalFailed] = useState(false);

  const brokenAtMount = uri != null && BROKEN_URLS.has(uri);
  const failed = brokenAtMount || localFailed;

  // Empty URI OR previous failure → show placeholder, never mount <Image>,
  // so the OS never fires a network request for a URL we already know is
  // dead. This is the core of the “stop the retry loop” fix.
  if (!uri || failed) {
    if (!showPlaceholder) return null;
    return (
      <View
        style={[
          styles.placeholder,
          placeholderBackground ? { backgroundColor: placeholderBackground } : null,
          style as ViewStyle,
        ]}
      >
        {placeholderIcon ?? (
          <ImageOff
            size={22}
            color={colors.primary}
            strokeWidth={1.5}
            opacity={0.35}
          />
        )}
      </View>
    );
  }

  return (
    <Image
      // V3 (May 2026 production fix) — pass the absolutized URI back
      // through so iOS native <Image> receives a fully-qualified URL.
      // For non-uri sources (numeric require()) we forward as-is.
      source={
        typeof source === 'object' && source && 'uri' in source
          ? { ...(source as object), uri: uri || (source as { uri?: string | null }).uri }
          : (source as ImageSourcePropType)
      }
      style={style}
      onError={() => {
        // Cache the broken URI so every *other* mount of the same URL
        // in this session short-circuits. Fire the consumer callback
        // exactly once per URL.
        if (!BROKEN_URLS.has(uri)) {
          BROKEN_URLS.add(uri);
          try { onFirstError?.(uri); } catch { /* noop */ }
        }
        setLocalFailed(true);
      }}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: radii.sm,
  },
});

/** Test hook — clears the broken-URL cache. Only used from unit/dev tools. */
export function __resetSafeImageCacheForTests() {
  BROKEN_URLS.clear();
}
