'use client';

import { useState, useMemo } from 'react';

// ═══ Helpers ═══
function toDS(d: Date): string { return d.toISOString().split('T')[0]; }
function addDays(ds: string, n: number): string { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return toDS(d); }
function daysSince(ds: string): number { return Math.round((new Date(today + 'T12:00:00').getTime() - new Date(ds + 'T12:00:00').getTime()) / 86400000); }
function fDate(ds: string): string { return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function fDateLong(ds: string): string { return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
const today = toDS(new Date());

// ═══ Shops ═══
const SHOPS = [
  { id: 'shop1', name: 'High Tech Auto', type: 'Mechanic', phone: '818-555-0101' },
  { id: 'shop2', name: 'Valley Auto Body', type: 'Body Shop', phone: '818-555-0202' },
  { id: 'shop3', name: 'Nissan Dealer — Van Nuys', type: 'Dealer', phone: '818-555-0303' },
  { id: 'shop4', name: 'Ford Dealer — Glendale', type: 'Dealer', phone: '818-555-0404' },
  { id: 'inhouse', name: 'In-House (Chestnut)', type: 'Internal', phone: '' },
];

// ═══ Types ═══
type Priority = 'critical' | 'high' | 'medium' | 'low';
type MaintStatus = 'in_shop' | 'waiting_parts' | 'scheduled' | 'diagnosed' | 'complete';
type MaintType = 'repair' | 'damage' | 'preventive' | 'inspection';

type MaintRecord = {
  id: string;
  vehicleId: string; vehicleName: string; category: string;
  type: MaintType; priority: Priority; status: MaintStatus;
  issue: string; description: string;
  shopId: string; shopName: string;
  reportedBy: string; reportedDate: string;
  estimatedCost: number | null; actualCost: number | null;
  estimatedDone: string | null;
  // Damage reporting
  damageClient: string | null; // who had it when damage occurred
  damageAgent: string | null; // agent to notify
  damagePhotos: number; // count of photos
  damageNotified: boolean; // has agent been notified
  // History
  notes: string[];
};

const PRIORITY_CFG: Record<Priority, { label: string; color: string; bg: string }> = {
  critical: { label: 'Critical', color: 'text-red-700', bg: 'bg-red-50' },
  high: { label: 'High', color: 'text-orange-700', bg: 'bg-orange-50' },
  medium: { label: 'Medium', color: 'text-amber-700', bg: 'bg-amber-50' },
  low: { label: 'Low', color: 'text-gray-600', bg: 'bg-gray-50' },
};

const STATUS_CFG: Record<MaintStatus, { label: string; color: string; bg: string }> = {
  in_shop: { label: 'In Shop', color: 'text-red-600', bg: 'bg-red-50' },
  waiting_parts: { label: 'Waiting Parts', color: 'text-amber-600', bg: 'bg-amber-50' },
  scheduled: { label: 'Scheduled', color: 'text-blue-600', bg: 'bg-blue-50' },
  diagnosed: { label: 'Diagnosed', color: 'text-purple-600', bg: 'bg-purple-50' },
  complete: { label: 'Complete', color: 'text-emerald-600', bg: 'bg-emerald-50' },
};

const TYPE_CFG: Record<MaintType, { label: string; icon: string }> = {
  repair: { label: 'Repair', icon: '🔧' },
  damage: { label: 'Damage', icon: '⚠️' },
  preventive: { label: 'Preventive', icon: '📋' },
  inspection: { label: 'Inspection', icon: '🔍' },
};

// ═══ Real Data ═══
const RECORDS: MaintRecord[] = [
  { id: 'm1', vehicleId: 'cube24', vehicleName: 'Cube #24(A)', category: 'Cube Truck', type: 'repair', priority: 'critical', status: 'in_shop', issue: 'Bad motor', description: 'Motor failure. Vehicle undriveable. At High Tech for diagnosis and rebuild.', shopId: 'shop1', shopName: 'High Tech Auto', reportedBy: 'Hugo', reportedDate: addDays(today, -12), estimatedCost: 4500, actualCost: null, estimatedDone: addDays(today, 5), damageClient: null, damageAgent: null, damagePhotos: 0, damageNotified: false, notes: ['3/' + (new Date().getDate() - 12) + ' — Towed to High Tech', '3/' + (new Date().getDate() - 10) + ' — Diagnosed: full motor rebuild needed', '3/' + (new Date().getDate() - 8) + ' — Parts ordered, ETA 1 week'] },
  { id: 'm2', vehicleId: 'cube8', vehicleName: 'Cube #8', category: 'Cube Truck', type: 'repair', priority: 'high', status: 'in_shop', issue: 'Transmission', description: 'Transmission slipping between 2nd and 3rd gear. Needs rebuild or replacement.', shopId: 'shop1', shopName: 'High Tech Auto', reportedBy: 'Julian', reportedDate: addDays(today, -8), estimatedCost: 3200, actualCost: null, estimatedDone: addDays(today, 7), damageClient: null, damageAgent: null, damagePhotos: 0, damageNotified: false, notes: ['Dropped off at High Tech', 'Transmission rebuild confirmed'] },
  { id: 'm3', vehicleId: 'cube15', vehicleName: 'Cube #15', category: 'Cube Truck', type: 'repair', priority: 'medium', status: 'diagnosed', issue: 'Oil leak + reverse issue', description: 'Leaking oil from pan gasket. Also having intermittent reverse gear failure.', shopId: 'inhouse', shopName: 'In-House (Chestnut)', reportedBy: 'Chris', reportedDate: addDays(today, -5), estimatedCost: 800, actualCost: null, estimatedDone: addDays(today, 2), damageClient: null, damageAgent: null, damagePhotos: 0, damageNotified: false, notes: ['Oil pan gasket + reverse solenoid. Parts on order.'] },
  { id: 'm4', vehicleId: 'cube9', vehicleName: 'Cube #9', category: 'Cube Truck', type: 'repair', priority: 'medium', status: 'scheduled', issue: 'Battery', description: 'Dead battery. Needs replacement. Checking alternator too.', shopId: 'inhouse', shopName: 'In-House (Chestnut)', reportedBy: 'Julian', reportedDate: addDays(today, -2), estimatedCost: 250, actualCost: null, estimatedDone: today, damageClient: null, damageAgent: null, damagePhotos: 0, damageNotified: false, notes: ['Battery + alternator test scheduled'] },
  { id: 'm5', vehicleId: 'spr2', vehicleName: 'Sprinter #2', category: 'Cargo Van', type: 'inspection', priority: 'medium', status: 'scheduled', issue: 'Engine inspection', description: 'Routine engine inspection. Slight noise on startup reported by driver.', shopId: 'shop4', shopName: 'Ford Dealer — Glendale', reportedBy: 'Hugo', reportedDate: addDays(today, -3), estimatedCost: 150, actualCost: null, estimatedDone: addDays(today, 1), damageClient: null, damageAgent: null, damagePhotos: 0, damageNotified: false, notes: ['Appointment set for tomorrow'] },
  { id: 'm6', vehicleId: 'sc38', vehicleName: 'SC #38', category: 'Cargo Van', type: 'repair', priority: 'high', status: 'diagnosed', issue: 'Check engine light', description: 'CEL triggered. OBD showing P0420 catalyst efficiency below threshold.', shopId: 'inhouse', shopName: 'In-House (Chestnut)', reportedBy: 'Chris', reportedDate: addDays(today, -4), estimatedCost: 1200, actualCost: null, estimatedDone: addDays(today, 4), damageClient: null, damageAgent: null, damagePhotos: 0, damageNotified: false, notes: ['Catalytic converter likely needs replacement'] },
  { id: 'm7', vehicleId: 'sc36', vehicleName: 'SC #36', category: 'Cargo Van', type: 'damage', priority: 'critical', status: 'in_shop', issue: 'Major roof damage', description: 'Significant roof damage from low clearance impact. Returned by production. Needs full roof panel replacement.', shopId: 'shop2', shopName: 'Valley Auto Body', reportedBy: 'Julian', reportedDate: addDays(today, -6), estimatedCost: 5500, actualCost: null, estimatedDone: addDays(today, 14), damageClient: 'Nathan Israel Prod — Lights Out S3', damageAgent: 'Jose', damagePhotos: 8, damageNotified: true, notes: ['Major roof crush from driving under low clearance', 'Photos sent to Jose for insurance claim', 'At Valley Auto Body — 2-3 week repair'] },
  { id: 'm8', vehicleId: 'nis1', vehicleName: 'Nissan #1', category: 'Cargo Van', type: 'repair', priority: 'high', status: 'in_shop', issue: 'Motor mounts', description: 'Excessive engine vibration. Motor mounts worn/broken. At dealer for replacement.', shopId: 'shop3', shopName: 'Nissan Dealer — Van Nuys', reportedBy: 'Hugo', reportedDate: addDays(today, -7), estimatedCost: 1800, actualCost: null, estimatedDone: addDays(today, 3), damageClient: null, damageAgent: null, damagePhotos: 0, damageNotified: false, notes: ['At Nissan dealer. All 3 mounts need replacement.'] },
  { id: 'm9', vehicleId: 'pop3', vehicleName: 'Pop #3', category: 'PopVan', type: 'repair', priority: 'high', status: 'waiting_parts', issue: 'Transmission (long-term)', description: 'Transmission failure. Sourcing a used unit since new is back-ordered.', shopId: 'shop1', shopName: 'High Tech Auto', reportedBy: 'Hugo', reportedDate: addDays(today, -21), estimatedCost: 3800, actualCost: null, estimatedDone: addDays(today, 14), damageClient: null, damageAgent: null, damagePhotos: 0, damageNotified: false, notes: ['New trans back-ordered 6+ weeks', 'Sourcing used unit from salvage', 'High value vehicle — prioritize'] },
  { id: 'm10', vehicleId: 'pop1', vehicleName: 'Pop #1', category: 'PopVan', type: 'repair', priority: 'low', status: 'scheduled', issue: 'Interior lights', description: 'Multiple interior LED panels not working. Cosmetic but affects client experience.', shopId: 'inhouse', shopName: 'In-House (Chestnut)', reportedBy: 'Chris', reportedDate: addDays(today, -1), estimatedCost: 200, actualCost: null, estimatedDone: addDays(today, 2), damageClient: null, damageAgent: null, damagePhotos: 0, damageNotified: false, notes: ['LED panels ordered'] },
  // Completed
  { id: 'm11', vehicleId: 'cube12', vehicleName: 'Cube #12', category: 'Cube Truck', type: 'preventive', priority: 'low', status: 'complete', issue: 'Oil change + inspection', description: 'Routine 10K mile service.', shopId: 'inhouse', shopName: 'In-House (Chestnut)', reportedBy: 'Julian', reportedDate: addDays(today, -14), estimatedCost: 120, actualCost: 135, estimatedDone: addDays(today, -12), damageClient: null, damageAgent: null, damagePhotos: 0, damageNotified: false, notes: ['Complete. All fluids topped off. Tires good.'] },
  { id: 'm12', vehicleId: 'cargo5', vehicleName: 'Cargo #5', category: 'Cargo Van', type: 'repair', priority: 'medium', status: 'complete', issue: 'Brake pads + rotors', description: 'Front brake pads worn. Rotors need resurfacing.', shopId: 'shop1', shopName: 'High Tech Auto', reportedBy: 'Hugo', reportedDate: addDays(today, -10), estimatedCost: 600, actualCost: 550, estimatedDone: addDays(today, -7), damageClient: null, damageAgent: null, damagePhotos: 0, damageNotified: false, notes: ['Complete. Front brakes done. Rears have 40% life.'] },
];

const FLEET_TEAM = ['Hugo', 'Julian', 'Chris'];
const CATEGORIES = ['Cube Truck', 'Cargo Van', 'PopVan', 'Passenger Van', 'DLUX', 'Camera Cube', 'Studios', 'ProScout/VTR', 'Stakebed'];

// ═══ Component ═══
export default function MaintenancePage() {
  const [records, setRecords] = useState<MaintRecord[]>(RECORDS);
  const [tab, setTab] = useState<'active' | 'damage' | 'scheduled' | 'history'>('active');
  const [selected, setSelected] = useState<MaintRecord | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showDamage, setShowDamage] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');

  // New issue form
  const [nVehicle, setNVehicle] = useState('');
  const [nCategory, setNCategory] = useState('Cube Truck');
  const [nType, setNType] = useState<MaintType>('repair');
  const [nPriority, setNPriority] = useState<Priority>('medium');
  const [nIssue, setNIssue] = useState('');
  const [nDesc, setNDesc] = useState('');
  const [nShop, setNShop] = useState('inhouse');
  const [nCost, setNCost] = useState('');
  const [nReporter, setNReporter] = useState('Hugo');
  // Damage fields
  const [nDClient, setNDClient] = useState('');
  const [nDAgent, setNDAgent] = useState('Jose');
  const [nDPhotos, setNDPhotos] = useState(0);

  // Stats
  const active = records.filter(r => !['complete'].includes(r.status));
  const inShop = records.filter(r => r.status === 'in_shop');
  const damage = records.filter(r => r.type === 'damage' && r.status !== 'complete');
  const totalEstCost = active.reduce((s, r) => s + (r.estimatedCost || 0), 0);
  const unnotified = records.filter(r => r.type === 'damage' && !r.damageNotified && r.damageClient);

  const filtered = useMemo(() => {
    let list = records;
    if (tab === 'active') list = list.filter(r => r.status !== 'complete');
    if (tab === 'damage') list = list.filter(r => r.type === 'damage');
    if (tab === 'scheduled') list = list.filter(r => ['scheduled', 'preventive'].includes(r.status) || r.type === 'preventive');
    if (tab === 'history') list = list.filter(r => r.status === 'complete');
    if (statusFilter !== 'all') list = list.filter(r => r.status === statusFilter);
    const q = search.toLowerCase();
    if (q) list = list.filter(r => r.vehicleName.toLowerCase().includes(q) || r.issue.toLowerCase().includes(q) || r.shopName.toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
    return list.sort((a, b) => {
      const po: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return po[a.priority] - po[b.priority];
    });
  }, [records, tab, statusFilter, search]);

  function createIssue() {
    if (!nVehicle || !nIssue) return;
    const isDamage = nType === 'damage';
    const rec: MaintRecord = {
      id: 'mn' + Date.now(), vehicleId: nVehicle.toLowerCase().replace(/[^a-z0-9]/g, ''),
      vehicleName: nVehicle, category: nCategory, type: nType, priority: nPriority,
      status: isDamage ? 'diagnosed' : 'scheduled', issue: nIssue, description: nDesc,
      shopId: nShop, shopName: SHOPS.find(s => s.id === nShop)?.name || nShop,
      reportedBy: nReporter, reportedDate: today,
      estimatedCost: nCost ? parseInt(nCost) : null, actualCost: null,
      estimatedDone: addDays(today, nPriority === 'critical' ? 3 : nPriority === 'high' ? 7 : 14),
      damageClient: isDamage ? nDClient : null,
      damageAgent: isDamage ? nDAgent : null,
      damagePhotos: isDamage ? nDPhotos : 0,
      damageNotified: false,
      notes: [`${today} — Issue reported by ${nReporter}`],
    };
    setRecords(prev => [...prev, rec]);
    setShowNew(false); setShowDamage(false);
    setSelected(rec);
    setNVehicle(''); setNIssue(''); setNDesc(''); setNCost(''); setNDClient(''); setNDPhotos(0);
    setToast(isDamage ? 'Damage reported — agent notification ready' : 'Maintenance issue logged');
    setTimeout(() => setToast(''), 3000);
  }

  function updateStatus(id: string, newStatus: MaintStatus) {
    setRecords(prev => prev.map(r => r.id === id ? { ...r, status: newStatus, notes: [...r.notes, `${today} — Status → ${STATUS_CFG[newStatus].label}`] } : r));
    if (selected?.id === id) setSelected(prev => prev ? { ...prev, status: newStatus } : null);
  }

  function notifyAgent(id: string) {
    setRecords(prev => prev.map(r => r.id === id ? { ...r, damageNotified: true, notes: [...r.notes, `${today} — Agent ${r.damageAgent} notified with ${r.damagePhotos} photos`] } : r));
    if (selected?.id === id) setSelected(prev => prev ? { ...prev, damageNotified: true } : null);
    setToast('Agent notified with damage report');
    setTimeout(() => setToast(''), 3000);
  }

  return (
    <div>
      {/* Stats bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-3">
          {[
            { label: 'In Shop', value: inShop.length, color: 'text-red-600', bg: 'bg-red-50' },
            { label: 'Active Issues', value: active.length, color: 'text-amber-600', bg: 'bg-amber-50' },
            { label: 'Damage Reports', value: damage.length, color: 'text-orange-600', bg: 'bg-orange-50' },
            { label: 'Est. Costs', value: '$' + totalEstCost.toLocaleString(), color: 'text-gray-900', bg: 'bg-gray-50' },
          ].map(s => (
            <div key={s.label} className={`px-3 py-1.5 rounded-lg border border-gray-200 ${s.bg}`}>
              <span className="text-[10px] text-gray-500 uppercase font-bold">{s.label}</span>
              <span className={`ml-2 text-[14px] font-extrabold ${s.color}`}>{s.value}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setShowDamage(true); setNType('damage'); }} className="px-3 py-1.5 rounded-md bg-red-50 text-red-600 text-xs font-bold border border-red-200 hover:bg-red-100">⚠️ Report Damage</button>
          <button onClick={() => { setShowNew(true); setNType('repair'); }} className="px-3 py-1.5 rounded-md bg-black text-white text-xs font-bold hover:bg-gray-800">+ New Issue</button>
        </div>
      </div>

      {/* Unnotified damage alert */}
      {unnotified.length > 0 && (
        <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-red-500 animate-pulse">🔴</span>
            <span className="font-bold text-red-700">{unnotified.length} damage report{unnotified.length > 1 ? 's' : ''} pending agent notification:</span>
            {unnotified.map((r, i) => <span key={r.id} className="text-red-600">{i > 0 && ' · '}{r.vehicleName} → {r.damageAgent}</span>)}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-2">
        {[
          { key: 'active' as const, label: '🔧 Active', count: active.length },
          { key: 'damage' as const, label: '⚠️ Damage', count: damage.length },
          { key: 'scheduled' as const, label: '📋 Scheduled', count: records.filter(r => r.status === 'scheduled' || r.type === 'preventive').length },
          { key: 'history' as const, label: '✓ History', count: records.filter(r => r.status === 'complete').length },
        ].map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setSelected(null); setStatusFilter('all'); }}
            className={`px-3 py-1.5 rounded text-[11px] font-semibold border ${tab === t.key ? 'bg-gray-100 text-gray-900 border-gray-300' : 'border-gray-200 text-gray-500'}`}>
            {t.label} <span className="ml-1">{t.count}</span>
          </button>
        ))}
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vehicle, issue, shop..." className="input w-full text-[12px] py-2 mb-2" />

      {/* Split view */}
      <div className="flex gap-3 h-[calc(100vh-280px)]">
        {/* List */}
        <div className={`${selected ? 'w-[48%]' : 'w-full'} overflow-y-auto space-y-1`}>
          {filtered.map(r => {
            const pr = PRIORITY_CFG[r.priority];
            const st = STATUS_CFG[r.status];
            const ty = TYPE_CFG[r.type];
            const isSel = selected?.id === r.id;
            const daysOut = daysSince(r.reportedDate);
            return (
              <div key={r.id} onClick={() => setSelected(r)}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${isSel ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200 hover:border-gray-300'} ${r.status === 'complete' ? 'opacity-50' : ''}`}
                style={{ borderLeftWidth: 3, borderLeftColor: r.priority === 'critical' ? '#dc2626' : r.priority === 'high' ? '#ea580c' : r.priority === 'medium' ? '#d97706' : '#9ca3af' }}>
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13px] font-bold text-gray-900">{r.vehicleName}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${pr.bg} ${pr.color}`}>{pr.label}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${st.bg} ${st.color}`}>{st.label}</span>
                      {r.type === 'damage' && <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-red-50 text-red-600">⚠️ DMG</span>}
                      {r.type === 'damage' && !r.damageNotified && r.damageClient && <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-red-500 text-white animate-pulse">NOTIFY</span>}
                    </div>
                    <div className="text-[12px] font-medium text-gray-700 mt-0.5">{r.issue}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {ty.icon} {ty.label} · {r.shopName} · {r.reportedBy} · {daysOut}d ago
                      {r.damageClient && <span className="text-red-500 ml-1">· Client: {r.damageClient}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {r.estimatedCost && <div className="text-[13px] font-bold text-gray-900">${r.estimatedCost.toLocaleString()}</div>}
                    {r.estimatedDone && <div className="text-[10px] text-gray-400">ETA {fDate(r.estimatedDone)}</div>}
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="py-8 text-center text-gray-400 text-[13px]">No records match</div>}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-[52%] flex-shrink-0 overflow-y-auto border-l border-gray-200 pl-3">
            <div className="flex justify-between items-start mb-2">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selected.vehicleName}</h2>
                <div className="text-[12px] text-gray-500">{selected.category} · {TYPE_CFG[selected.type].icon} {TYPE_CFG[selected.type].label}</div>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            {/* Priority + Status */}
            <div className="flex items-center gap-1.5 flex-wrap mb-3">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${PRIORITY_CFG[selected.priority].bg} ${PRIORITY_CFG[selected.priority].color}`}>{PRIORITY_CFG[selected.priority].label}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_CFG[selected.status].bg} ${STATUS_CFG[selected.status].color}`}>{STATUS_CFG[selected.status].label}</span>
              {/* Status advance buttons */}
              {selected.status === 'scheduled' && <button onClick={() => updateStatus(selected.id, 'in_shop')} className="px-2.5 py-1 rounded text-[10px] font-bold bg-red-50 text-red-600 border border-red-200">→ In Shop</button>}
              {selected.status === 'diagnosed' && <button onClick={() => updateStatus(selected.id, 'in_shop')} className="px-2.5 py-1 rounded text-[10px] font-bold bg-red-50 text-red-600 border border-red-200">→ In Shop</button>}
              {selected.status === 'in_shop' && <button onClick={() => updateStatus(selected.id, 'waiting_parts')} className="px-2.5 py-1 rounded text-[10px] font-bold bg-amber-50 text-amber-600 border border-amber-200">→ Waiting Parts</button>}
              {['in_shop', 'waiting_parts', 'diagnosed', 'scheduled'].includes(selected.status) && <button onClick={() => updateStatus(selected.id, 'complete')} className="px-2.5 py-1 rounded text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-200">✓ Complete</button>}
            </div>

            {/* Damage alert */}
            {selected.type === 'damage' && selected.damageClient && (
              <div className={`p-3 rounded-lg mb-3 ${selected.damageNotified ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                <div className="text-[12px] font-bold text-gray-900 mb-1">⚠️ Damage Report</div>
                <div className="text-[11px] text-gray-600 space-y-1">
                  <div><span className="text-gray-400">Client:</span> {selected.damageClient}</div>
                  <div><span className="text-gray-400">Agent:</span> {selected.damageAgent}</div>
                  <div><span className="text-gray-400">Photos:</span> {selected.damagePhotos} uploaded</div>
                  <div><span className="text-gray-400">Status:</span> {selected.damageNotified ? <span className="text-emerald-600 font-semibold">✓ Agent notified</span> : <span className="text-red-600 font-semibold">Pending notification</span>}</div>
                </div>
                {!selected.damageNotified && (
                  <button onClick={() => notifyAgent(selected.id)} className="mt-2 w-full py-2 rounded-lg bg-red-600 text-white text-[12px] font-bold hover:bg-red-700">
                    📧 Notify {selected.damageAgent} with Damage Report + Photos
                  </button>
                )}
              </div>
            )}

            {/* Issue details */}
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 mb-3">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Issue</div>
              <div className="text-[14px] font-bold text-gray-900 mb-1">{selected.issue}</div>
              <div className="text-[12px] text-gray-600 leading-relaxed">{selected.description}</div>
            </div>

            {/* Shop + dates + cost */}
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 mb-3">
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div><span className="text-gray-400">Shop: </span><span className="text-gray-700 font-medium">{selected.shopName}</span></div>
                <div><span className="text-gray-400">Reported: </span><span className="text-gray-700">{fDateLong(selected.reportedDate)}</span></div>
                <div><span className="text-gray-400">Reporter: </span><span className="text-gray-700">{selected.reportedBy}</span></div>
                <div><span className="text-gray-400">ETA Done: </span><span className="text-gray-700">{selected.estimatedDone ? fDateLong(selected.estimatedDone) : '—'}</span></div>
                <div><span className="text-gray-400">Est. Cost: </span><span className="text-gray-900 font-bold">{selected.estimatedCost ? `$${selected.estimatedCost.toLocaleString()}` : '—'}</span></div>
                <div><span className="text-gray-400">Actual: </span><span className="text-gray-900 font-bold">{selected.actualCost ? `$${selected.actualCost.toLocaleString()}` : '—'}</span></div>
              </div>
            </div>

            {/* Timeline / notes */}
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 mb-3">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Activity Log</div>
              <div className="space-y-1.5">
                {selected.notes.map((note, i) => (
                  <div key={i} className="flex gap-2 text-[11px]">
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" />
                    <span className="text-gray-600">{note}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Cost tracking */}
            {selected.status !== 'complete' && (
              <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 mb-3">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Update Cost</div>
                <div className="flex gap-2">
                  <input type="number" placeholder="Actual cost" className="input text-[12px] flex-1" onChange={e => {
                    const val = parseInt(e.target.value) || 0;
                    setRecords(prev => prev.map(r => r.id === selected.id ? { ...r, actualCost: val } : r));
                  }} />
                  <button onClick={() => { updateStatus(selected.id, 'complete'); setToast('Marked complete'); setTimeout(() => setToast(''), 3000); }}
                    className="px-4 py-2 rounded-md bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700">Close + Complete</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ NEW ISSUE MODAL ═══ */}
      {(showNew || showDamage) && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center" onClick={() => { setShowNew(false); setShowDamage(false); }}>
          <div className="bg-white border border-gray-200 rounded-2xl w-[520px] max-w-[95vw] max-h-[90vh] overflow-y-auto p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-900">{showDamage ? '⚠️ Report Damage' : '🔧 New Maintenance Issue'}</h3>
              <button onClick={() => { setShowNew(false); setShowDamage(false); }} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
            </div>

            {/* Vehicle */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Vehicle</div>
                <input value={nVehicle} onChange={e => setNVehicle(e.target.value)} placeholder="e.g. Cube #24" className="input text-[13px] py-2.5" autoFocus />
              </div>
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Category</div>
                <select value={nCategory} onChange={e => setNCategory(e.target.value)} className="input text-[13px] py-2.5">
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {/* Type + Priority */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              {!showDamage && (
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Type</div>
                  <select value={nType} onChange={e => setNType(e.target.value as MaintType)} className="input text-[12px]">
                    <option value="repair">🔧 Repair</option>
                    <option value="preventive">📋 Preventive</option>
                    <option value="inspection">🔍 Inspection</option>
                  </select>
                </div>
              )}
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Priority</div>
                <select value={nPriority} onChange={e => setNPriority(e.target.value as Priority)} className="input text-[12px]">
                  <option value="critical">🔴 Critical — vehicle down</option>
                  <option value="high">🟠 High — needs attention</option>
                  <option value="medium">🟡 Medium — can wait</option>
                  <option value="low">⚪ Low — cosmetic/minor</option>
                </select>
              </div>
            </div>

            {/* Issue */}
            <div className="mb-3">
              <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Issue</div>
              <input value={nIssue} onChange={e => setNIssue(e.target.value)} placeholder="Short description (e.g. 'Bad motor')" className="input text-[12px]" />
            </div>
            <div className="mb-3">
              <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Details</div>
              <textarea value={nDesc} onChange={e => setNDesc(e.target.value)} placeholder="Full description, symptoms, what happened..." className="input text-[12px] resize-none" rows={3} />
            </div>

            {/* Damage-specific fields */}
            {showDamage && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 mb-3">
                <div className="text-[10px] font-bold text-red-600 uppercase mb-2">Damage Details</div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Client / Production</div>
                    <input value={nDClient} onChange={e => setNDClient(e.target.value)} placeholder="Who had the vehicle?" className="input text-[12px]" />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Account Manager</div>
                    <select value={nDAgent} onChange={e => setNDAgent(e.target.value)} className="input text-[12px]">
                      <option>Jose</option><option>Oliver</option><option>Dani</option>
                    </select>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Photos (from DamageID)</div>
                  <input type="number" value={nDPhotos} onChange={e => setNDPhotos(parseInt(e.target.value) || 0)} placeholder="Number of photos" className="input text-[12px]" />
                </div>
              </div>
            )}

            {/* Shop + cost */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Shop / Vendor</div>
                <select value={nShop} onChange={e => setNShop(e.target.value)} className="input text-[12px]">
                  {SHOPS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Estimated Cost</div>
                <input value={nCost} onChange={e => setNCost(e.target.value)} placeholder="$" className="input text-[12px]" />
              </div>
            </div>

            {/* Reporter */}
            <div className="mb-4">
              <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Reported By</div>
              <select value={nReporter} onChange={e => setNReporter(e.target.value)} className="input text-[12px]">
                {FLEET_TEAM.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>

            <div className="flex gap-2">
              <button onClick={() => { setShowNew(false); setShowDamage(false); }} className="flex-1 py-2.5 rounded-lg text-[12px] font-semibold bg-gray-100 text-gray-600 border border-gray-200">Cancel</button>
              <button onClick={createIssue} disabled={!nVehicle || !nIssue}
                className={`flex-1 py-2.5 rounded-lg text-[12px] font-bold ${nVehicle && nIssue
                  ? showDamage ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-black text-white hover:bg-gray-800'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                {showDamage ? '⚠️ Report Damage' : '🔧 Log Issue'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="fixed bottom-4 right-4 px-4 py-2 rounded-lg bg-emerald-500 text-white text-[12px] font-semibold shadow-lg z-50">{toast}</div>}
    </div>
  );
}
