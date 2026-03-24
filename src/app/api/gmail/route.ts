import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Gmail API base URL
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function fetchGmail(accessToken: string, endpoint: string) {
  const res = await fetch(`${GMAIL_API}${endpoint}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail API error: ${res.status} ${err}`);
  }
  return res.json();
}

function decodeBase64Url(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function extractBody(payload: any): string {
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
      if (part.parts) {
        for (const sub of part.parts) {
          if (sub.mimeType === 'text/plain' && sub.body?.data) {
            return decodeBase64Url(sub.body.data);
          }
        }
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = decodeBase64Url(part.body.data);
        return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }
  return '';
}

function getHeader(headers: any[], name: string): string {
  const h = headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

export async function GET(req: NextRequest) {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token?.accessToken) {
      return NextResponse.json({ error: 'Not authenticated. Please sign in with Google.' }, { status: 401 });
    }

    const accessToken = token.accessToken as string;
    const maxResults = req.nextUrl.searchParams.get('max') || '20';

    // Fetch recent messages (booking-related)
    const query = 'to:(box@sirreel.com OR rentals@sirreel.com OR jose@sirreel.com OR oliver@sirreel.com OR dani@sirreel.com OR info@sirreel.com) newer_than:30d';
    const listData = await fetchGmail(accessToken, `/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`);

    if (!listData.messages || listData.messages.length === 0) {
      return NextResponse.json({ emails: [], count: 0 });
    }

    // Fetch each message
    const emails = await Promise.all(
      listData.messages.slice(0, parseInt(maxResults)).map(async (msg: any) => {
        try {
          const full = await fetchGmail(accessToken, `/messages/${msg.id}?format=full`);
          const headers = full.payload?.headers || [];
          
          const from = getHeader(headers, 'From');
          const to = getHeader(headers, 'To');
          const cc = getHeader(headers, 'Cc');
          const subject = getHeader(headers, 'Subject');
          const date = getHeader(headers, 'Date');
          const body = extractBody(full.payload);

          // Parse "From" into name + email
          const fromMatch = from.match(/^(.+?)\s*<(.+?)>$/);
          const fromName = fromMatch ? fromMatch[1].replace(/"/g, '').trim() : from;
          const fromEmail = fromMatch ? fromMatch[2] : from;

          // Basic classification
          const bodyLower = body.toLowerCase();
          const subjectLower = subject.toLowerCase();
          const isBookingInquiry = bodyLower.includes('truck') || bodyLower.includes('van') || bodyLower.includes('cube') || bodyLower.includes('rental') || bodyLower.includes('quote') || bodyLower.includes('availability') || bodyLower.includes('production') || bodyLower.includes('shoot');
          const isCoi = subjectLower.includes('coi') || subjectLower.includes('insurance') || subjectLower.includes('certificate');
          const isBilling = subjectLower.includes('invoice') || subjectLower.includes('payment') || subjectLower.includes('billing');
          const isSpam = subjectLower.includes('unsubscribe') || bodyLower.includes('unsubscribe') || fromEmail.includes('noreply') || fromEmail.includes('no-reply') || fromEmail.includes('marketing');

          let category = 'unknown';
          if (isSpam) category = 'spam';
          else if (isBookingInquiry) category = 'booking_inquiry';
          else if (isCoi) category = 'document';
          else if (isBilling) category = 'billing';
          else category = 'general';

          return {
            id: msg.id,
            threadId: full.threadId,
            from: fromName,
            fromEmail,
            to,
            cc,
            subject,
            body: body.slice(0, 2000), // Limit body length
            date,
            category,
            snippet: full.snippet,
            labels: full.labelIds || [],
            hasAttachments: full.payload?.parts?.some((p: any) => p.filename && p.filename.length > 0) || false,
          };
        } catch (e) {
          return null;
        }
      })
    );

    const validEmails = emails.filter(Boolean);

    return NextResponse.json({
      emails: validEmails,
      count: validEmails.length,
      total: listData.resultSizeEstimate || 0,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
