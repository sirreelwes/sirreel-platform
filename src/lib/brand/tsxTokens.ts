/**
 * TSX brand tokens — colors + typography helpers used by client
 * components (JobDashboard, CreateSendModal, success views, etc.).
 *
 * Email templates (portalInvite.ts, bookingWelcome.ts) inline the
 * same values directly into their HTML string output. Keeping the
 * raw hex codes synchronised here is enough — there's no runtime
 * import path from those HTML strings, so the email templates
 * remain the canonical place to change brand colors for outbound
 * mail. Update both when the palette evolves.
 */

export const TSX = {
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
 *  subtitles throughout the TSX UI. */
export const TSX_SERIF = "Georgia, 'Times New Roman', serif"

/**
 * Inline style object for the "PRESENTS / TSX" lockup kicker — the
 * small uppercase line that appears below the wordmark in the dark
 * hero. Kept here so any client component (modal headers, drawer
 * headers, success views) can render the same treatment.
 */
export const TSX_KICKER_STYLE: React.CSSProperties = {
  color: TSX.gold,
  fontSize: 10,
  letterSpacing: '2.5px',
  textTransform: 'uppercase',
  fontWeight: 600,
}
