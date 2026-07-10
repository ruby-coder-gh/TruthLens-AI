export const RELEVANCE_THRESHOLDS = {
  high: 0.7,
  medium: 0.4,
} as const;

export const TRUST_THRESHOLDS = {
  high: 0.75,
  medium: 0.5,
} as const;

export type RelevanceTier = 'high' | 'medium' | 'low';
export type TrustBadgeColor = 'green' | 'orange' | 'red' | 'gray';
export type TrustTier = 'high' | 'medium' | 'low' | 'unknown';

type RelevanceColorMap = {
  text: string;
  bar: string;
  glow: string;
  badge: string;
};

const RELEVANCE_LABELS: Record<RelevanceTier, string> = {
  high: 'Highly Relevant',
  medium: 'Partial Match',
  low: 'Weak Evidence',
};

const EVIDENCE_LABELS: Record<RelevanceTier, string> = {
  high: 'Strong Evidence',
  medium: 'Moderate Evidence',
  low: 'Weak Evidence',
};

const BADGE_COLORS: Record<RelevanceTier, 'green' | 'orange' | 'red'> = {
  high: 'green',
  medium: 'orange',
  low: 'red',
};

const RELEVANCE_COLORS: Record<RelevanceTier, RelevanceColorMap> = {
  high: {
    text: 'text-green',
    bar: 'bg-gradient-to-r from-green-400 to-emerald-500',
    glow: 'bg-green-400/40',
    badge: 'text-green border-green/30 bg-green/10',
  },
  medium: {
    text: 'text-orange',
    bar: 'bg-gradient-to-r from-orange-400 to-amber-500',
    glow: 'bg-orange-400/40',
    badge: 'text-orange border-orange/30 bg-orange/10',
  },
  low: {
    text: 'text-red',
    bar: 'bg-gradient-to-r from-red-400 to-rose-500',
    glow: 'bg-red-400/40',
    badge: 'text-red border-red/30 bg-red/10',
  },
};

export function clampRelevanceScore(score?: number | null): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(1, Math.max(0, score as number));
}

export function relevancePercent(score?: number | null): number {
  return Math.round(clampRelevanceScore(score) * 100);
}

export function getRelevanceTier(score?: number | null): RelevanceTier {
  const clamped = clampRelevanceScore(score);
  if (clamped >= RELEVANCE_THRESHOLDS.high) return 'high';
  if (clamped >= RELEVANCE_THRESHOLDS.medium) return 'medium';
  return 'low';
}

export function getRelevanceMeta(score?: number | null) {
  const clamped = clampRelevanceScore(score);
  const tier = getRelevanceTier(clamped);

  return {
    score: clamped,
    percent: relevancePercent(clamped),
    tier,
    label: RELEVANCE_LABELS[tier],
    evidenceLabel: EVIDENCE_LABELS[tier],
    badgeColor: BADGE_COLORS[tier],
    colors: RELEVANCE_COLORS[tier],
  };
}

export function getTrustBadgeColor(score?: number | null): TrustBadgeColor {
  const tier = getTrustTier(score);
  if (tier === 'unknown') return 'gray';
  if (tier === 'high') return 'green';
  if (tier === 'medium') return 'orange';
  return 'red';
}

export function getTrustTier(score?: number | null): TrustTier {
  if (!Number.isFinite(score)) return 'unknown';
  const clamped = clampRelevanceScore(score);
  if (clamped >= TRUST_THRESHOLDS.high) return 'high';
  if (clamped >= TRUST_THRESHOLDS.medium) return 'medium';
  return 'low';
}

export function getTrustColorVar(score?: number | null): string {
  const color = getTrustBadgeColor(score);
  if (color === 'green') return 'var(--color-green)';
  if (color === 'orange') return 'var(--color-orange)';
  if (color === 'red') return 'var(--color-red)';
  return 'var(--color-text-dim)';
}

export function getTrustStatusLabel(score?: number | null): 'Good' | 'Fair' | 'Poor' | 'Unknown' {
  const tier = getTrustTier(score);
  if (tier === 'high') return 'Good';
  if (tier === 'medium') return 'Fair';
  if (tier === 'unknown') return 'Unknown';
  return 'Poor';
}

export function getSafeLabel(label?: string | null, fallback = 'Unknown'): string {
  const normalized = typeof label === 'string' ? label.trim() : '';
  if (!normalized) return fallback;

  const lowered = normalized.toLowerCase();
  if (lowered === 'unknown' || lowered === 'null' || lowered === 'undefined') {
    return fallback;
  }

  return normalized;
}

export function getTrustConfidenceLabel(score?: number | null): 'High confidence' | 'Medium confidence' | 'Low confidence' {
  const tier = getTrustTier(score);
  if (tier === 'high') return 'High confidence';
  if (tier === 'medium') return 'Medium confidence';
  return 'Low confidence';
}
