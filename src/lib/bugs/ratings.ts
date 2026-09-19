/**
 * What clients think of the platform, in one number and a shape.
 *
 * Wes 2026-09-19: "a quick star ranking system for how they like this
 * platform."
 *
 * One row per person per job, upserted, so this is what people think NOW
 * rather than an average dragged around by whoever tapped most often.
 *
 * `recentAverage` is deliberately separate from the all-time one: an
 * average over a year moves so slowly that shipping a fix never shows up
 * in it, which makes the number useless for deciding whether anything is
 * working. The 30-day figure is the one that answers "are we better than
 * we were".
 */

import { prisma } from '@/lib/prisma'

export interface RatingSummary {
  count: number
  average: number | null
  /** 1★…5★ counts, index 0 = one star. */
  distribution: number[]
  recentCount: number
  recentAverage: number | null
  /** Ratings of 3 or below — the ones worth reading a name against. */
  unhappy: { personName: string; stars: number; comment: string | null; createdAt: string }[]
}

export const EMPTY_RATINGS: RatingSummary = {
  count: 0, average: null, distribution: [0, 0, 0, 0, 0],
  recentCount: 0, recentAverage: null, unhappy: [],
}

function avg(ns: number[]): number | null {
  if (!ns.length) return null
  return Math.round((ns.reduce((a, b) => a + b, 0) / ns.length) * 10) / 10
}

/** Never throws — a board that 500s over a star count is worse than no stars. */
export async function ratingSummary(): Promise<RatingSummary> {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const rows = await prisma.platformRating.findMany({
      select: { stars: true, comment: true, personName: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 2000,
    })
    if (!rows.length) return EMPTY_RATINGS

    const distribution = [0, 0, 0, 0, 0]
    rows.forEach((r) => {
      if (r.stars >= 1 && r.stars <= 5) distribution[r.stars - 1] += 1
    })
    const recent = rows.filter((r) => r.updatedAt >= since)

    return {
      count: rows.length,
      average: avg(rows.map((r) => r.stars)),
      distribution,
      recentCount: recent.length,
      recentAverage: avg(recent.map((r) => r.stars)),
      // Names attached on purpose: "3.8 average" is not actionable, and
      // "Dana at Crazy Maple gave it two stars last Tuesday" is.
      unhappy: rows
        .filter((r) => r.stars <= 3)
        .slice(0, 8)
        .map((r) => ({
          personName: r.personName,
          stars: r.stars,
          comment: r.comment,
          createdAt: r.updatedAt.toISOString(),
        })),
    }
  } catch {
    return EMPTY_RATINGS
  }
}
