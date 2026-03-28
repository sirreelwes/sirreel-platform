'use client';

import { useState, useEffect, useMemo } from 'react';

type Asset = {
  id: string;
  unitName: string;
  status: string;
  location: string;
  year: number | null;
  make: string | null;
  model: string | null;
  mileage: number | null;
  notes: string | null;
  categoryId: string;
  categoryName: string;
  currentBooking: { company: string; agent: string; endDate: string } | null;
  maintenanceNote: string | null;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  AVAILABLE:   { label: 'Available',   color: 'text-emerald-700', bg: 'bg-emerald-50',  dot: 'bg-emerald-500' },
  BOOKED:      { label: 'Booked',      color: 'text-blue-700',    bg: 'bg-blue-50',     dot: 'bg-blue-500' },
  CHECKED_OUT: { label: 'Out',         color: 'text-purple-700',  bg: 'bg-purple-50',   dot: 'bg-purple-500' },
  MAINTENANCE: { label: 'Maint',       color: 'text-red-700',     bg: 'bg-red-50',      dot: 'bg-red-500' },
  INACTIVE:    { label: 'Inactive',    color: 'text-gray-500',    bg: 'bg-gray-50',     dot: 'bg-gray-400' },
};

export default function FleetPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterCat, setFilterCat] = useState('All');
  const [search, setSearch] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch('/api/fleet')
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setAssets(d.assets);
          setCategories(d.categories);
          setStatusCounts(d.statusCounts);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return assets.filter(a => {
      const q = search.toLowerCase();
      return (
        (!q || a.unitName.toLowerCase().includes(q) || a.categoryName.toLowerCase().includes(q) || (a.currentBooking?.company || '').toLowerCase().includes(q)) &&
        (filterCat === 'All' || a.categoryId === filterCat) &&
        (filterStatus === 'All' || a.status === filterStatus)
      );
    });
  }, [assets, search, filterCat, filterStatus]);

  async function setStatus(assetId: string, status: string) {
    setUpdating(assetId);
    await fetch('/api/fleet', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetId, status })
    });
    await load();
    setUpdating(null);
  }

  const totalAssets = assets.length;

  return (
    <div>
      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Fleet</h1>
          <p className="text-[11px] text-gray-400">{totalAssets} units total</p>
        </div>
        <div className="flex gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search units..."
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-[11px] w-44 focus:outline-none focus:border-gray-400" />
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-[11px] w-44 focus:outline-none focus:border-gray-400">
            <option value="All">All Types</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {/* Status filter cards */}
      <div className="flex gap-1.5 mb-3 flex-wrap">
        <button onClick={() => setFilterStatus('All')}
          className={`flex-1 min-w-[70px] p-2.5 rounded-lg text-left border transition-all ${filterStatus === 'All' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'}`}>
          <div className="text-[8px] font-bold uppercase tracking-wider opacity-70">All</div>
          <div className="text-xl font-extrabold">{totalAssets}</div>
        </button>
        {Object.entries(STATUS_CONFIG).map(([k, s]) => {
          const count = statusCounts[k] || 0;
          if (count === 0) return null;
          const active = filterStatus === k;
          return (
            <button key={k} onClick={() => setFilterStatus(filterStatus === k ? 'All' : k)}
              className={`flex-1 min-w-[70px] p-2.5 rounded-lg text-left border transition-all ${active ? `${s.bg} border-current ${s.color}` : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'}`}>
              <div className={`text-[8px] font-bold uppercase tracking-wider ${active ? s.color : 'text-gray-400'}`}>{s.label}</div>
              <div className={`text-xl font-extrabold ${active ? s.color : 'text-gray-900'}`}>{count}</div>
            </button>
          );
        })}
      </div>

      {/* Units table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="grid grid-cols-[1.5fr_110px_100px_1.5fr_90px] gap-2 px-4 py-2.5 text-[9px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">
          <div>Unit</div>
          <div>Status</div>
          <div>Location</div>
          <div>Current / Notes</div>
          <div>Set Status</div>
        </div>

        <div className="max-h-[calc(100vh-320px)] overflow-y-auto divide-y divide-gray-50">
          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Loading fleet...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No units found</div>
          ) : filtered.map(a => {
            const s = STATUS_CONFIG[a.status] || STATUS_CONFIG.AVAILABLE;
            const isUpdating = updating === a.id;
            return (
              <div key={a.id} className={`grid grid-cols-[1.5fr_110px_100px_1.5fr_90px] gap-2 px-4 py-2.5 items-center hover:bg-gray-50 transition-colors ${isUpdating ? 'opacity-50' : ''}`}>
                <div>
                  <div className="text-[12px] font-semibold text-gray-800">{a.unitName}</div>
                  <div className="text-[9px] text-gray-400">{a.categoryName}{a.year ? ` · ${a.year} ${a.make}` : ''}</div>
                  {a.mileage && <div className="text-[9px] text-gray-300">{a.mileage.toLocaleString()} mi</div>}
                </div>

                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[9px] font-bold w-fit ${s.bg} ${s.color}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                  {s.label}
                </span>

                <span className="text-[10px] text-gray-500">{a.location?.toLowerCase().replace('_', ' ')}</span>

                <div className="text-[10px] text-gray-500 truncate">
                  {a.currentBooking ? (
                    <span className="text-blue-600 font-semibold">{a.currentBooking.company}</span>
                  ) : a.maintenanceNote ? (
                    <span className="text-red-500">{a.maintenanceNote}</span>
                  ) : a.notes ? (
                    <span className="text-gray-400">{a.notes}</span>
                  ) : '—'}
                </div>

                <div className="flex gap-1">
                  {[
                    { k: 'AVAILABLE',   l: '✓' },
                    { k: 'MAINTENANCE', l: '🔧' },
                    { k: 'INACTIVE',    l: '○' },
                  ].map(btn => {
                    const isOn = a.status === btn.k;
                    const cfg = STATUS_CONFIG[btn.k];
                    return (
                      <button key={btn.k} onClick={() => setStatus(a.id, btn.k)} disabled={isUpdating}
                        className={`w-6 h-6 rounded flex items-center justify-center text-[10px] transition-all ${isOn ? `${cfg.bg} ${cfg.color} ring-1 ring-current` : 'bg-white text-gray-300 hover:text-gray-500 border border-gray-100'}`}>
                        {btn.l}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-4 py-2 border-t border-gray-100 text-[10px] text-gray-400">
          {filtered.length} of {totalAssets} units
        </div>
      </div>
    </div>
  );
}
