'use client';

import { useState } from 'react';
import { CompanyPicker } from '@/components/orders/CompanyPicker';

interface NewInquiryModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function NewInquiryModal({ open, onClose, onCreated }: NewInquiryModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [estimatedValue, setEstimatedValue] = useState('');
  const [preferredStartDate, setPreferredStartDate] = useState('');
  const [preferredEndDate, setPreferredEndDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const reset = () => {
    setTitle('');
    setDescription('');
    setCompanyId(null);
    setCompanyName(null);
    setEstimatedValue('');
    setPreferredStartDate('');
    setPreferredEndDate('');
    setError('');
  };

  const submit = async () => {
    if (!title.trim() || !description.trim()) {
      setError('Title and description are required.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          companyId: companyId || null,
          estimatedValue: estimatedValue || null,
          preferredStartDate: preferredStartDate || null,
          preferredEndDate: preferredEndDate || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to create inquiry.');
        return;
      }
      reset();
      onCreated();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => !submitting && onClose()}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 max-w-lg w-full space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-white">New Inquiry</h2>
        <p className="text-[11px] text-zinc-500">
          Capture a new lead. Convert to a quote when you&apos;re ready to send pricing.
        </p>

        <div>
          <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Working name for the project"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-amber-500"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Free-text inquiry content. Paste in the relevant email or call notes."
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white resize-y focus:outline-none focus:border-amber-500"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">Company (optional)</label>
          <CompanyPicker
            value={companyId}
            selectedName={companyName}
            onChange={(id, name) => {
              setCompanyId(id);
              setCompanyName(name);
            }}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">Start (optional)</label>
            <input
              type="date"
              value={preferredStartDate}
              onChange={(e) => setPreferredStartDate(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">End (optional)</label>
            <input
              type="date"
              value={preferredEndDate}
              onChange={(e) => setPreferredEndDate(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">Estimated value (optional)</label>
          <input
            value={estimatedValue}
            onChange={(e) => setEstimatedValue(e.target.value)}
            placeholder="$"
            inputMode="decimal"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-amber-500"
          />
        </div>

        {error && <div className="text-[11px] text-red-400">{error}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={submitting}
            className="px-3 py-1.5 text-sm text-zinc-300 border border-zinc-700 rounded-lg hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg"
          >
            {submitting ? 'Saving…' : 'Create inquiry'}
          </button>
        </div>
      </div>
    </div>
  );
}
