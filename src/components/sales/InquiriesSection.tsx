'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { NewInquiryModal } from './NewInquiryModal';

interface InquiryRecord {
  id: string;
  createdAt: string;
  source: 'MANUAL' | 'GMAIL' | 'WEB_FORM';
  status: 'NEW' | 'CONVERTED' | 'DISMISSED';
  title: string;
  description: string;
  estimatedValue: number | null;
  company: { id: string; name: string } | null;
  person: { id: string; firstName: string; lastName: string; email: string } | null;
  assignedTo: { id: string; name: string } | null;
  convertedJob: { id: string; jobCode: string; name: string } | null;
}

const SOURCE_BADGE: Record<InquiryRecord['source'], string> = {
  MANUAL: 'bg-zinc-800 text-zinc-300',
  GMAIL: 'bg-blue-900/40 text-blue-300',
  WEB_FORM: 'bg-purple-900/40 text-purple-300',
};

const STATUS_BADGE: Record<InquiryRecord['status'], string> = {
  NEW: 'bg-amber-900/40 text-amber-300',
  CONVERTED: 'bg-emerald-900/40 text-emerald-300',
  DISMISSED: 'bg-zinc-800 text-zinc-500',
};

function ageString(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function fmtMoney(n: number | null) {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function InquiriesSection() {
  const router = useRouter();
  const [filter, setFilter] = useState<'OPEN' | 'ALL'>('OPEN');
  const [inquiries, setInquiries] = useState<InquiryRecord[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const url = filter === 'OPEN' ? '/api/inquiries' : '/api/inquiries?status=ALL';
    fetch(url)
      .then((r) => r.json())
      .then((d) => setInquiries(d.inquiries || []))
      .catch(() => setInquiries([]));
  }, [filter, refreshKey]);

  const dismiss = async (id: string) => {
    await fetch(`/api/inquiries/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'DISMISSED' }),
    });
    setRefreshKey((k) => k + 1);
  };

  const convert = (_id: string) => {
    // Phase 2 will wire prefill via ?inquiryId=...; for Phase 1 just navigate
    // to the existing new-quote flow.
    router.push('/orders/new-quote');
  };

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-white">Inquiries</h2>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            New leads — capture them here, convert to a quote when ready.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded-lg p-0.5">
            <button
              onClick={() => setFilter('OPEN')}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded ${filter === 'OPEN' ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-white'}`}
            >
              Open
            </button>
            <button
              onClick={() => setFilter('ALL')}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded ${filter === 'ALL' ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-white'}`}
            >
              All
            </button>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-[12px] font-bold rounded-lg"
          >
            + New Inquiry
          </button>
        </div>
      </div>

      {inquiries === null ? (
        <div className="text-xs text-zinc-600 text-center py-6">Loading…</div>
      ) : inquiries.length === 0 ? (
        <div className="text-xs text-zinc-600 text-center py-6">
          {filter === 'OPEN'
            ? 'No open inquiries — start one or wait for them to come in via Gmail in Phase 3.'
            : 'No inquiries on file.'}
        </div>
      ) : (
        <div className="divide-y divide-zinc-800">
          {inquiries.map((inq) => {
            const contact = inq.person ? `${inq.person.firstName} ${inq.person.lastName}` : null;
            return (
              <div key={inq.id} className="py-2.5 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{inq.title}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${SOURCE_BADGE[inq.source]}`}>
                      {inq.source.replace('_', ' ')}
                    </span>
                    {inq.status !== 'NEW' && (
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${STATUS_BADGE[inq.status]}`}>
                        {inq.status}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-zinc-500 flex-wrap">
                    {inq.company && (
                      <Link href={`/crm/${inq.company.id}`} className="hover:text-white">
                        {inq.company.name}
                      </Link>
                    )}
                    {contact && <span>· {contact}</span>}
                    {inq.assignedTo && <span>· {inq.assignedTo.name}</span>}
                    <span>· {fmtMoney(inq.estimatedValue)}</span>
                    <span>· {ageString(inq.createdAt)} ago</span>
                  </div>
                  {inq.convertedJob && (
                    <Link
                      href={`/jobs/${inq.convertedJob.id}`}
                      className="text-[11px] text-emerald-400 hover:text-emerald-300"
                    >
                      → [{inq.convertedJob.jobCode}] {inq.convertedJob.name}
                    </Link>
                  )}
                </div>
                {inq.status === 'NEW' && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => convert(inq.id)}
                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold rounded"
                    >
                      Convert to Quote
                    </button>
                    <button
                      onClick={() => dismiss(inq.id)}
                      className="px-2.5 py-1 text-zinc-500 hover:text-zinc-300 text-[11px] font-semibold"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <NewInquiryModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={() => setRefreshKey((k) => k + 1)}
      />
    </section>
  );
}
