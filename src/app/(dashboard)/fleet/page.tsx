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
  vin: string | null;
  licensePlate: string | null;
  latestBitDate: string | null;
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
  const [dotAsset, setDotAsset] = useState<Asset | null>(null);

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
                  <button onClick={() => setDotAsset(a)} className="text-[12px] font-semibold text-gray-800 hover:text-blue-600 hover:underline text-left">
                    {a.unitName}
                  </button>
                  <div className="text-[9px] text-gray-400">{a.categoryName}{a.year ? ` · ${a.year} ${a.make}` : ''}</div>
                  <div className="text-[9px] text-gray-300 flex gap-1.5">
                    {a.mileage ? <span>{a.mileage.toLocaleString()} mi</span> : null}
                    {a.licensePlate ? <span className="font-mono">{a.licensePlate}</span> : null}
                    {a.latestBitDate ? <span className="text-emerald-500">BIT {a.latestBitDate.slice(0, 10)}</span> : null}
                  </div>
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

      {dotAsset && (
        <UnitDotModal asset={dotAsset} onClose={() => setDotAsset(null)} onSaved={load} />
      )}
    </div>
  );
}

// VIN sanity: 17 chars, no I/O/Q. Advisory only — never blocks a save.
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;

function UnitDotModal({ asset, onClose, onSaved }: { asset: Asset; onClose: () => void; onSaved: () => void }) {
  const [year, setYear] = useState(asset.year != null ? String(asset.year) : '');
  const [make, setMake] = useState(asset.make ?? '');
  const [model, setModel] = useState(asset.model ?? '');
  const [vin, setVin] = useState(asset.vin ?? '');
  const [plate, setPlate] = useState(asset.licensePlate ?? '');
  const [savingFields, setSavingFields] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  type Bit = { id: string; inspectionDate: string; notes: string | null; createdAt: string };
  const [bits, setBits] = useState<Bit[]>([]);
  const [bitDate, setBitDate] = useState('');
  const [bitNotes, setBitNotes] = useState('');
  const [bitFile, setBitFile] = useState<File | null>(null);
  const [uploadingBit, setUploadingBit] = useState(false);
  const [bitError, setBitError] = useState<string | null>(null);

  const loadBits = async () => {
    const r = await fetch(`/api/fleet/${asset.id}/bit`);
    if (r.ok) { const d = await r.json(); setBits(d.inspections || []); }
  };
  useEffect(() => { loadBits(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const vinWarn = vin.trim().length > 0 && !VIN_RE.test(vin.trim());

  const saveFields = async () => {
    setSavingFields(true); setSavedMsg(false);
    const res = await fetch('/api/fleet', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetId: asset.id, year: year === '' ? null : year, make, model, vin, licensePlate: plate }),
    });
    setSavingFields(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Save failed'); return; }
    setSavedMsg(true);
    onSaved();
  };

  const uploadBit = async () => {
    if (!bitFile || !/^\d{4}-\d{2}-\d{2}$/.test(bitDate)) { setBitError('Pick an inspection date and a PDF.'); return; }
    setUploadingBit(true); setBitError(null);
    const fd = new FormData();
    fd.append('file', bitFile);
    fd.append('inspectionDate', bitDate);
    if (bitNotes.trim()) fd.append('notes', bitNotes.trim());
    const res = await fetch(`/api/fleet/${asset.id}/bit`, { method: 'POST', body: fd });
    setUploadingBit(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setBitError(d.error || 'Upload failed'); return; }
    setBitDate(''); setBitNotes(''); setBitFile(null);
    await loadBits();
    onSaved();
  };

  const fieldCls = 'w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-[12px] text-gray-800 focus:outline-none focus:border-gray-400';
  const labelCls = 'block text-[10px] font-semibold text-gray-500 mb-1';
  const latest = bits[0]; // already sorted desc by inspectionDate

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between px-5 py-3.5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">{asset.unitName} · DOT</h2>
            <p className="text-[11px] text-gray-400">{asset.categoryName} — vehicle details &amp; BIT inspections</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </header>

        <div className="px-5 py-4 space-y-5">
          {/* Vehicle details */}
          <section>
            <div className="text-[10px] uppercase tracking-wide text-gray-400 font-bold mb-2">Vehicle details</div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Year</label><input className={fieldCls} type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2022" /></div>
              <div><label className={labelCls}>Make</label><input className={fieldCls} value={make} onChange={(e) => setMake(e.target.value)} placeholder="Ford" /></div>
              <div><label className={labelCls}>Model</label><input className={fieldCls} value={model} onChange={(e) => setModel(e.target.value)} placeholder="Transit" /></div>
              <div><label className={labelCls}>License plate</label><input className={`${fieldCls} font-mono`} value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="8ABC123" /></div>
              <div className="col-span-2">
                <label className={labelCls}>VIN</label>
                <input className={`${fieldCls} font-mono ${vinWarn ? 'border-amber-400' : ''}`} value={vin} onChange={(e) => setVin(e.target.value)} placeholder="1FTBW2CM5NKA12345" />
                {vinWarn && <p className="text-[10px] text-amber-600 mt-1">⚠ VINs are usually 17 characters with no I, O, or Q. Saved anyway — double-check if this is a real VIN.</p>}
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <button onClick={saveFields} disabled={savingFields} className="px-3 py-1.5 bg-gray-900 hover:bg-black disabled:bg-gray-300 text-white text-[12px] font-semibold rounded-lg">
                {savingFields ? 'Saving…' : 'Save details'}
              </button>
              {savedMsg && <span className="text-[11px] text-emerald-600 font-medium">Saved ✓</span>}
            </div>
          </section>

          {/* BIT inspections */}
          <section className="border-t border-gray-100 pt-4">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 font-bold mb-2">BIT inspections</div>
            <div className="text-[12px] text-gray-700 mb-2">
              {latest ? (
                <span>Latest: <span className="font-semibold">{latest.inspectionDate.slice(0, 10)}</span>
                  {' · '}
                  <a href={`/api/fleet/${asset.id}/bit/${latest.id}/pdf`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">View PDF</a>
                </span>
              ) : <span className="text-gray-400">No BIT on file.</span>}
            </div>

            {bits.length > 1 && (
              <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-3 max-h-32 overflow-y-auto">
                {bits.map((b) => (
                  <li key={b.id} className="px-3 py-1.5 text-[11px] flex items-center justify-between">
                    <span className="text-gray-700 font-medium">{b.inspectionDate.slice(0, 10)}</span>
                    <span className="flex items-center gap-2">
                      {b.notes && <span className="text-gray-400 truncate max-w-[180px]">{b.notes}</span>}
                      <a href={`/api/fleet/${asset.id}/bit/${b.id}/pdf`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">PDF</a>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
              <div className="text-[10px] font-semibold text-gray-500">Add a BIT inspection</div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Inspection date</label><input className={fieldCls} type="date" value={bitDate} onChange={(e) => setBitDate(e.target.value)} /></div>
                <div><label className={labelCls}>PDF scan</label><input type="file" accept="application/pdf" onChange={(e) => setBitFile(e.target.files?.[0] ?? null)} className="block w-full text-[11px] text-gray-600 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-gray-200 file:text-gray-700 file:text-[11px]" /></div>
              </div>
              <div><label className={labelCls}>Notes (optional)</label><input className={fieldCls} value={bitNotes} onChange={(e) => setBitNotes(e.target.value)} placeholder="Passed · next due 2026" /></div>
              {bitError && <p className="text-[11px] text-rose-600">{bitError}</p>}
              <button onClick={uploadBit} disabled={uploadingBit || !bitFile || !bitDate} className="px-3 py-1.5 bg-gray-900 hover:bg-black disabled:bg-gray-300 text-white text-[12px] font-semibold rounded-lg">
                {uploadingBit ? 'Uploading…' : 'Upload BIT'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
