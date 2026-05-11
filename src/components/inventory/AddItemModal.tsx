'use client';

import { useEffect, useState } from 'react';

interface CategoryOption {
  id: string;
  name: string;
}
interface LocationOption {
  id: string;
  name: string;
  code: string;
}

const DEPARTMENTS = [
  'VEHICLES',
  'COMMUNICATIONS',
  'STAGES',
  'GE',
  'PRO_SUPPLIES',
  'EXPENDABLES',
  'ART',
] as const;

type Department = (typeof DEPARTMENTS)[number];

const DEPARTMENT_LABEL: Record<Department, string> = {
  VEHICLES: 'Vehicles',
  COMMUNICATIONS: 'Communications',
  STAGES: 'Stages',
  GE: 'Grip & Electric',
  PRO_SUPPLIES: 'Pro Supplies',
  EXPENDABLES: 'Expendables',
  ART: 'Art Department',
};

interface AddItemModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  categories: CategoryOption[];
  locations: LocationOption[];
  // Pre-fill values from the inventory page's current filter state so
  // creating an item while filtered to a category lands the new row in
  // the same view by default.
  defaultCategoryId?: string;
  defaultLocationId?: string;
}

export function AddItemModal({
  open,
  onClose,
  onCreated,
  categories,
  locations,
  defaultCategoryId,
  defaultLocationId,
}: AddItemModalProps) {
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [department, setDepartment] = useState<Department | ''>('');
  const [categoryId, setCategoryId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [qtyOwned, setQtyOwned] = useState('1');
  const [dailyRate, setDailyRate] = useState('');
  const [weeklyRate, setWeeklyRate] = useState('');
  const [replacementCost, setReplacementCost] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Sync prefills whenever the modal opens — covers the case where the
  // user changes filters then re-opens.
  useEffect(() => {
    if (!open) return;
    setCategoryId(defaultCategoryId || '');
    setLocationId(defaultLocationId || (locations[0]?.id ?? ''));
  }, [open, defaultCategoryId, defaultLocationId, locations]);

  if (!open) return null;

  const reset = () => {
    setCode('');
    setDescription('');
    setDepartment('');
    setCategoryId(defaultCategoryId || '');
    setLocationId(defaultLocationId || (locations[0]?.id ?? ''));
    setQtyOwned('1');
    setDailyRate('');
    setWeeklyRate('');
    setReplacementCost('');
    setError('');
  };

  const submit = async () => {
    if (!code.trim()) {
      setError('Code is required.');
      return;
    }
    if (!department) {
      setError('Department is required.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/inventory/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          description: description.trim() || null,
          department,
          categoryId: categoryId || null,
          locationId: locationId || null,
          qtyOwned: qtyOwned || 0,
          dailyRate: dailyRate || 0,
          weeklyRate: weeklyRate || 0,
          replacementCost: replacementCost || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Failed to create item (HTTP ${res.status}).`);
        return;
      }
      reset();
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 max-w-xl w-full space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Add Inventory Item</h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Code is required and must be unique. Other rates can be set later from the inline editor.
            </p>
          </div>
          <button
            onClick={() => !submitting && onClose()}
            className="text-zinc-500 hover:text-zinc-300 text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
              Code <span className="text-amber-500">*</span>
            </label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. 25 LB. SANDBAG  or  103537"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-amber-500"
              autoFocus
            />
          </div>

          <div className="col-span-2">
            <label className="block text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
              Description
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Display name (defaults to code if blank)"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
              Department <span className="text-amber-500">*</span>
            </label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value as Department)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-amber-500"
            >
              <option value="">— pick one —</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>{DEPARTMENT_LABEL[d]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
              Category
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-amber-500"
            >
              <option value="">(no category)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
              Location
            </label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-amber-500"
            >
              <option value="">(none)</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
              Qty Owned
            </label>
            <input
              type="number"
              min="0"
              value={qtyOwned}
              onChange={(e) => setQtyOwned(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white font-mono focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
              Daily Rate
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={dailyRate}
              onChange={(e) => setDailyRate(e.target.value)}
              placeholder="0.00"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white font-mono focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
              Weekly Rate
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={weeklyRate}
              onChange={(e) => setWeeklyRate(e.target.value)}
              placeholder="0.00"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white font-mono focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="col-span-2">
            <label className="block text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
              Replacement Cost
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={replacementCost}
              onChange={(e) => setReplacementCost(e.target.value)}
              placeholder="Per unit, for COI / insurance"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white font-mono focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800/40 text-red-200 rounded-lg p-2 text-[12px]">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 text-white text-sm font-bold rounded-lg"
          >
            {submitting ? 'Saving…' : 'Add Item'}
          </button>
        </div>
      </div>
    </div>
  );
}
