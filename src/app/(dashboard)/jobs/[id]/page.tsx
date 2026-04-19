'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

const JOB_STATUSES = ['QUOTED', 'ACTIVE', 'WRAPPED', 'HOLD', 'CANCELLED'] as const;
type JobStatus = (typeof JOB_STATUSES)[number];

const STATUS_BADGE: Record<JobStatus, string> = {
  QUOTED:    'bg-purple-900/40 text-purple-300 border-purple-800',
  ACTIVE:    'bg-emerald-900/40 text-emerald-300 border-emerald-800',
  WRAPPED:   'bg-zinc-800 text-zinc-400 border-zinc-700',
  HOLD:      'bg-amber-900/40 text-amber-300 border-amber-800',
  CANCELLED: 'bg-red-900/40 text-red-300 border-red-800',
};

const ORDER_STATUS_BADGE: Record<string, string> = {
  DRAFT:      'bg-zinc-800 text-zinc-400',
  QUOTE_SENT: 'bg-blue-900/40 text-blue-300',
  CONFIRMED:  'bg-amber-900/40 text-amber-300',
  ACTIVE:     'bg-emerald-900/40 text-emerald-300',
  RETURNED:   'bg-purple-900/40 text-purple-300',
  CLOSED:     'bg-zinc-800 text-zinc-500',
  CANCELLED:  'bg-red-900/40 text-red-300',
};

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMoney(n: number | null | undefined) {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

interface JobContact {
  id: string;
  role: string;
  isPrimary: boolean;
  person: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  };
}

interface JobOrder {
  id: string;
  orderNumber: string;
  status: string;
  subtotal: number;
  total: number;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
}

interface JobDetail {
  id: string;
  jobCode: string;
  name: string;
  status: JobStatus;
  productionType: string;
  startDate: string | null;
  endDate: string | null;
  estimatedValue: number | null;
  orderTotal: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  company: { id: string; name: string };
  agent: { id: string; name: string; email: string };
  jobContacts: JobContact[];
  orders: JobOrder[];
}

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusSaving, setStatusSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch(`/api/jobs/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.job) {
          setJob(d.job);
          setNotes(d.job.notes || '');
          setNotesDirty(false);
        } else {
          setError(d.error || 'Job not found');
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const updateStatus = async (status: JobStatus) => {
    if (!job) return;
    setStatusSaving(true);
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update status');
    } finally {
      setStatusSaving(false);
    }
  };

  const saveNotes = async () => {
    setNotesSaving(true);
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) throw new Error('Failed to save notes');
      setNotesDirty(false);
      if (job) setJob({ ...job, notes });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to save notes');
    } finally {
      setNotesSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-zinc-500 text-sm">Loading…</div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <div className="text-zinc-400 text-sm">{error || 'Job not found'}</div>
        <button
          onClick={() => router.back()}
          className="text-xs text-amber-500 hover:text-amber-400"
        >
          ← Back
        </button>
      </div>
    );
  }

  const dealValue = job.orderTotal > 0 ? job.orderTotal : job.estimatedValue;
  const dealValueLabel =
    job.orderTotal > 0 ? 'Order Total' : job.estimatedValue != null ? 'Estimated' : '—';

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <button
        onClick={() => router.back()}
        className="text-xs text-zinc-500 hover:text-zinc-300"
      >
        ← Back
      </button>

      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-mono text-zinc-500">{job.jobCode}</span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${STATUS_BADGE[job.status]}`}
              >
                {job.status}
              </span>
            </div>
            <h1 className="text-2xl font-semibold text-white mt-1 truncate">{job.name}</h1>
            <Link
              href={`/crm/${job.company.id}`}
              className="text-sm text-zinc-400 hover:text-amber-500"
            >
              {job.company.name}
            </Link>
          </div>

          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <label className="text-[10px] font-semibold uppercase text-zinc-500">Status</label>
            <select
              value={job.status}
              disabled={statusSaving}
              onChange={(e) => updateStatus(e.target.value as JobStatus)}
              className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-500 disabled:opacity-50"
            >
              {JOB_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Metadata */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          <Meta label="Production Type" value={job.productionType.replace('_', ' ')} />
          <Meta label="Start" value={fmtDate(job.startDate)} />
          <Meta label="End" value={fmtDate(job.endDate)} />
          <Meta label="Agent" value={job.agent?.name || '—'} />
          <Meta label="Deal Value" value={fmtMoney(dealValue)} sub={dealValueLabel} />
          <Meta label="Orders" value={String(job.orders.length)} />
          <Meta label="Created" value={fmtDate(job.createdAt)} />
          <Meta label="Updated" value={fmtDate(job.updatedAt)} />
        </div>
      </div>

      {/* Contacts */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-3">Contacts</h2>
        {job.jobContacts.length === 0 ? (
          <div className="text-sm text-zinc-500">No contacts yet.</div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {job.jobContacts.map((jc) => (
              <div key={jc.id} className="flex items-center justify-between py-2.5 gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-white truncate">
                    {jc.person.firstName} {jc.person.lastName}
                    {jc.isPrimary && (
                      <span className="ml-2 text-[10px] font-bold text-amber-500 uppercase">
                        Primary
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 truncate">{jc.person.email}</div>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 bg-zinc-800 px-2 py-1 rounded">
                  {jc.role}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Orders */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Orders</h2>
          <span className="text-xs text-zinc-500">{job.orders.length} total</span>
        </div>
        {job.orders.length === 0 ? (
          <div className="text-sm text-zinc-500">No orders on this job yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
                  <th className="pb-2 pr-3">Order</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">Dates</th>
                  <th className="pb-2 pr-3 text-right">Total</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {job.orders.map((o) => (
                  <tr key={o.id} className="text-zinc-300">
                    <td className="py-2.5 pr-3 font-mono text-xs">{o.orderNumber}</td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${ORDER_STATUS_BADGE[o.status] || 'bg-zinc-800 text-zinc-400'}`}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-zinc-400">
                      {fmtDate(o.startDate)} – {fmtDate(o.endDate)}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono">{fmtMoney(o.total)}</td>
                    <td className="py-2.5 text-right">
                      <Link
                        href={`/orders/${o.id}`}
                        className="text-xs text-amber-500 hover:text-amber-400"
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Notes</h2>
          <button
            onClick={saveNotes}
            disabled={!notesDirty || notesSaving}
            className="px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {notesSaving ? 'Saving…' : notesDirty ? 'Save' : 'Saved'}
          </button>
        </div>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setNotesDirty(e.target.value !== (job.notes || ''));
          }}
          rows={6}
          placeholder="Add context, client preferences, deal notes…"
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-500 resize-y"
        />
      </div>
    </div>
  );
}

function Meta({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="text-sm text-white mt-0.5 truncate">{value}</div>
      {sub && <div className="text-[10px] text-zinc-500">{sub}</div>}
    </div>
  );
}
