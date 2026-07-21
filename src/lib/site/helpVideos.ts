/**
 * Help / how-to videos surfaced on the public /help page.
 *
 * Content-managed by hand for now (add entries to HELP_VIDEOS below). The
 * admin-managed version — upload + caption tutorials from /admin/assistant —
 * is the planned fast-follow; when it ships, this static list becomes the
 * seed/fallback.
 *
 * `embedUrl` is an iframe src: a YouTube/Vimeo *embed* URL
 * (e.g. https://www.youtube.com/embed/XXXX or https://player.vimeo.com/video/XXXX)
 * or any URL that renders in an iframe. Use the embed form, not the watch URL.
 */

export interface HelpVideo {
  id: string
  title: string
  description: string
  embedUrl: string
  category?: string
  durationLabel?: string
}

export const HELP_VIDEOS: HelpVideo[] = [
  // Example shape (remove once real videos are added):
  // {
  //   id: 'gate-code',
  //   title: 'Finding & using the lot gate code',
  //   description: 'Where the gate keypad is and how to enter the after-hours code.',
  //   embedUrl: 'https://www.youtube.com/embed/XXXXXXXXXXX',
  //   category: 'After hours',
  //   durationLabel: '1:20',
  // },
]

export function hasHelpVideos(): boolean {
  return HELP_VIDEOS.length > 0
}
