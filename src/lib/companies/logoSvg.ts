/**
 * Serve a company's inline vector mark (Company.logoSvg) as an image.
 * Shared by the staff and portal logo routes.
 */

export function svgResponse(svg: string): Response {
  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'private, max-age=3600',
      // An SVG can carry script; as an <img> source it never runs, and this
      // header keeps a direct open from running it either.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  })
}
