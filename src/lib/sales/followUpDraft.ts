import type { FollowUpStage } from '@prisma/client';

interface DraftContext {
  agentName: string;
  jobName: string;
  jobCode: string;
  companyName: string;
}

export const FOLLOW_UP_OFFSETS_HOURS: Record<FollowUpStage, number> = {
  DAY_0: 8,   // EOD same day (assumes a morning send)
  DAY_1: 24,  // next day
  DAY_3: 72,  // 3 days out
};

export function computeDueAt(sentAt: Date, stage: FollowUpStage): Date {
  return new Date(sentAt.getTime() + FOLLOW_UP_OFFSETS_HOURS[stage] * 3_600_000);
}

export function composeDraft(stage: FollowUpStage, ctx: DraftContext): { subject: string; body: string } {
  const subject = `Following up — ${ctx.jobName} (${ctx.jobCode})`;

  const intro: Record<FollowUpStage, string> = {
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
