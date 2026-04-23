/**
 * Pack Marketplace — Product Detail page.
 * Path: /marketplace/[id]
 *
 * Premium pack / preset / guide buy page.
 * Gallery · Creator · Description · What's included · Reviews · Buy · Wishlist.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
  Alert,
  Modal,
  Dimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft, Bookmark, BookmarkCheck, Star, ShieldCheck, Share2,
  Sparkles, Check, Package, MessageCircle, Edit3, Flag,
} from 'lucide-react-native';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import ProductCard, { Product } from '../../src/components/ProductCard';

const { width: SCREEN_W } = Dimensions.get('window');
const GALLERY_H = Math.min(360, SCREEN_W * 0.85);

function fmtPrice(cents: number, currency = 'USD'): string {
  if (cents === 0) return 'Free';
  const d = (cents / 100).toFixed(2);
  return currency === 'USD' ? `$${d}` : `${d} ${currency}`;
}

export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const [product, setProduct] = useState<Product | null>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [related, setRelated] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [buying, setBuying] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [showMockModal, setShowMockModal] = useState(false);
  const [mockMeta, setMockMeta] = useState<any>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);

  const isOwner = !!user && product?.seller?.user_id === user.user_id;
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [p, rv] = await Promise.all([
        api.get(`/marketplace/products/${id}`),
        api.get(`/marketplace/products/${id}/reviews`),
      ]);
      setProduct(p);
      setReviews(rv.items || []);
      // Related by type
      try {
        const rel = await api.get('/marketplace/products', { type: p.type, limit: 8 });
        setRelated((rel.items || []).filter((x: Product) => x.product_id !== p.product_id).slice(0, 6));
      } catch {}
    } catch (e: any) {
      Alert.alert('Could not load product', e?.response?.data?.detail || e?.message || 'Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const gallery = useMemo(() => {
    if (!product) return [] as string[];
    const arr: string[] = [];
    if (product.thumbnail_url) arr.push(product.thumbnail_url);
    (product.preview_urls || []).forEach((u) => { if (u && !arr.includes(u)) arr.push(u); });
    return arr;
  }, [product]);

  const onBuy = async () => {
    if (!product) return;
    if (buying) return;
    if (product.has_purchased) { router.push('/me/library' as any); return; }
    setBuying(true);
    try {
      const r = await api.post(`/marketplace/products/${product.product_id}/checkout`);
      if (r.already_owned) {
        router.push('/me/library' as any);
        return;
      }
      if (r.mocked) {
        if (r.auto_completed) {
          await load();
          Alert.alert('Added to Library', 'Free download unlocked. Find it in My Purchases.');
          router.push('/me/library' as any);
          return;
        }
        setMockMeta({ ...r, title: product.title });
        setShowMockModal(true);
        return;
      }
      if (r.url) {
        // Stripe hosted checkout URL
        const WebBrowser = await import('expo-web-browser');
        await WebBrowser.openBrowserAsync(r.url);
        // After browser closes, refresh to see if webhook fired
        setTimeout(load, 1200);
      }
    } catch (e: any) {
      Alert.alert('Checkout failed', e?.response?.data?.detail || e?.message || 'Please try again.');
    } finally {
      setBuying(false);
    }
  };

  const completeMockPurchase = async () => {
    if (!mockMeta?.purchase_id) return;
    try {
      await api.post(`/marketplace/purchases/${mockMeta.purchase_id}/complete`, {});
      setShowMockModal(false);
      await load();
      Alert.alert('🎉 Purchase complete', 'Your pack is unlocked. Find it in My Purchases.');
      router.push('/me/library' as any);
    } catch (e: any) {
      Alert.alert('Payment failed', e?.response?.data?.detail || 'Please try again.');
    }
  };

  const toggleWishlist = async () => {
    if (!product || toggling) return;
    setToggling(true);
    try {
      const r = await api.post(`/marketplace/wishlist/${product.product_id}`, {});
      setProduct({ ...product, in_wishlist: r.in_wishlist });
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Could not update wishlist.');
    } finally { setToggling(false); }
  };

  const contactSeller = () => {
    if (!product?.seller?.user_id) return;
    router.push(`/inbox/new?to=${product.seller.user_id}` as any);
  };

  if (loading || !product) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const onRefresh = () => { setRefreshing(true); load(); };

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.hBtn} hitSlop={10} testID="pd-back">
          <ArrowLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={toggleWishlist} style={styles.hBtn} hitSlop={10} disabled={toggling} testID="pd-wishlist">
          {product.in_wishlist ? (
            <BookmarkCheck size={22} color={colors.primary} fill={colors.primary} />
          ) : (
            <Bookmark size={22} color={colors.text} />
          )}
        </TouchableOpacity>
        {isOwner && (
          <TouchableOpacity onPress={() => router.push(`/marketplace/edit/${product.product_id}` as any)} style={styles.hBtn} hitSlop={10} testID="pd-edit">
            <Edit3 size={20} color={colors.text} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Gallery */}
        <View style={styles.gallery}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
              setGalleryIdx(idx);
            }}
          >
            {gallery.map((u, i) => (
              <Image key={i} source={{ uri: u }} style={{ width: SCREEN_W, height: GALLERY_H }} resizeMode="cover" />
            ))}
          </ScrollView>
          {gallery.length > 1 && (
            <View style={styles.dots}>
              {gallery.map((_, i) => (
                <View key={i} style={[styles.dot, i === galleryIdx && styles.dotActive]} />
              ))}
            </View>
          )}
          {product.featured && (
            <View style={styles.featuredChip}>
              <Sparkles size={12} color={colors.textInverse} />
              <Text style={styles.featuredTxt}>FEATURED</Text>
            </View>
          )}
        </View>

        {/* Title + price */}
        <View style={styles.section}>
          <Text style={styles.typeLabel}>{(product.type || '').toUpperCase()}</Text>
          <Text style={styles.title}>{product.title}</Text>
          <View style={styles.priceRow}>
            <Text style={styles.price}>{fmtPrice(product.price_cents, product.currency)}</Text>
            <View style={styles.ratingRow}>
              <Star size={14} color={colors.primary} fill={colors.primary} strokeWidth={0} />
              <Text style={styles.ratingTxt}>
                {product.rating_count > 0 ? product.rating_avg.toFixed(1) : 'No reviews'}
                {product.rating_count > 0 ? ` · ${product.rating_count} review${product.rating_count === 1 ? '' : 's'}` : ''}
              </Text>
              <Text style={styles.dotSep}>·</Text>
              <Text style={styles.ratingTxt}>{product.sales_count} sold</Text>
            </View>
          </View>
        </View>

        {/* Seller card */}
        <TouchableOpacity
          style={styles.sellerCard}
          onPress={() => product.seller?.user_id && router.push(`/user/${product.seller.user_id}` as any)}
          activeOpacity={0.7}
        >
          {product.seller?.avatar_url ? (
            <Image source={{ uri: product.seller.avatar_url }} style={styles.sellerAvatar} />
          ) : (
            <View style={[styles.sellerAvatar, { backgroundColor: colors.surface2 }]} />
          )}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text style={styles.sellerName}>{product.seller?.name}</Text>
              {product.seller?.verification_status === 'verified' && <ShieldCheck size={12} color="#3b82f6" />}
              {product.seller?.plan === 'elite' && <Star size={12} color={colors.primary} fill={colors.primary} strokeWidth={0} />}
            </View>
            <Text style={styles.sellerHandle}>@{product.seller?.username || '—'}{product.seller?.city ? ` · ${product.seller.city}` : ''}</Text>
          </View>
          <TouchableOpacity onPress={contactSeller} hitSlop={10} style={styles.contactBtn}>
            <MessageCircle size={14} color={colors.primary} />
            <Text style={styles.contactTxt}>Message</Text>
          </TouchableOpacity>
        </TouchableOpacity>

        {/* Description */}
        <View style={styles.section}>
          <Text style={styles.sectionHead}>About this pack</Text>
          <Text style={styles.description}>{product.description}</Text>
        </View>

        {/* What's included */}
        <View style={styles.section}>
          <Text style={styles.sectionHead}>What's included</Text>
          {deriveIncludes(product).map((inc, i) => (
            <View key={i} style={styles.incRow}>
              <View style={styles.incIconWrap}><Check size={14} color={colors.success} /></View>
              <Text style={styles.incTxt}>{inc}</Text>
            </View>
          ))}
        </View>

        {/* Tags */}
        {product.tags && product.tags.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHead}>Tags</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {product.tags.map((t) => (
                <View key={t} style={styles.tag}><Text style={styles.tagTxt}>#{t}</Text></View>
              ))}
            </View>
          </View>
        )}

        {/* Reviews */}
        <View style={styles.section}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[styles.sectionHead, { flex: 1 }]}>Reviews ({reviews.length})</Text>
            {product.has_purchased && (
              <TouchableOpacity onPress={() => setShowReviewModal(true)}>
                <Text style={styles.writeRev}>Write a review</Text>
              </TouchableOpacity>
            )}
          </View>
          {reviews.length === 0 ? (
            <Text style={styles.emptyRev}>Be the first to review this pack.</Text>
          ) : (
            reviews.slice(0, 5).map((r: any) => (
              <View key={r.review_id} style={styles.revCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  {r.reviewer?.avatar_url ? (
                    <Image source={{ uri: r.reviewer.avatar_url }} style={{ width: 22, height: 22, borderRadius: 11 }} />
                  ) : <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surface2 }} />}
                  <Text style={styles.revName}>{r.reviewer?.name || 'Anonymous'}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
                    {Array.from({ length: r.rating }).map((_, i) => (
                      <Star key={i} size={10} color={colors.primary} fill={colors.primary} strokeWidth={0} />
                    ))}
                  </View>
                </View>
                {r.text ? <Text style={styles.revTxt}>{r.text}</Text> : null}
              </View>
            ))
          )}
        </View>

        {/* Related */}
        {related.length > 0 && (
          <View style={{ marginTop: space.md }}>
            <Text style={[styles.sectionHead, { paddingHorizontal: space.xl }]}>You may also like</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.xl, paddingVertical: space.md }}>
              {related.map((p) => (
                <ProductCard
                  key={p.product_id}
                  product={p}
                  compact
                  onPress={() => router.replace(`/marketplace/${p.product_id}` as any)}
                />
              ))}
            </ScrollView>
          </View>
        )}

        <View style={{ padding: space.xl, alignItems: 'center' }}>
          <TouchableOpacity onPress={() => Alert.alert('Thanks', 'Reports go to our moderation team.')}
            style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <Flag size={12} color={colors.textTertiary} />
            <Text style={{ color: colors.textTertiary, fontFamily: font.body, fontSize: 12 }}>Report this product</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Bottom Buy bar */}
      <View style={styles.buyBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.barPrice}>{fmtPrice(product.price_cents, product.currency)}</Text>
          <Text style={styles.barSub}>{product.has_purchased ? 'You own this' : '30-day refund policy'}</Text>
        </View>
        <TouchableOpacity
          style={[styles.buyBtn, (buying || isOwner) && { opacity: 0.5 }]}
          onPress={onBuy}
          disabled={buying || isOwner}
          testID="pd-buy"
        >
          {buying ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.buyTxt}>
              {isOwner ? 'Your product'
                : product.has_purchased ? 'View in library'
                : product.price_cents === 0 ? 'Get for free'
                : 'Buy now'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Mock checkout modal */}
      <Modal visible={showMockModal} transparent animationType="slide" onRequestClose={() => setShowMockModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.stripeBadge}>
              <Sparkles size={14} color={colors.primary} />
              <Text style={styles.stripeBadgeTxt}>Secure checkout · demo mode</Text>
            </View>
            <Text style={styles.modalTitle}>Confirm your purchase</Text>
            <Text style={styles.modalSub}>{mockMeta?.title}</Text>
            <View style={styles.checkoutLine}>
              <Text style={styles.checkoutK}>Subtotal</Text>
              <Text style={styles.checkoutV}>{fmtPrice(mockMeta?.price_cents ?? 0)}</Text>
            </View>
            <View style={styles.checkoutLine}>
              <Text style={styles.checkoutK}>Platform fee (15%)</Text>
              <Text style={styles.checkoutVmuted}>{fmtPrice(mockMeta?.platform_fee_cents ?? 0)}</Text>
            </View>
            <View style={[styles.checkoutLine, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 6 }]}>
              <Text style={[styles.checkoutK, { fontFamily: font.bodyBold }]}>Total charged</Text>
              <Text style={[styles.checkoutV, { fontFamily: font.bodyBold, fontSize: 18 }]}>{fmtPrice(mockMeta?.price_cents ?? 0)}</Text>
            </View>
            <Text style={styles.modalNote}>
              Real Stripe payments are wired — this sandbox simulates completion so you can demo the entire funnel.
            </Text>
            <TouchableOpacity style={styles.buyBtn} onPress={completeMockPurchase}>
              <Text style={styles.buyTxt}>Pay {fmtPrice(mockMeta?.price_cents ?? 0)}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowMockModal(false)} style={{ marginTop: 10, alignItems: 'center' }}>
              <Text style={{ color: colors.textTertiary, fontFamily: font.body, fontSize: 13 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <WriteReviewModal
        visible={showReviewModal}
        onClose={() => setShowReviewModal(false)}
        productId={product.product_id}
        onSubmitted={() => { setShowReviewModal(false); load(); }}
      />
    </SafeAreaView>
  );
}

