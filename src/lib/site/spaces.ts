/**
 * Live read helpers for the public Spaces pages (Standing Sets today;
 * Stages / LED Wall reuse the same model). Single source of truth is the
 * Space table (same rows the /admin/spaces editor manages). Images go
 * through the existing public catalog-image proxy (kind=space /
 * space-photo), mirroring the vehicle pattern exactly.
 *
 * Client visibility: a space appears publicly ONLY when active=true AND
 * published=true AND it has at least one photo. Everything else —
 * including published-but-photo-less rows — is hidden and 404s.
 */
import { Prisma, type SpaceType } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Shared where-clause for "client-visible on the public site". Used by the
 * public pages, the availability form's set list, the image proxy, and the
 * home-tile / nav publish gate so the rule can never drift between surfaces.
 */
export const PUBLIC_SPACE_VISIBLE_WHERE: Prisma.SpaceWhereInput = {
  active: true,
  published: true,
  photos: { some: {} },
}

export interface PublicSpacePhoto {
  id: string
  /** Public image-proxy path for this gallery photo. */
  src: string
  isPrimary: boolean
}

export interface PublicSpace {
  id: string
  name: string
  type: SpaceType
  description: string | null
  /** Public image-proxy path for the primary/first photo, or null. */
  photoUrl: string | null
  /** Gallery photos, primary first then sortOrder asc. */
  photos: PublicSpacePhoto[]
}

const SELECT = {
  id: true,
  name: true,
  type: true,
  description: true,
  photos: {
    select: { id: true, isPrimary: true },
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.SpaceSelect

type Row = {
  id: string
  name: string
  type: SpaceType
  description: string | null
  photos: { id: string; isPrimary: boolean }[]
}

function shape(r: Row): PublicSpace {
  const photos: PublicSpacePhoto[] = r.photos.map((p) => ({
    id: p.id,
    src: `/api/public/catalog-image/space-photo/${p.id}`,
    isPrimary: p.isPrimary,
  }))
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    description: r.description,
    // The proxy's `space` kind already prefers the primary photo, so this
    // is the card/hero source.
    photoUrl: photos.length > 0 ? `/api/public/catalog-image/space/${r.id}` : null,
    photos,
  }
}

/** Published, photo-bearing spaces of a given type, ordered for display. */
export async function getPublicSpaces(type: SpaceType): Promise<PublicSpace[]> {
  const rows = (await prisma.space.findMany({
    where: { type, ...PUBLIC_SPACE_VISIBLE_WHERE },
    select: SELECT,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })) as Row[]
  return rows.map(shape)
}

/** One client-visible space by id (any type), or null when hidden/absent. */
export async function getPublicSpaceById(id: string): Promise<PublicSpace | null> {
  const row = (await prisma.space.findFirst({
    where: { id, ...PUBLIC_SPACE_VISIBLE_WHERE },
    select: SELECT,
  })) as Row | null
  return row ? shape(row) : null
}

/** Publish gate for the home tile + nav: are there any live spaces of a type? */
export async function hasPublishedSpaces(type: SpaceType): Promise<boolean> {
  const n = await prisma.space.count({ where: { type, ...PUBLIC_SPACE_VISIBLE_WHERE } })
  return n > 0
}
