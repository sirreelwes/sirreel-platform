// ═══ Email Infrastructure ═══
// Ready for Gmail API connection. Currently uses mock data.
// To connect: enable Gmail API in Google Cloud Console, 
// set up OAuth, and replace mock functions with real API calls.

export type EmailSignature = {
  name: string;
  title: string;
  phone: string;
  email: string;
  html: string; // rendered signature HTML
};

// Agent signatures — will be pulled from Gmail API when connected
export const AGENT_SIGNATURES: Record<string, EmailSignature> = {
  Jose: {
    name: 'Jose Pacheco',
    title: 'Sales Director',
    phone: '888-477-7335',
    email: 'jose@sirreel.com',
    html: `Jose Pacheco\nAccount Manager\nSirReel Studio Services\n888-477-7335 | jose@sirreel.com\nsirreel.com`,
  },
  Oliver: {
    name: 'Oliver Carlson',
    title: 'Account Manager', 
    phone: '888-477-7335',
    email: 'oliver@sirreel.com',
    html: `Oliver Carlson\nAccount Manager\nSirReel Studio Services\n888-477-7335 | oliver@sirreel.com\nsirreel.com`,
  },
  Dani: {
    name: 'Dani Novoa',
    title: 'COO',
    phone: '888-477-7335',
    email: 'dani@sirreel.com',
    html: `Dani Novoa\nCOO\nSirReel Studio Services\n888-477-7335 | dani@sirreel.com\nsirreel.com`,
  },
  Ana: {
    name: 'Ana DeAngelis',
    title: 'Billing & Accounting Coordinator',
    phone: '888-477-7335',
    email: 'ana@sirreel.com',
    html: `Ana DeAngelis\nBilling & Accounting Coordinator\nSirReel Studio Services\n888-477-7335 | ana@sirreel.com\nsirreel.com`,
  },
};

export type SentEmail = {
  id: string;
  from: string;      // agent name
  fromEmail: string;  
  to: string;         // recipient email
  toName: string;
  subject: string;
  body: string;
  type: 'confirmation' | 'quote' | 'followup' | 'custom';
  bookingId: string | null;
  sentAt: string;
  status: 'sent' | 'delivered' | 'opened' | 'replied';
};

// Gmail API status — will be real when connected
export type GmailStatus = {
  connected: boolean;
  accounts: { email: string; name: string; lastSync: string | null }[];
};

export const GMAIL_STATUS: GmailStatus = {
  connected: false,  // flip to true when Gmail API is wired up
  accounts: [
    { email: 'jose@sirreel.com', name: 'Jose Pacheco', lastSync: null },
    { email: 'oliver@sirreel.com', name: 'Oliver Carlson', lastSync: null },
    { email: 'dani@sirreel.com', name: 'Dani Novoa', lastSync: null },
    { email: 'rentals@sirreel.com', name: 'SirReel Rentals', lastSync: null },
    { email: 'info@sirreel.com', name: 'SirReel Info', lastSync: null },
  ],
};

// Mock sent emails log
export const SENT_EMAILS: SentEmail[] = [];

// ═══ Functions (mock — replace with real Gmail API calls) ═══

export async function sendEmail(params: {
  from: string;
  to: string;
  toName: string;
  subject: string;
  body: string;
  type: SentEmail['type'];
  bookingId?: string;
}): Promise<{ success: boolean; emailId: string }> {
  // TODO: Replace with Gmail API send
  // const gmail = google.gmail({ version: 'v1', auth: oauthClient });
  // const raw = createMimeMessage(params);
  // await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  
  const emailId = 'em_' + Date.now();
  const sig = Object.values(AGENT_SIGNATURES).find(s => s.name.includes(params.from));
  
  SENT_EMAILS.push({
    id: emailId,
    from: params.from,
    fromEmail: sig?.email || 'rentals@sirreel.com',
    to: params.to,
    toName: params.toName,
    subject: params.subject,
    body: params.body + '\n\n--\n' + (sig?.html || ''),
    type: params.type,
    bookingId: params.bookingId || null,
    sentAt: new Date().toISOString(),
    status: 'sent',
  });

  return { success: true, emailId };
}

export async function fetchInbox(account: string): Promise<void> {
  // TODO: Replace with Gmail API watch/poll
  // const gmail = google.gmail({ version: 'v1', auth: oauthClient });
  // const res = await gmail.users.messages.list({ userId: 'me', q: 'is:unread' });
  // Parse each message with Claude AI to extract booking details
  console.log(`[Gmail] Would fetch inbox for ${account}`);
}

export async function getSignature(account: string): Promise<string> {
  // TODO: Replace with Gmail API
  // const gmail = google.gmail({ version: 'v1', auth: oauthClient });
  // const settings = await gmail.users.settings.sendAs.get({ userId: 'me', sendAsEmail: account });
  // return settings.data.signature;
  const agent = Object.values(AGENT_SIGNATURES).find(s => s.email === account);
  return agent?.html || '';
}
