/**
 * Single source of truth for role metadata across the app.
 *
 * Hierarchy (low → high):
 *   user → founding_scout → moderator → support → admin → super_admin
 *
 * Founding Scout is an HONORARY early-member role. Its permission level
 * is 0 (same as user) — the only behavioral difference is automatic
 * comp-Elite entitlement, which the backend plan_of() attaches server-
 * side. The frontend reads `user.plan === "comp_elite"` for gating;
 * roles are ONLY used for badges, chips, and admin UI.
 */
import { ImageSourcePropType } from 'react-native';

export type RoleKey =
  | 'user'
  | 'founding_scout'
  | 'moderator'
  | 'support'
  | 'admin'
  | 'super_admin';

export type RoleDef = {
  key: RoleKey;
  label: string;
  emoji: string;
  tagline: string;
  powers: string[];
  color: string;
  /** For the hierarchy card & sort order. Lower = lower rank. */
  level: number;
  /** Optional PNG badge asset — founding_scout has custom artwork. */
  badgeImage?: ImageSourcePropType;
};

export const ROLE_DEFS: Record<RoleKey, RoleDef> = {
  user: {
    key: 'user',
    label: 'User',
    emoji: '👤',
    tagline: 'Standard photographer account',
    color: '#6b7280',
    level: 0,
    powers: [
      'Post, comment, save spots, message other users',
      'Report content for moderation review',
      'No access to admin tools',
    ],
  },
  founding_scout: {
    key: 'founding_scout',
    label: 'Founding Scout',
    emoji: '🏅',
    tagline: 'Early-access member — helped shape LumaScout before public launch',
    color: '#F5A623', // LumaScout primary gold — premium, honorary
    level: 1,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    badgeImage: require('../../assets/badges/founding_scout.png'),
    powers: [
      'Everything standard users can do',
      'Recognized as a founding member of the LumaScout community',
      'Includes free Elite membership access',
      'May receive early access, special perks, or complimentary premium',
      'No moderation or admin powers',
    ],
  },
  moderator: {
    key: 'moderator',
    label: 'Moderator',
    emoji: '🛡️',
    tagline: 'Content policeperson — keeps the feed clean',
    color: '#3b82f6',
    level: 2,
    powers: [
      'Hide / restore / pin / feature / lock posts',
      'Mark content as spam + resolve community reports',
      'Approve or reject spots and community uploads',
      'Cannot ban users, cannot hard-delete, cannot change roles',
    ],
  },
  support: {
    key: 'support',
    label: 'Support',
    emoji: '🎧',
    tagline: 'Read-heavy staff — helps users, rarely moderates',
    color: '#14b8a6',
    level: 3,
    powers: [
      'View user profiles + tickets + audit trails',
      'Respond to support requests',
      'Same moderation read-access as moderator, limited write',
      'Cannot ban users or change roles',
    ],
  },
  admin: {
    key: 'admin',
    label: 'Admin',
    emoji: '⚙️',
    tagline: 'Operational lead — manages staff + bulk actions',
    color: '#f59e0b',
    level: 4,
    powers: [
      'Everything moderators can do',
      'Warn or suspend users (up to 365 days)',
      'Bulk-moderate posts (up to 200 at a time)',
      'Soft-delete posts + restore deleted content',
      'Can assign / remove the Founding Scout honorary role',
      'Cannot ban or hard-delete — only super_admin',
    ],
  },
  super_admin: {
    key: 'super_admin',
    label: 'Super Admin',
    emoji: '👑',
    tagline: 'Owner-tier — unrestricted, destructive powers',
    color: '#ef4444',
    level: 5,
    powers: [
      'Everything admins can do',
      'Permanently ban user accounts',
      'Hard-delete posts (physical deletion — unrecoverable)',
      'Change user roles (promote / demote staff)',
      'Edit platform settings, pricing, seed content',
      'Only role that can grant or revoke admin/super_admin',
    ],
  },
};

/** Authoritative ordering for role-selector chips & hierarchy cards. */
export const ROLE_OPTIONS: RoleKey[] = [
  'user',
  'founding_scout',
  'moderator',
  'support',
  'admin',
  'super_admin',
];

export function getRoleDef(role: string | null | undefined): RoleDef {
  return ROLE_DEFS[(role as RoleKey) || 'user'] || ROLE_DEFS.user;
}

/**
 * Can `actorRole` assign / remove the target `targetRole`?
 * Mirrors the backend rules in routes/admin.py:admin_update_user:
 *   • admin and super_admin can target non-staff roles (user, founding_scout)
 *   • only super_admin can target admin / super_admin
 *   • moderator/support/user/founding_scout can target nobody
 */
export function canAssignRole(actorRole: string | null | undefined, targetRole: RoleKey): boolean {
  const actor = (actorRole || 'user') as RoleKey;
  if (targetRole === 'admin' || targetRole === 'super_admin') return actor === 'super_admin';
  // For user / founding_scout / moderator / support: admin and super_admin can assign.
  return actor === 'admin' || actor === 'super_admin';
}

/**
 * Does this role get Elite-gated features unlocked client-side?
 * Primary gating still comes from `user.plan === "elite" | "comp_elite"`
 * (the backend's plan_of() already returns comp_elite for founding_scout)
 * but this helper is used by defense-in-depth UI checks so the paywall
 * never briefly flashes for a Founding Scout even if the plan field
 * hasn't been refetched yet.
 */
export function hasEliteEntitlement(user: {
  plan?: string | null;
  role?: string | null;
  comped_tier?: string | null;
} | null | undefined): boolean {
  if (!user) return false;
  const plan = (user.plan || '').toLowerCase();
  if (plan === 'elite' || plan === 'comp_elite' || plan === 'trial_elite') return true;
  if (user.role === 'founding_scout') return true;
  if ((user.comped_tier || '').toLowerCase() === 'elite') return true;
  return false;
}
