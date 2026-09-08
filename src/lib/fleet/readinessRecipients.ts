/**
 * Fleet-readiness reminder recipients (Sprint 2A).
 *
 * The EMAIL audience moved to the 'fleet-readiness' notification channel
 * on 2026-09-08 (Wes's quiet-down pass) — edit it at
 * /admin/notifications, not here. It was a hardcoded ['fleet@sirreel.com']
 * roster, which meant a group nobody could see the membership of and a
 * deploy to change it.
 *
 * The Slack channel stays here: Slack is not part of the email dial-back
 * and has no registry of its own.
 *
 * Either way the cron only SENDS when the FLEET_REMINDERS_ENABLED env var
 * is exactly "true"; otherwise it logs the would-be payloads (see
 * api/cron/fleet-readiness).
 */

export const FLEET_READINESS_SLACK_CHANNEL: string | null = '#fleet'
