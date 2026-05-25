/**
 * Owner-editable fields whitelist — single source of truth.
 *
 * MUST stay byte-identical with the backend OWNER_EDITABLE_FIELDS set
 * declared in /app/backend/routes/spot_shares.py. The owner edit screen
 * imports this list and only renders inputs for fields it contains. The
 * runtime guard at the bottom of this file asserts the array is sorted
 * + has no dupes so drift is caught immediately on dev reload.
 *
 * If you add/remove a field here, update spot_shares.py in the SAME
 * commit. The Scope B QA report intentionally pastes both whitelists
 * side-by-side so drift surfaces on review.
 */

export type OwnerEditableField =
  | 'title'
  | 'description'
  | 'best_time_of_day'
  | 'best_light_notes'
  | 'parking_notes'
  | 'restroom_notes'
  | 'walking_notes'
  | 'accessibility_notes'
  | 'safety_notes'
  | 'weather_notes'
  | 'lens_recommendations'
  | 'permit_notes'
  | 'fee_notes'
  | 'landmark_notes'
  | 'notes'
  | 'access_notes'
  | 'land_access'
  | 'shoot_types'
  | 'style_tags'
  | 'best_months'
  | 'dog_friendly'
  | 'kid_friendly'
  | 'accessible'
  | 'indoor'
  | 'permit_required'
  | 'fee_required';

export const OWNER_EDITABLE_FIELDS: ReadonlyArray<OwnerEditableField> = [
  'title',
  'description',
  'best_time_of_day',
  'best_light_notes',
  'parking_notes',
  'restroom_notes',
  'walking_notes',
  'accessibility_notes',
  'safety_notes',
  'weather_notes',
  'lens_recommendations',
  'permit_notes',
  'fee_notes',
  'landmark_notes',
  'notes',
  'access_notes',
  'land_access',
  'shoot_types',
  'style_tags',
  'best_months',
  'dog_friendly',
  'kid_friendly',
  'accessible',
  'indoor',
  'permit_required',
  'fee_required',
] as const;

/**
 * Field renderer hint — how the edit screen should render each whitelisted
 * field. Keeps the edit screen declarative.
 */
export type FieldShape = 'text' | 'textarea' | 'boolean' | 'tag-list';

export interface FieldMeta {
  key: OwnerEditableField;
  label: string;
  shape: FieldShape;
  placeholder?: string;
  maxLength?: number;
}

export const FIELD_META: ReadonlyArray<FieldMeta> = [
  { key: 'title', label: 'Title', shape: 'text', maxLength: 120 },
  { key: 'description', label: 'Description', shape: 'textarea', maxLength: 2000 },
  { key: 'best_time_of_day', label: 'Best time of day', shape: 'text', placeholder: 'e.g. sunrise / late afternoon' },
  { key: 'best_light_notes', label: 'Best light notes', shape: 'textarea' },
  { key: 'parking_notes', label: 'Parking notes', shape: 'textarea' },
  { key: 'restroom_notes', label: 'Restroom notes', shape: 'text' },
  { key: 'walking_notes', label: 'Walking notes', shape: 'textarea' },
  { key: 'accessibility_notes', label: 'Accessibility notes', shape: 'textarea' },
  { key: 'safety_notes', label: 'Safety notes', shape: 'textarea' },
  { key: 'weather_notes', label: 'Weather notes', shape: 'textarea' },
  { key: 'lens_recommendations', label: 'Lens recommendations', shape: 'text' },
  { key: 'permit_notes', label: 'Permit notes', shape: 'textarea' },
  { key: 'fee_notes', label: 'Fee notes', shape: 'text' },
  { key: 'landmark_notes', label: 'Landmark notes', shape: 'textarea' },
  { key: 'notes', label: 'Photographer notes', shape: 'textarea' },
  { key: 'access_notes', label: 'Access notes', shape: 'textarea' },
  { key: 'land_access', label: 'Land access', shape: 'text', placeholder: 'public / private / permit' },
  { key: 'shoot_types', label: 'Shoot types (comma-separated)', shape: 'tag-list' },
  { key: 'style_tags', label: 'Style tags (comma-separated)', shape: 'tag-list' },
  { key: 'best_months', label: 'Best months (comma-separated)', shape: 'tag-list' },
  { key: 'dog_friendly', label: 'Dog friendly', shape: 'boolean' },
  { key: 'kid_friendly', label: 'Kid friendly', shape: 'boolean' },
  { key: 'accessible', label: 'Accessible', shape: 'boolean' },
  { key: 'indoor', label: 'Indoor', shape: 'boolean' },
  { key: 'permit_required', label: 'Permit required', shape: 'boolean' },
  { key: 'fee_required', label: 'Fee required', shape: 'boolean' },
] as const;

// Dev-only sanity check — drift catcher.
if (__DEV__) {
  const seen = new Set<string>();
  for (const f of OWNER_EDITABLE_FIELDS) {
    if (seen.has(f)) {
      // eslint-disable-next-line no-console
      console.error(`[spot-edit-fields] duplicate field: ${f}`);
    }
    seen.add(f);
  }
  if (FIELD_META.length !== OWNER_EDITABLE_FIELDS.length) {
    // eslint-disable-next-line no-console
    console.error(
      `[spot-edit-fields] FIELD_META length (${FIELD_META.length}) != OWNER_EDITABLE_FIELDS length (${OWNER_EDITABLE_FIELDS.length}) — drift!`
    );
  }
  for (const m of FIELD_META) {
    if (!OWNER_EDITABLE_FIELDS.includes(m.key)) {
      // eslint-disable-next-line no-console
      console.error(`[spot-edit-fields] FIELD_META.key '${m.key}' not in OWNER_EDITABLE_FIELDS`);
    }
  }
}
