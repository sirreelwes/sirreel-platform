/**
 * Fleet-readiness reminder recipients (Sprint 2A).
 *
 * The cron sends to exactly these values — but only when the
 * FLEET_REMINDERS_ENABLED env var is exactly "true"; otherwise the cron
 * logs the would-be payloads instead of sending (see
 * api/cron/fleet-readiness).
 */

export const FLEET_READINESS_EMAILS: string[] = ['fleet@sirreel.com']

export const FLEET_READINESS_SLACK_CHANNEL: string | null = '#fleet'
