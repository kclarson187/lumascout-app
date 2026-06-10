/**
 * Data Quality Scoring (silent / internal).
 *
 * Phase 2 — Add Location Optimization (Jun 2026).
 *
 * Computes a 0..100 quality score for a draft spot BEFORE submission
 * so the moderation queue can prioritise high-signal contributions and
 * later surface friendly "improve this spot" nudges. The score is sent
 * with the create payload as `data_quality_score` and a structured
 * `data_quality_signals` map (so admins can see which axes were weak).
 *
 * The visible "quality_score" on the spot doc remains the server-side
 * computation — this score is an additional input, not a replacement.
 */

export type DraftLike = {
  images?: { image_url: string }[];
  title?: string;
  city?: string;
  latitude?: number | null;
  longitude?: number | null;
  shoot_types?: string[];
  style_tags?: string[];
  notes?: string;
  description?: string;
  best_time_of_day?: string;
  best_light_notes?: string;
  parking_notes?: string;
  parking_rating?: number;
  walk_rating?: number;
  permit_required?: boolean;
  safety_rating?: number;
  crowd_level?: number;
  lens_recommendations?: string;
  best_lens_range?: string;
  best_months?: string[];
  land_access?: string;
  access_notes?: string;
  // provenance
  sourceType?: 'camera_capture' | 'gallery_upload' | 'manual_entry';
  gpsAccuracy?: number | null;
};

export type QualitySignals = {
  has_pin: boolean;
  has_photo: boolean;
  multiple_photos: boolean;
  has_tip: boolean;
  has_category: boolean;
  has_best_time: boolean;
  has_parking: boolean;
  has_safety: boolean;
  has_permit_notes: boolean;
  has_lens_tips: boolean;
  has_season_value: boolean;
  has_crowd_level: boolean;
  has_on_site_capture: boolean;
  has_tight_gps: boolean;
};

const WEIGHTS: Record<keyof QualitySignals, number> = {
  has_pin: 18,
  has_photo: 18,
  multiple_photos: 6,
  has_tip: 8,
  has_category: 8,
  has_best_time: 6,
  has_parking: 6,
  has_safety: 6,
  has_permit_notes: 4,
  has_lens_tips: 5,
  has_season_value: 4,
  has_crowd_level: 4,
  has_on_site_capture: 4,
  has_tight_gps: 3,
};

const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0); // 100

export function computeDataQuality(d: DraftLike): {
  score: number;
  signals: QualitySignals;
} {
  const signals: QualitySignals = {
    has_pin: d.latitude != null && d.longitude != null
      && !(d.latitude === 0 && d.longitude === 0),
    has_photo: Array.isArray(d.images) && d.images.length >= 1,
    multiple_photos: Array.isArray(d.images) && d.images.length >= 2,
    has_tip: !!(d.notes && d.notes.trim().length >= 12)
      || !!(d.description && d.description.trim().length >= 12),
    has_category: Array.isArray(d.shoot_types) && d.shoot_types.length >= 1,
    has_best_time: !!d.best_time_of_day
      || !!(d.best_light_notes && d.best_light_notes.trim().length >= 4),
    has_parking: !!(d.parking_notes && d.parking_notes.trim().length >= 4)
      || (typeof d.parking_rating === 'number' && d.parking_rating > 0),
    has_safety: typeof d.safety_rating === 'number' && d.safety_rating > 0,
    has_permit_notes: !!d.permit_required
      || !!(d.access_notes && d.access_notes.trim().length >= 4)
      || (!!d.land_access && d.land_access !== 'unsure'),
    has_lens_tips: !!(d.lens_recommendations && d.lens_recommendations.trim().length >= 3)
      || !!(d.best_lens_range && d.best_lens_range.trim().length >= 3),
    has_season_value: Array.isArray(d.best_months) && d.best_months.length >= 1,
    has_crowd_level: typeof d.crowd_level === 'number' && d.crowd_level > 0,
    has_on_site_capture: d.sourceType === 'camera_capture',
    has_tight_gps: typeof d.gpsAccuracy === 'number'
      && d.gpsAccuracy > 0 && d.gpsAccuracy <= 25,
  };

  let raw = 0;
  (Object.keys(signals) as Array<keyof QualitySignals>).forEach((k) => {
    if (signals[k]) raw += WEIGHTS[k];
  });
  const score = Math.max(0, Math.min(100, Math.round((raw / TOTAL_WEIGHT) * 100)));
  return { score, signals };
}

/** Friendly label bucket for an internal score. NOT shown publicly. */
export function qualityBucket(score: number): 'low' | 'medium' | 'high' {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}
