'use client';

import { useState, useMemo } from 'react';

// ═══ Types ═══
type UnitStatus = 'available' | 'booked' | 'maintenance' | 'warehouse';

type Unit = {
  id: string;
  name: string;
  cat: string;
  catLabel: string;
  status: UnitStatus;
  location: string;
  note: string;
};

const STATUS_CONFIG: Record<UnitStatus, { label: string; color: string; bg: string }> = {
  available: { label: 'Available', color: 'text-status-available', bg: 'bg-emerald-500/10' },
  booked: { label: 'Booked', color: 'text-status-booked', bg: 'bg-blue-500/10' },
  maintenance: { label: 'Maint', color: 'text-status-maintenance', bg: 'bg-red-500/10' },
  warehouse: { label: 'W/House', color: 'text-status-warehouse', bg: 'bg-purple-500/10' },
};

const CATS = [
  { key: 'cube', label: 'Cube Truck', short: 'Cube', units: 15 },
  { key: 'cargo', label: 'Cargo Van w/ LG', short: 'Cargo', units: 12 },
  { key: 'pass', label: 'Passenger Van', short: 'Pass', units: 7 },
  { key: 'pop', label: 'PopVan', short: 'Pop', units: 9 },
  { key: 'cam', label: 'Camera Cube', short: 'Cam', units: 7 },
  { key: 'dlux', label: 'DLUX', short: 'DLUX', units: 4 },
  { key: 'scout', label: 'ProScout/VTR', short: 'Scout', units: 3 },
  { key: 'studio', label: 'Studios', short: 'Studio', units: 6 },
];

function generateUnits(): Unit[] {
  const units: Unit[] = [];
  const maintUnits: Record<string, string> = {
    'Cube #8': 'Transmission @ High Tech',
    'Cube #9': 'Battery issue',
    'Cube #15': 'Oil / Reverse',
    'Cargo #2': 'Engine inspect',
    'Pop #1': 'Interior lights',
    'Pop #3': 'Transmission',
    'Pass #1': 'Motor mounts @ Dealer',
  };

  CATS.forEach((cat) => {
    for (let i = 1; i <= cat.units; i++) {
      const name = `${cat.short} #${i}`;
      const maintNote = maintUnits[name];
      let status: UnitStatus = 'available';
      let note = '';

      if (maintNote) {
        status = 'maintenance';
        note = maintNote;
      } else if (i <= Math.ceil(cat.units * 0.3)) {
        status = 'booked';
        note = 'On rental';
      }

      units.push({
        id: `${cat.key}-${i}`,
        name,
        cat: cat.key,
        catLabel: cat.label,
        status,
        location: cat.key === 'studio' ? 'Lankershim' : ['Chestnut', 'Lima', 'Lankershim'][i % 3],
        note,
      });
    }
  });
  return units;
}

