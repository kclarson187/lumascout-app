/**
 * ProductCard — premium reusable marketplace card.
 * Two variants: compact (rails) and full (grid/list).
 */
import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { Star, Package, ShieldCheck } from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';

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

function fmtPrice(cents: number, currency = 'USD'): string {
  if (cents === 0) return 'Free';
  const dollars = (cents / 100).toFixed(2);
  return currency === 'USD' ? `$${dollars}` : `${dollars} ${currency}`;
}

export default function ProductCard({
  product, compact, onPress,
}: {
  product: Product; compact?: boolean; onPress: () => void;
}) {
  const isVerified = product.seller?.verification_status === 'verified';
  const isElite = product.seller?.plan === 'elite';
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
          <View style={[styles.thumb, styles.thumbFallback]}>
            <Package size={28} color={colors.textTertiary} />
          </View>
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
            <View style={[styles.sellerAvatar, { backgroundColor: colors.surface2 }]} />
          )}
          <Text style={styles.sellerName} numberOfLines={1}>
            {product.seller?.name}
          </Text>
          {isVerified ? <ShieldCheck size={10} color="#3b82f6" /> : null}
          {isElite ? (
            <Star size={10} color={colors.primary} fill={colors.primary} strokeWidth={0} />
          ) : null}
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
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
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
  sellerName: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, flex: 1 },

  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  price: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 15 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  salesTxt: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10 },
});
