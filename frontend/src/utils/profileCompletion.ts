/**
 * profileCompletion.ts — Client-side mirror of the backend computation.
 *
 * Kept in sync with `_compute_profile_completion_percent` and
 * `_compute_directory_eligibility` in /app/backend/server.py so the
 * frontend can render progress + eligibility without waiting on a
 * server round-trip (the server values still win as the source of
 * truth when /auth/me responds).
 *
 * Used for:
 *   • optimistic UI on the profile basics screen ("Saving… 60% → 80%")
 *   • directory eligibility hint chips on the photographer screen
 *   • the "Complete your profile" suggestion card on the profile tab
 */

export type ProfileLike = {
  first_name?: string | null;
  display_name?: string | null;
  name?: string | null;
  username?: string | null;
  home_area?: string | null;
  city?: string | null;
  state?: string | null;
  profile_photo_url?: string | null;
  avatar_url?: string | null;
  avatar_image_url?: string | null;
  bio?: string | null;
  specialties?: string[] | null;
  portfolio_url?: string | null;
  website?: string | null;
  sample_image_urls?: string[] | null;
  experience_level?: string | null;
  goals?: string[] | null;
};

export type DirectoryStatus = {
  eligible: boolean;
  missing: Array<'profile_photo' | 'specialty' | 'portfolio_or_samples' | 'bio'>;
};

function nonEmpty(s?: string | null): boolean {
  return !!(s && String(s).trim().length > 0);
}

export function hasPhoto(u: ProfileLike): boolean {
  return nonEmpty(u.profile_photo_url) || nonEmpty(u.avatar_url) || nonEmpty(u.avatar_image_url);
}

export function hasHomeArea(u: ProfileLike): boolean {
  if (nonEmpty(u.home_area)) return true;
  return nonEmpty(u.city) && nonEmpty(u.state);
}

export function computeDirectoryStatus(u: ProfileLike): DirectoryStatus {
  const missing: DirectoryStatus['missing'] = [];
  if (!hasPhoto(u)) missing.push('profile_photo');
  if (!(u.specialties && u.specialties.length >= 1)) missing.push('specialty');
  const portfolio = u.portfolio_url || u.website || '';
  const samples = u.sample_image_urls || [];
  if (!nonEmpty(portfolio) && samples.length < 3) missing.push('portfolio_or_samples');
  if (!u.bio || u.bio.trim().length < 60) missing.push('bio');
  return { eligible: missing.length === 0, missing };
}

/** 0-100. Mirrors backend weights so the optimistic UI stays in sync. */
export function computeCompletionPercent(u: ProfileLike): number {
  let pts = 0;
  if (nonEmpty(u.first_name)) pts += 10;
  if (nonEmpty(u.display_name) || nonEmpty(u.name)) pts += 10;
  if (nonEmpty(u.username)) pts += 10;
  if (hasHomeArea(u)) pts += 10;
  if (hasPhoto(u)) pts += 10;
  if ((u.bio || '').trim().length >= 60) pts += 15;
  if (u.specialties && u.specialties.length >= 1) pts += 10;
  const portfolio = u.portfolio_url || u.website || '';
  const samples = u.sample_image_urls || [];
  if (nonEmpty(portfolio) || samples.length >= 3) pts += 15;
  if (nonEmpty(u.experience_level)) pts += 5;
  if (u.goals && u.goals.length >= 1) pts += 5;
  return Math.max(0, Math.min(100, pts));
}

/** Human-friendly label for a missing-directory key. */
export function labelForMissing(
  k: DirectoryStatus['missing'][number],
): string {
  switch (k) {
    case 'profile_photo':         return 'Add a profile photo';
    case 'specialty':             return 'Choose at least 1 specialty';
    case 'portfolio_or_samples':  return 'Add a portfolio link or 3 sample photos';
    case 'bio':                   return 'Write a bio (60+ characters)';
    default:                      return k;
  }
}