function deriveIncludes(p: Product): string[] {
  const map: Record<string, string[]> = {
    preset: ['Desktop + mobile DNG presets', 'Quick-start PDF', 'Free future updates'],
    spot_pack: ['GPS pins for every location', 'Best-time notes', 'Sample reference images'],
    city_guide: ['Full PDF guide (instant download)', 'Seasonal timing tips', 'Permit & parking notes'],
    route_pack: ['Hour-by-hour itinerary', 'Backup rainy-day stops', 'Drive-time + parking notes'],
    lut: ['.cube LUT files', 'Premiere / DaVinci / FCPX compatible', 'Before/after examples'],
    template: ['Editable Google Doc / Notion templates', 'Print-ready PDF', 'Legal-reviewed copy'],
    mentorship: ['45-minute 1:1 Zoom call', 'Personalized follow-up notes', 'Portfolio pricing audit'],
  };
  return map[p.type] || ['Instant download after purchase', 'Lifetime access to future updates'];
}

function WriteReviewModal({
  visible, onClose, productId, onSubmitted,
}: { visible: boolean; onClose: () => void; productId: string; onSubmitted: () => void }) {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { TextInput } = require('react-native');
  const submit = async () => {
    setSubmitting(true);
    try {
      await api.post(`/marketplace/products/${productId}/reviews`, { rating, text: text.trim() || null });
      onSubmitted();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Could not submit review.');
    } finally { setSubmitting(false); }
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Rate this pack</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginVertical: 10 }}>
            {[1,2,3,4,5].map((n) => (
              <TouchableOpacity key={n} onPress={() => setRating(n)} hitSlop={6}>
                <Star size={30} color={colors.primary} fill={n <= rating ? colors.primary : 'transparent'} />
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            multiline
            placeholder="Tell other photographers what you loved (optional)"
            placeholderTextColor={colors.textTertiary}
            value={text}
            onChangeText={setText}
            maxLength={1000}
            style={styles.reviewInput}
          />
          <TouchableOpacity style={styles.buyBtn} onPress={submit} disabled={submitting}>
            {submitting ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.buyTxt}>Post review</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={{ marginTop: 10, alignItems: 'center' }}>
            <Text style={{ color: colors.textTertiary, fontFamily: font.body, fontSize: 13 }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: 6,
  },
  hBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  gallery: { position: 'relative', backgroundColor: colors.surface1 },
  dots: { position: 'absolute', bottom: 10, alignSelf: 'center', flexDirection: 'row', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive: { backgroundColor: colors.primary, width: 14 },
  featuredChip: {
    position: 'absolute', top: 14, left: 14,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radii.sm,
  },
  featuredTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.8 },

  section: { paddingHorizontal: space.xl, paddingTop: space.xl },
  typeLabel: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 1.2, marginBottom: 4 },
  title: { color: colors.text, fontFamily: font.display, fontSize: 24, lineHeight: 30 },
  priceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, justifyContent: 'space-between' },
  price: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 22 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingTxt: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },
  dotSep: { color: colors.textTertiary, marginHorizontal: 2 },

  sectionHead: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14, marginBottom: 10, letterSpacing: 0.2 },
  description: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, lineHeight: 21 },

  sellerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: space.xl, marginTop: space.xl,
    padding: 12,
    borderRadius: radii.lg,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  sellerAvatar: { width: 40, height: 40, borderRadius: 20 },
  sellerName: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  sellerHandle: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  contactBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderWidth: 1, borderColor: colors.primary,
  },
  contactTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 11 },

  incRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 7 },
  incIconWrap: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(16,185,129,0.15)',
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  incTxt: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, flex: 1, lineHeight: 19 },

  tag: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radii.pill },
  tagTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },

  writeRev: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 12 },
  emptyRev: { color: colors.textTertiary, fontFamily: font.body, fontSize: 13 },
  revCard: { marginBottom: 10, padding: 10, backgroundColor: colors.surface1, borderRadius: radii.md },
  revName: { color: colors.text, fontFamily: font.bodyBold, fontSize: 12 },
  revTxt: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 19 },

  buyBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: space.xl, paddingVertical: 14, paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    backgroundColor: colors.surface1,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  barPrice: { color: colors.text, fontFamily: font.bodyBold, fontSize: 18 },
  barSub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 1 },
  buyBtn: {
    paddingHorizontal: 22, paddingVertical: 13,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    minWidth: 130,
  },
  buyTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: {
    padding: space.xl, paddingBottom: 34,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderWidth: 1, borderColor: colors.border,
  },
  stripeBadge: {
    alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(245,166,35,0.15)',
    paddingVertical: 6, paddingHorizontal: 12,
    borderRadius: radii.pill, marginBottom: 14,
  },
  stripeBadgeTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.5 },
  modalTitle: { color: colors.text, fontFamily: font.display, fontSize: 20, textAlign: 'center' },
  modalSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 16 },
  checkoutLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  checkoutK: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13 },
  checkoutV: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 14 },
  checkoutVmuted: { color: colors.textTertiary, fontFamily: font.body, fontSize: 12 },
  modalNote: {
    color: colors.textTertiary, fontFamily: font.body, fontSize: 11,
    textAlign: 'center', marginVertical: 14, lineHeight: 16,
  },
  reviewInput: {
    minHeight: 100,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md, padding: 12,
    color: colors.text, fontFamily: font.body, fontSize: 13,
    textAlignVertical: 'top',
    marginVertical: 8,
  },
});