// ═══ Page ═══
export default function FleetPage() {
  const [units, setUnits] = useState<Unit[]>(generateUnits);
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterCat, setFilterCat] = useState<string>('All');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return units.filter((u) => {
      const q = search.toLowerCase();
      return (
        (!q || u.name.toLowerCase().includes(q) || u.note.toLowerCase().includes(q)) &&
        (filterCat === 'All' || u.cat === filterCat) &&
        (filterStatus === 'All' || u.status === filterStatus)
      );
    });
  }, [units, search, filterCat, filterStatus]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { available: 0, booked: 0, maintenance: 0, warehouse: 0 };
    units.forEach((u) => { if (c[u.status] !== undefined) c[u.status]++; });
    return c;
  }, [units]);

  function changeStatus(unitId: string, newStatus: UnitStatus) {
    setUnits((prev) =>
      prev.map((u) => (u.id === unitId ? { ...u, status: newStatus } : u))
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
        <h1 className="text-lg font-bold text-white">Fleet Status</h1>
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search units..."
            className="input w-44 text-[11px] py-1.5"
          />
          <select
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value)}
            className="input w-36 text-[11px] py-1.5 appearance-none cursor-pointer"
          >
            <option value="All">All Types</option>
            {CATS.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Status cards */}
      <div className="flex gap-1.5 mb-3 flex-wrap">
        {(Object.keys(STATUS_CONFIG) as UnitStatus[]).map((k) => {
          const s = STATUS_CONFIG[k];
          const active = filterStatus === k;
          return (
            <button
              key={k}
              onClick={() => setFilterStatus(filterStatus === k ? 'All' : k)}
              className={`flex-1 min-w-[80px] p-2.5 rounded-lg text-left transition-all border ${
                active
                  ? `${s.bg} border-current ${s.color}`
                  : 'bg-[#0d0d0d] border-sirreel-border text-sirreel-text-muted hover:border-sirreel-border-hover'
              }`}
            >
              <div className={`text-[8px] font-bold uppercase tracking-wider ${active ? s.color : 'text-sirreel-text-dim'}`}>
                {s.label}
              </div>
              <div className={`text-xl font-extrabold ${active ? s.color : 'text-white'}`}>
                {statusCounts[k] || 0}
              </div>
            </button>
          );
        })}
      </div>

      {/* Units table */}
      <div className="bg-[#0d0d0d] rounded-lg border border-sirreel-border overflow-hidden">
        <div className="grid grid-cols-[1fr_100px_90px_1fr_80px] gap-2 px-3 py-2 text-[9px] font-bold text-sirreel-text-dim uppercase tracking-wider border-b border-sirreel-border">
          <div>Unit</div>
          <div>Status</div>
          <div>Location</div>
          <div>Notes</div>
          <div>Quick Set</div>
        </div>

        <div className="max-h-[calc(100vh-300px)] overflow-y-auto">
          {filtered.map((u, i) => {
            const s = STATUS_CONFIG[u.status];
            return (
              <div
                key={u.id}
                className={`grid grid-cols-[1fr_100px_90px_1fr_80px] gap-2 px-3 py-2 items-center border-b border-sirreel-border/50 transition-colors hover:bg-white/[0.02] ${
                  i % 2 ? 'bg-white/[0.01]' : ''
                }`}
              >
                <div>
                  <div className="text-[12px] font-semibold text-sirreel-text">{u.name}</div>
                  <div className="text-[9px] text-sirreel-text-dim">{u.catLabel}</div>
                </div>

                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-bold w-fit ${s.bg} ${s.color}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${s.color === 'text-status-available' ? 'bg-status-available' : s.color === 'text-status-booked' ? 'bg-status-booked' : s.color === 'text-status-maintenance' ? 'bg-status-maintenance' : 'bg-status-warehouse'}`} />
                  {s.label}
                </span>

                <span className="text-[10px] text-sirreel-text-muted">{u.location}</span>
                <span className="text-[10px] text-sirreel-text-dim">{u.note}</span>

                <div className="flex gap-1">
                  {([
                    { k: 'available' as UnitStatus, l: '✓' },
                    { k: 'maintenance' as UnitStatus, l: '🔧' },
                    { k: 'warehouse' as UnitStatus, l: '🏭' },
                  ]).map((btn) => {
                    const isOn = u.status === btn.k;
                    return (
                      <button
                        key={btn.k}
                        onClick={() => changeStatus(u.id, btn.k)}
                        className={`w-6 h-6 rounded flex items-center justify-center text-[10px] transition-all ${
                          isOn
                            ? `${STATUS_CONFIG[btn.k].bg} ${STATUS_CONFIG[btn.k].color} ring-1 ring-current`
                            : 'bg-sirreel-surface text-sirreel-text-dim hover:text-sirreel-text-muted'
                        }`}
                      >
                        {btn.l}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-3 py-2 border-t border-sirreel-border text-[10px] text-sirreel-text-dim">
          {filtered.length} units shown
        </div>
      </div>
    </div>
  );
}
