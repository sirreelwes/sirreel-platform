/**
 * Fleet-readiness reminder recipients (Sprint 2A).
 *
 * TODO(wes): replace the placeholder email with the real fleet
 * distribution (Julian / Chris / dispatch inbox) and set the Slack
 * channel if the digest should land somewhere other than the default
 * SLACK_ALERT_CHANNEL. The cron sends to exactly these values.
 */

export const FLEET_READINESS_EMAILS: string[] = [
  'fleet-readiness-placeholder@sirreel.com', // TODO(wes): real recipients
]

/** null → lib/slack.ts falls back to SLACK_ALERT_CHANNEL. */
export const FLEET_READINESS_SLACK_CHANNEL: string | null = null
