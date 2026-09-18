import { jsonLdGraph, type JsonLdNode } from '@/lib/site/structuredData'

/**
 * Renders a schema.org `@graph` for one public page.
 *
 * Server component, no client JS — a <script type="application/ld+json">
 * is inert markup that only crawlers read.
 *
 * Renders NOTHING when every node is null, which is the normal case for a
 * listing page with no published rows. An empty graph is worse than no
 * graph: it is a page volunteering that it has no content.
 *
 * Home is the exception that does not use this — PublicSiteJsonLd owns the
 * LocalBusiness node and predates the graph shape.
 */
export function JsonLd({ nodes }: { nodes: (JsonLdNode | null | undefined)[] }) {
  const graph = jsonLdGraph(nodes)
  if (!graph) return null

  return (
    <script
      type="application/ld+json"
      // Values come from our own catalog rows, serialized by JSON.stringify.
      // `<` is escaped so a description containing "</script>" cannot break
      // out of the tag — the one injection path a JSON-LD block has.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph).replace(/</g, '\\u003c') }}
    />
  )
}
