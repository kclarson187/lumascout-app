/**
 * ProductCard — premium reusable marketplace card.
 * Two variants: compact (rails) and full (grid/list).
 */
import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Star, Package, ShieldCheck, Palette, Map as MapIcon, FileText,
  Route, Film, Layout, Headphones,
} from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';
import UserBadge from './UserBadge';

export type Product = {
  product_id: string;
  title: string;
  type: string;
  description: string;
  price_cents: number;
  currency: string;
  thumbnail_url: string;
  preview_urls?: string[];
  tags?: string[];
  category?: string;
  status: string;
  featured?: boolean;
  view_count: number;
  sales_count: number;
  rating_avg: number;
  rating_count: number;
  in_wishlist?: boolean;
  has_purchased?: boolean;
  seller?: {
    user_id: string;
    name: string;
    username?: string;
    avatar_url?: string;
    plan?: string;
    verification_status?: string;
  };
};

const TYPE_LABELS: Record<string, string> = {
  preset:     'Presets',
  spot_pack:  'Spot Pack',
  city_guide: 'City Guide',
  route_pack: 'Route Pack',
  lut:        'LUT',
  template:   'Template',
  mentorship: 'Mentorship',
};

const TYPE_GRADIENTS: Record<string, [string, string]> = {
  preset:     ['#3a2d1e', '#15100a'],
  spot_pack:  ['#1e2f3a', '#0a1015'],
  city_guide: ['#2d2540', '#100d1c'],
  route_pack: ['#1a3633', '#081010'],
  lut:        ['#3a1e2f', '#150a12'],
  template:   ['#2f331c', '#101208'],
  mentorship: ['#33261e', '#120e0a'],
};

const TYPE_ICONS: Record<string, any> = {
  preset: Palette, spot_pack: MapIcon, city_guide: FileText,
  route_pack: Route, lut: Film, template: Layout, mentorship: Headphones,
};

function fmtPrice(cents: number, currency = 'USD'): string {
  if (cents === 0) return 'Free';
  const dollars = (cents / 100).toFixed(2);
  return currency === 'USD' ? `$${dollars}` : `${dollars} ${currency}`;
}

function initials(name: string | undefined): string {
  if (!name) return 'LS';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] || '').join('').toUpperCase() || 'LS';
}

export default function ProductCard({
  product, compact, onPress,
}: {
  product: Product; compact?: boolean; onPress: () => void;
}) {
  const isVerified = product.seller?.verification_status === 'verified';
  const isElite = product.seller?.plan === 'elite';
  const gradient = TYPE_GRADIENTS[product.type] || ['#2a2a2d', '#0f0f10'];
  const TypeIcon = TYPE_ICONS[product.type] || Package;
  const displayName = product.seller?.name && product.seller.name.trim() !== ''
    ? product.seller.name
    : 'Marketplace Creator';
  return (
    <TouchableOpacity
      style={[styles.card, compact && styles.cardCompact, product.featured && styles.cardFeatured]}
      onPress={onPress}
      activeOpacity={0.85}
      testID={`product-${product.product_id}`}
    >
      <View style={styles.thumbWrap}>
        {product.thumbnail_url ? (
          <Image source={{ uri: product.thumbnail_url }} style={styles.thumb} />
        ) : (
          <LinearGradient colors={gradient} style={[styles.thumb, styles.thumbFallback]}>
            <TypeIcon size={36} color="rgba(245,166,35,0.75)" strokeWidth={1.5} />
            <Text style={styles.thumbFallbackTxt}>{TYPE_LABELS[product.type] || 'Pack'}</Text>
          </LinearGradient>
        )}
        {product.featured ? (
          <View style={styles.featuredPill}>
            <Text style={styles.featuredTxt}>★ FEATURED</Text>
          </View>
        ) : null}
        <View style={styles.typeChip}>
          <Text style={styles.typeChipTxt}>{TYPE_LABELS[product.type] || product.type}</Text>
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={compact ? 2 : 2}>{product.title}</Text>
        <View style={styles.sellerRow}>
          {product.seller?.avatar_url ? (
            <Image source={{ uri: product.seller.avatar_url }} style={styles.sellerAvatar} />
          ) : (
            <View style={[styles.sellerAvatar, styles.sellerAvatarFallback]}>
              <Text style={styles.sellerInitials}>{initials(displayName)}</Text>
            </View>
          )}
          <Text style={styles.sellerName} numberOfLines={1}>
            {displayName}
          </Text>
          {isVerified ? <ShieldCheck size={10} color="#3b82f6" /> : null}
          <UserBadge user={product.seller} variant="inline" />
        </View>

        <View style={styles.footerRow}>
          <Text style={styles.price}>{fmtPrice(product.price_cents, product.currency)}</Text>
          <View style={styles.ratingRow}>
            <Star size={10} color={colors.primary} fill={colors.primary} strokeWidth={0} />
            <Text style={styles.ratingTxt}>
              {product.rating_count > 0 ? product.rating_avg.toFixed(1) : '—'}
              {product.rating_count > 0 ? ` (${product.rating_count})` : ''}
            </Text>
          </View>
        </View>
        {product.sales_count > 0 ? (
          <Text style={styles.salesTxt}>{product.sales_count} sold</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.lg, overflow: 'hidden',
    marginBottom: space.md,
  },
  cardCompact: { width: 220, marginRight: space.sm, marginBottom: 0 },
  cardFeatured: { borderColor: colors.primary },

  thumbWrap: { position: 'relative', aspectRatio: 4 / 3, backgroundColor: colors.surface2 },
  thumb: { width: '100%', height: '100%' },
  thumbFallback: { alignItems: 'center', justifyContent: 'center', gap: 6 },
  thumbFallbackTxt: {
    color: 'rgba(245,166,35,0.55)',
    fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 1.4,
  },
  featuredPill: {
    position: 'absolute', top: 8, left: 8,
    paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: colors.primary, borderRadius: radii.sm,
  },
  featuredTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.5 },
  typeChip: {
    position: 'absolute', top: 8, right: 8,
    paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: radii.sm,
  },
  typeChipTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.3 },

  body: { padding: 12, gap: 6 },
  title: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14, lineHeight: 18 },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sellerAvatar: { width: 18, height: 18, borderRadius: 9 },
  sellerAvatarFallback: {
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  sellerInitials: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 8 },
  sellerName: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, flex: 1 },

  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  price: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 15 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  salesTxt: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10 },
});
