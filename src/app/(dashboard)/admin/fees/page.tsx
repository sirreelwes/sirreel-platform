'use client';

/**
 * /admin/fees — fee catalog CRUD (requireAdmin on every API call).
 *
 * Fees are first-class order charges (delivery, LCDW, mileage, refuel…)
 * that live OUTSIDE the inventory typeahead. Each fee has a typed unit
 * that controls how the order builder prices it:
 *   FLAT       — amount × count
 *   PER_DAY    — amount × the order's rental days
 *   PER_HOUR   — amount × hours (rep enters hours)
 *   PER_MILE   — amount × miles (rep enters miles)
 *   PER_GALLON — amount × gallons (rep enters gallons)
 *   PERCENT    — amount% of a rep-entered base
 *
 * Delete is guarded server-side: a fee referenced by order lines
 * archives (isActive=false) instead of hard-deleting.
 */

import { useCallback, useEffect, useState } from 'react';

type FeeUnit = 'FLAT' | 'PER_DAY' | 'PER_HOUR' | 'PER_MILE' | 'PER_GALLON' | 'PERCENT';

const UNIT_LABELS: Record<FeeUnit, string> = {
  FLAT: 'Flat',
  PER_DAY: 'Per day',
  PER_HOUR: 'Per hour',
  PER_MILE: 'Per mile',
  PER_GALLON: 'Per gallon',
  PERCENT: 'Percent',
};

const UNIT_HINT: Record<FeeUnit, string> = {
  FLAT: '× count',
  PER_DAY: "× order's rental days",
  PER_HOUR: '× hours',
  PER_MILE: '× miles',
  PER_GALLON: '× gallons',
  PERCENT: '% of entered base',
};

interface FeeRow {
  id: string;
  name: string;
  code: string;
  amount: string;
  unit: FeeUnit;
  description: string | null;
  isActive: boolean;
  lineItemCount: number;
}

interface FormState {
  name: string;
  code: string;
  amount: string;
  unit: FeeUnit;
  description: string;
}

const EMPTY_FORM: FormState = { name: '', code: '', amount: '', unit: 'FLAT', description: '' };

