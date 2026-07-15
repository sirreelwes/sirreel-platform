'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  buildCounterEmail,
  type CounterEmailDecision,
  type CounterEmailCompany,
  type CounterEmailJob,
  type CounterEmailContact,
} from '@/lib/contracts/buildCounterEmail';
import type { AiChange } from '@/lib/contracts/ContractDocument';

interface CounterProposalEmailProps {
  aiChanges: AiChange[];
  decisions: CounterEmailDecision[];
  company: CounterEmailCompany | null;
  job: CounterEmailJob | null;
  primaryContact: CounterEmailContact | null;
  senderName: string;
}

export function CounterProposalEmail({
  aiChanges,
  decisions,
  company,
  job,
  primaryContact,
  senderName,
}: CounterProposalEmailProps) {
  const defaults = useMemo(
    () => buildCounterEmail({ aiChanges, decisions, company, job, primaryContact, senderName }),
    [aiChanges, decisions, company, job, primaryContact, senderName],
  );

  const [subject, setSubject] = useState(defaults.subject);
  const [body, setBody] = useState(defaults.body);
  const [copied, setCopied] = useState(false);

  const edited = subject !== defaults.subject || body !== defaults.body;

  // Refresh local state from defaults when inputs change, but never blow away
  // user edits — only re-sync if the user hasn't deviated.
  useEffect(() => {
    if (!edited) {
      setSubject(defaults.subject);
      setBody(defaults.body);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults.subject, defaults.body]);

  const reset = () => {
    setSubject(defaults.subject);
    setBody(defaults.body);
  };

  const copyToClipboard = async () => {
    const payload = `Subject: ${subject}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail on insecure contexts or if permissions are denied —
      // fall back to a transient alert rather than swallowing the failure silently.
      alert('Could not copy to clipboard. Select the text manually.');
    }
  };

  // RFC 6068: mailto URLs take percent-encoding ONLY. URLSearchParams is
  // form-encoding — it turns spaces into "+", which mail clients render
  // literally ("Hi+there"). Build the href by hand with
  // encodeURIComponent, and normalize line breaks to \r\n (the RFC's
  // line separator) before encoding. Copy-email is unaffected — it uses
  // the raw subject/body, not this href.
  const mailto = useMemo(() => {
    const to = primaryContact?.email?.trim() || '';
    const crlfBody = body.replace(/\r\n|\r|\n/g, '\r\n');
    const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(crlfBody)}`;
    // Long mailto URLs get silently truncated (or dropped) by OS/mail
    // clients — commonly around the ~2000-char mark. Rather than let a
    // legal email lose its tail invisibly, disable the link and point at
    // Copy email.
    return { href, tooLong: href.length > 1800 };
  }, [primaryContact?.email, subject, body]);

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3 mt-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
          Email to send with counter-proposal
        </div>
        {edited && (
          <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
            Edited
          </span>
        )}
      </div>

      <div className="space-y-2">
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
            Subject
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full bg-white border border-gray-300 rounded-lg p-2 text-[12px] text-gray-900 focus:outline-none focus:border-amber-500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
            Body
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            className="w-full bg-white border border-gray-300 rounded-lg p-2 text-[12px] text-gray-900 leading-relaxed resize-y focus:outline-none focus:border-amber-500"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 flex-wrap">
        {edited && (
          <button
            type="button"
            onClick={reset}
            className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-[11px] font-bold rounded-lg"
          >
            Reset to default
          </button>
        )}
        {mailto.tooLong ? (
          <span
            title="This email is too long for a mailto link — mail clients truncate long URLs. Use Copy email instead."
            className="px-3 py-1.5 bg-gray-100 border border-gray-200 text-gray-400 text-[11px] font-bold rounded-lg cursor-not-allowed select-none"
          >
            Open in mail — too long, use Copy email
          </span>
        ) : (
          <a
            href={mailto.href}
            className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-[11px] font-bold rounded-lg"
          >
            Open in mail
          </a>
        )}
        <button
          type="button"
          onClick={copyToClipboard}
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold rounded-lg"
        >
          {copied ? 'Copied ✓' : 'Copy email'}
        </button>
      </div>
    </div>
  );
}
