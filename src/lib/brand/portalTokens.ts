/**
 * Portal brand tokens — colors + typography helpers used by client
 * components (JobDashboard, CreateSendModal, success views, etc.).
 *
 * Named TSX until 2026-08-29, when Wes retired that sub-brand. These
 * are a palette and a serif stack, not a name — the values did not
 * change, only what they are called.
 *
 * Email templates (portalInvite.ts, bookingWelcome.ts) inline the
 * same values directly into their HTML string output. Keeping the
 * raw hex codes synchronised here is enough — there's no runtime
 * import path from those HTML strings, so the email templates
 * remain the canonical place to change brand colors for outbound
 * mail. Update both when the palette evolves.
 */

export const PORTAL = {
  /** Hero background — same as DARK constant in the email templates. */
  dark: '#0a0a0a',
  /** Slightly lighter for hovered dark surfaces (close button bg, etc.). */
  darkHover: '#1a1a1a',
  /** Accent — small caps kickers, CTA buttons, gold accent rules. */
  gold: '#D4A547',
  /** Muted gold for interactive hover states. */
  goldHover: '#b88f30',
  /** Body text on light backgrounds (matches the portalInvite body
   *  paragraph color). */
  ink: '#1a1a1a',
  /** Soft hairline divider — same value the email cards use. */
  hairline: '#ececec',
} as const

/** Georgia / Times-style serif stack used for headlines and italic
 *  subtitles throughout the portal UI. */
export const PORTAL_SERIF = "Georgia, 'Times New Roman', serif"

/**
 * Inline style object for the hero kicker — the small uppercase line
 * below the wordmark in the dark hero. It used to read "PRESENTS /
 * TSX"; the surviving uses are contextual ("Rental Agreement", "Your
 * portal"). Kept here so any client component (modal headers, drawer
 * headers, success views) can render the same treatment.
 */
export const PORTAL_KICKER_STYLE: React.CSSProperties = {
  color: PORTAL.gold,
  fontSize: 10,
  letterSpacing: '2.5px',
  textTransform: 'uppercase',
  fontWeight: 600,
}
