// Legacy cron-driven follow-up draft generator (DAY_0/DAY_1/DAY_3 only).
// The Mode A agent-driven cadence lives in src/lib/sales/quoteCadence.ts
// and uses the STAGE_1/STAGE_2/STAGE_3 enum values directly.
type LegacyStage = 'DAY_0' | 'DAY_1' | 'DAY_3';

interface DraftContext {
  agentName: string;
  jobName: string;
  jobCode: string;
  companyName: string;
}

export const FOLLOW_UP_OFFSETS_HOURS: Record<LegacyStage, number> = {
  DAY_0: 8,   // EOD same day (assumes a morning send)
  DAY_1: 24,  // next day
  DAY_3: 72,  // 3 days out
};

export function computeDueAt(sentAt: Date, stage: LegacyStage): Date {
  return new Date(sentAt.getTime() + FOLLOW_UP_OFFSETS_HOURS[stage] * 3_600_000);
}

export function composeDraft(stage: LegacyStage, ctx: DraftContext): { subject: string; body: string } {
  const subject = `Following up — ${ctx.jobName} (${ctx.jobCode})`;

  const intro: Record<LegacyStage, string> = {
    DAY_0: `Just wanted to make sure the quote we sent today landed safely on your end.`,
    DAY_1: `Wanted to circle back on the quote we sent yesterday.`,
    DAY_3: `Following up on the quote we sent earlier this week.`,
  };

  const body = [
    `Hi,`,
    ``,
    intro[stage],
    ``,
    `Let me know if I can provide any more information or modify the quote to get this done — happy to adjust line items, dates, or pricing if it helps.`,
    ``,
    `Thanks,`,
    ctx.agentName,
    `SirReel Production Vehicles`,
  ].join('\n');

  return { subject, body };
}