export default function AdminFeesPage() {
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/fees');
      if (res.status === 401 || res.status === 403) {
        setError('Admin access required.');
        return;
      }
      const data = await res.json();
      setFees(data.fees ?? []);
      setError(null);
    } catch {
      setError('Failed to load fees.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startCreate = () => { setForm(EMPTY_FORM); setEditingId(null); setShowCreate(true); };
  const startEdit = (f: FeeRow) => {
    setForm({ name: f.name, code: f.code, amount: f.amount, unit: f.unit, description: f.description ?? '' });
    setEditingId(f.id);
    setShowCreate(false);
  };
  const cancelForm = () => { setShowCreate(false); setEditingId(null); setForm(EMPTY_FORM); };

  const submit = async () => {
    setPending(true);
    try {
      const body = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        amount: form.amount,
        unit: form.unit,
        description: form.description.trim() || null,
      };
      const res = editingId
        ? await fetch(`/api/admin/fees/${editingId}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
        : await fetch('/api/admin/fees', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || `HTTP ${res.status}`); return; }
      setError(null);
      cancelForm();
      await load();
    } finally {
      setPending(false);
    }
  };

  const toggleActive = async (f: FeeRow) => {
    setPending(true);
    try {
      const res = await fetch(`/api/admin/fees/${f.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !f.isActive }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || `HTTP ${res.status}`); return; }
      await load();
    } finally {
      setPending(false);
    }
  };

  const remove = async (f: FeeRow) => {
    const msg = f.lineItemCount > 0
      ? `"${f.name}" is used on ${f.lineItemCount} order line(s) — it will be ARCHIVED, not deleted. Continue?`
      : `Delete "${f.name}" permanently?`;
    if (!confirm(msg)) return;
    setPending(true);
    try {
      const res = await fetch(`/api/admin/fees/${f.id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || `HTTP ${res.status}`); return; }
      await load();
    } finally {
      setPending(false);
    }
  };

  const formValid =
    form.name.trim() && form.code.trim() &&
    Number.isFinite(Number(form.amount)) && Number(form.amount) > 0 &&
    (form.unit !== 'PERCENT' || Number(form.amount) <= 100);

  const feeForm = (
    <div className="px-4 py-3 bg-lt-inner/50 border border-lt-hairline rounded-lg space-y-3">
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-4">
          <label className="block text-xs text-lt-fg3 mb-1">Name</label>
          <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Delivery Fee"
            className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg placeholder:text-lt-fg3 focus:outline-none focus:border-lt-fg2" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-lt-fg3 mb-1">Code</label>
          <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
            placeholder="DEL"
            className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg placeholder:text-lt-fg3 uppercase focus:outline-none focus:border-lt-fg2" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-lt-fg3 mb-1">
            {form.unit === 'PERCENT' ? 'Percent (0–100)' : 'Amount ($)'}
          </label>
          <input type="number" step="0.01" min="0" value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg focus:outline-none focus:border-lt-fg2" />
        </div>
        <div className="col-span-4">
          <label className="block text-xs text-lt-fg3 mb-1">Unit</label>
          <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as FeeUnit })}
            className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg focus:outline-none focus:border-lt-fg2">
            {(Object.keys(UNIT_LABELS) as FeeUnit[]).map((u) => (
              <option key={u} value={u}>{UNIT_LABELS[u]} — {UNIT_HINT[u]}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs text-lt-fg3 mb-1">Description (optional — shows in the builder picker)</label>
        <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg focus:outline-none focus:border-lt-fg2" />
      </div>
      <div className="flex gap-2">
        <button onClick={submit} disabled={!formValid || pending}
          className="px-3 py-1.5 bg-lt-fg hover:bg-black text-white text-sm font-medium rounded-lg disabled:opacity-40 transition-colors">
          {editingId ? 'Save changes' : 'Create fee'}
        </button>
        <button onClick={cancelForm}
          className="px-3 py-1.5 border border-lt-hairline text-lt-fg2 text-sm rounded-lg hover:bg-lt-card transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-lt-fg">Fees</h1>
          <p className="text-sm text-lt-fg3">
            Order charges outside the inventory catalog — delivery, LCDW, mileage, refuel, percentages.
          </p>
        </div>
        <button onClick={showCreate ? cancelForm : startCreate}
          className="px-3 py-1.5 bg-lt-fg hover:bg-black text-white text-sm font-medium rounded-lg transition-colors">
          {showCreate ? 'Cancel' : '+ New Fee'}
        </button>
      </div>

      {error && (
        <div className="px-4 py-2 bg-chip-bad-bg text-chip-bad-fg text-sm rounded-lg">{error}</div>
      )}
      {showCreate && feeForm}

      <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
        {loading ? (
          <div className="px-6 py-8 text-sm text-lt-fg3">Loading…</div>
        ) : fees.length === 0 ? (
          <div className="px-6 py-8 text-sm text-lt-fg3">No fees yet — create one or run the seed script.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-lt-hairline text-lt-fg2 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2">Code</th>
                <th className="text-right px-4 py-2">Amount</th>
                <th className="text-left px-4 py-2">Unit</th>
                <th className="text-right px-4 py-2">Used</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {fees.map((f) => (
                <>
                  <tr key={f.id} className={`border-b border-lt-hairline/60 ${f.isActive ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-2 text-lt-fg">
                      {f.name}
                      {f.description && <div className="text-xs text-lt-fg3">{f.description}</div>}
                    </td>
                    <td className="px-4 py-2 text-lt-fg2 font-mono text-xs">{f.code}</td>
                    <td className="px-4 py-2 text-right text-lt-fg">
                      {f.unit === 'PERCENT' ? `${Number(f.amount).toFixed(2)}%` : `$${f.amount}`}
                    </td>
                    <td className="px-4 py-2 text-lt-fg2">
                      {UNIT_LABELS[f.unit]}
                      <span className="text-lt-fg3 text-xs ml-1">({UNIT_HINT[f.unit]})</span>
                    </td>
                    <td className="px-4 py-2 text-right text-lt-fg2">{f.lineItemCount}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${f.isActive ? 'bg-chip-good-bg text-chip-good-fg' : 'bg-chip-neutral-bg text-chip-neutral-fg'}`}>
                        {f.isActive ? 'active' : 'archived'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button onClick={() => startEdit(f)} disabled={pending}
                        className="text-xs text-lt-fg2 hover:text-lt-fg mr-3">Edit</button>
                      <button onClick={() => toggleActive(f)} disabled={pending}
                        className="text-xs text-lt-fg2 hover:text-lt-fg mr-3">
                        {f.isActive ? 'Archive' : 'Restore'}
                      </button>
                      <button onClick={() => remove(f)} disabled={pending}
                        className="text-xs text-chip-bad-fg hover:opacity-80">Delete</button>
                    </td>
                  </tr>
                  {editingId === f.id && (
                    <tr key={`${f.id}-edit`}>
                      <td colSpan={7} className="px-4 py-3">{feeForm}</td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
