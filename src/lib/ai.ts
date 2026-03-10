import Anthropic from '@anthropic-ai/sdk';
import { UserRole } from '@prisma/client';
import { getPermissions } from './permissions';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface FleetContext {
  categories: { name: string; totalUnits: number; dailyRate: number; available: number; booked: number; maintenance: number }[];
  activeBookings: { id: string; customer: string; bookingNumber: string; category: string; qty: number; startDate: string; endDate: string; status: string; agent: string }[];
  activeMaintenance: { unit: string; title: string; startDate: string; endDate: string; vendor?: string; cost?: number }[];
}

export async function chatWithFleetAssistant(
  message: string,
  context: FleetContext,
  role: UserRole,
  conversationHistory: { role: 'user' | 'assistant'; content: string }[] = []
) {
  const perms = getPermissions(role);
  const roleName = role.replace('_', ' ');

  // Build system prompt with live fleet data and role restrictions
  const catSummary = context.categories
    .map(c => `${c.name}: ${c.available}/${c.totalUnits} available, ${c.booked} booked, ${c.maintenance} in maint, $${c.dailyRate}/day`)
    .join('\n');

  const bkList = context.activeBookings
    .map(b => {
      const name = perms.seeClientNames ? b.customer : b.bookingNumber;
      const line = `${name} — ${b.qty}× ${b.category} — ${b.startDate} to ${b.endDate} — ${b.status}`;
      return perms.seeOtherAgents ? `${line} — Agent: ${b.agent}` : line;
    })
    .join('\n');

  const mtList = context.activeMaintenance
    .map(m => {
      let line = `${m.unit}: ${m.title} (${m.startDate}–${m.endDate || 'TBD'})`;
      if (m.vendor) line += ` @ ${m.vendor}`;
      if (perms.seeMaintCost && m.cost) line += ` $${m.cost}`;
      return line;
    })
    .join('\n');

  const restrictions = [];
  if (!perms.seeClientNames) restrictions.push('NEVER reveal client/company names, emails, or phone numbers. Use booking numbers only.');
  if (!perms.seePricing) restrictions.push('NEVER reveal pricing, rates, revenue, or financial data.');
  if (!perms.seeOtherAgents) restrictions.push('Do not mention which agent handles which booking.');

  const systemPrompt = `You are SirReel's AI fleet assistant. The current user has "${roleName}" role.
${restrictions.length > 0 ? '\nCRITICAL RESTRICTIONS:\n' + restrictions.join('\n') : ''}

Be concise (2-4 sentences for simple questions, more for analysis). Use specific numbers. Today is ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.

FLEET AVAILABILITY:
${catSummary}

ACTIVE BOOKINGS (${context.activeBookings.length}):
${bkList || 'None'}

MAINTENANCE (${context.activeMaintenance.length}):
${mtList || 'None'}`;

  const messages = [
    ...conversationHistory.slice(-10),
    { role: 'user' as const, content: message },
  ];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    system: systemPrompt,
    messages,
  });

  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => (block as { type: 'text'; text: string }).text)
    .join('');

  return text;
}

export async function generateDemandLetter(claimData: {
  claimNumber: string;
  vehicleDescription: string;
  incidentDate: string;
  incidentDescription: string;
  repairEstimate: number;
  daysOutOfService: number;
  dailyRate: number;
  lossOfRevenue: number;
  totalDemand: number;
  insuranceCompany: string;
  policyNumber?: string;
}) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    system: `You are a professional demand letter writer for SirReel, a production vehicle rental company in Los Angeles. Write formal, professional demand letters for insurance claims related to vehicle damage. Include specific dollar amounts, dates, and supporting evidence references. Be firm but professional. The letter should be structured with: header, facts of the case, damages breakdown (repair + loss of use), total demand, and a 30-day response deadline.`,
    messages: [
      {
        role: 'user',
        content: `Write a demand letter for claim ${claimData.claimNumber}:
Vehicle: ${claimData.vehicleDescription}
Incident: ${claimData.incidentDate} — ${claimData.incidentDescription}
Repair Estimate: $${claimData.repairEstimate.toLocaleString()}
Loss of Use: ${claimData.daysOutOfService} days × $${claimData.dailyRate}/day = $${claimData.lossOfRevenue.toLocaleString()}
Total Demand: $${claimData.totalDemand.toLocaleString()}
Insurance: ${claimData.insuranceCompany}${claimData.policyNumber ? ` (Policy: ${claimData.policyNumber})` : ''}`,
      },
    ],
  });

  return response.content
    .filter(block => block.type === 'text')
    .map(block => (block as { type: 'text'; text: string }).text)
    .join('');
}
