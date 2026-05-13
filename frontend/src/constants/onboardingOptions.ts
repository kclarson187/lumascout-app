/**
 * Shared onboarding option lists — single source of truth for the
 * personalize and photographer screens. Kept thin and stable so
 * adding/renaming an option is a one-line change.
 */

export const SPECIALTIES: { key: string; label: string }[] = [
  { key: 'landscape',  label: 'Landscape'   },
  { key: 'portrait',   label: 'Portrait'    },
  { key: 'weddings',   label: 'Weddings'    },
  { key: 'street',     label: 'Street'      },
  { key: 'wildlife',   label: 'Wildlife'    },
  { key: 'travel',     label: 'Travel'      },
  { key: 'film',       label: 'Film'        },
  { key: 'drone',      label: 'Drone'       },
  { key: 'astro',      label: 'Astro'       },
  { key: 'family',     label: 'Family'      },
  { key: 'realestate', label: 'Real Estate' },
  { key: 'sports',     label: 'Sports'      },
];

export const GOALS: { key: string; label: string }[] = [
  { key: 'find_spots',         label: 'Find spots'         },
  { key: 'meet_photographers', label: 'Meet photographers' },
  { key: 'get_hired',          label: 'Get hired'          },
  { key: 'second_shoot',       label: 'Second shoot'       },
  { key: 'mentor',             label: 'Mentor'             },
  { key: 'share_locations',    label: 'Share locations'    },
];

export const EXPERIENCE_LEVELS: { key: string; label: string; helper?: string }[] = [
  { key: 'hobbyist', label: 'Hobbyist',     helper: 'I shoot for fun.' },
  { key: 'semi_pro', label: 'Semi-pro',     helper: 'Some paid work alongside another job.' },
  { key: 'pro',      label: 'Pro',          helper: 'Photography is my main income.' },
  { key: 'studio',   label: 'Studio/Brand', helper: 'I run a studio or photography brand.' },
];
