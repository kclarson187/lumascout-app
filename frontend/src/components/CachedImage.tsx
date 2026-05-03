/**
 * CachedImage — v2.0.25 (2026-05-03)
 * ═══════════════════════════════════
 *
 * Why this exists
 * ───────────────
 * Our origin (`/api/img`) correctly emits
 *     Cache-Control: public, max-age=604800, immutable
 * but the public ingress (Cloudflare in front of the preview host)
 * rewrites that to
 *     Cache-Control: no-store, no-cache, must-revalidate
 * at the edge. Observed on v2.0.24 during TestFlight validation
 * (curl -D showed the rewrite, `cf-cache-status: DYNAMIC`).
 *
 * React Native's native <Image> uses iOS URLCache / Android OkHttp
 * which BOTH strictly honor `no-store` — so every re-render fetches
 * the bytes over the wire again. The 379MB → 0.26MB win we booked
 * in v2.0.24 would still bleed to a few MBs per pan-zoom session.
 *
 * Fix: `expo-image` has its own memory + disk cache keyed by URL,
 * independent of HTTP cache headers. With `cachePolicy="memory-disk"`
 * every bytes-load is persisted to disk until LRU eviction, and
 * server-side header strips become irrelevant.
 *
 * Usage
 * ─────
 *   <CachedImage
 *     source={{ uri: resolvedUrl }}
 *     style={…}
 *     contentFit="cover"
 *     transition={150}
 *   />
 *
 * It behaves like a drop-in for <Image> in 95% of cases. Differences:
 *   • `resizeMode="cover"`  →  `contentFit="cover"` (expo-image spec)
 *   • onError payload is `{ error: string }` not `{ nativeEvent }`
 *   • No `defaultSource` — use `placeholder` instead
 *
 * Dead-URL short-circuit (carried over from SafeImage)
 * ────────────────────────────────────────────────────
 * Module-level Set tracks URLs that have failed this session so
 * every subsequent render of the same broken URL skips the network
 * entirely — prevents 404 retry storms from stale DB rows.
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { Image as ExpoImage, ImageProps as ExpoImageProps, ImageSource } from 'expo-image';
import { ImageOff } from 'lucide-react-native';
import { colors, radii } from '../theme';

// Broken-URL cache — O(1) lookups keyed by URL. Cleared only on reload.
const BROKEN_URLS = new Set<string>();

export type CachedImageProps = Omit<ExpoImageProps, 'source' | 'onError'> & {
  source: ImageSource | { uri?: string | null } | number | null | undefined;
  /** When provided, rendered inside the placeholder slot when URL is broken. */
  placeholderIcon?: React.ReactNode;
  placeholderBackground?: string;
  /** Fired exactly once per URL the first time it fails in this session. */
  onFirstError?: (uri: string) => void;
  /** Fallback for callers still passing RN's `resizeMode` prop. */
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
};

function extractUri(source: CachedImageProps['source']): string | null {
  if (!source) return null;
  if (typeof source === 'number') return null;
  if (typeof source === 'object' && 'uri' in source) {
    const uri = (source as { uri?: string | null }).uri;
    return typeof uri === 'string' && uri.length > 0 ? uri : null;
  }
  return null;
}

function mapResizeModeToContentFit(
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center'
): 'cover' | 'contain' | 'fill' | 'none' {
  switch (resizeMode) {
    case 'contain':
      return 'contain';
    case 'stretch':
      return 'fill';
    case 'center':
      return 'none';
    case 'cover':
    default:
      return 'cover';
  }
}

export default function CachedImage({
  source,
  style,
  placeholderIcon,
  placeholderBackground,
  onFirstError,
  resizeMode,
  contentFit,
  cachePolicy = 'memory-disk',
  transition = 150,
  recyclingKey,
  ...rest
}: CachedImageProps) {
  const uri = useMemo(() => extractUri(source), [source]);
  const [localFailed, setLocalFailed] = useState(false);

  const brokenAtMount = uri != null && BROKEN_URLS.has(uri);
  const failed = brokenAtMount || localFailed;

  if (!uri || failed) {
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

  const effectiveFit = contentFit ?? mapResizeModeToContentFit(resizeMode);

  return (
    <ExpoImage
      source={{ uri }}
      style={style as any}
      contentFit={effectiveFit}
      cachePolicy={cachePolicy}
      transition={transition}
      recyclingKey={recyclingKey ?? uri}
      onError={(e) => {
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

/** Test helper — clears the in-session broken-URL cache. */
export function __resetCachedImageCacheForTests() {
  BROKEN_URLS.clear();
}
