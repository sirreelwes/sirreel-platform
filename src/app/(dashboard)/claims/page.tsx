'use client';

import { useState, useMemo } from 'react';

// ═══ Helpers ═══
function toDS(d: Date): string { return d.toISOString().split('T')[0]; }
function addDays(ds: string, n: number): string { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return toDS(d); }
function daysSince(ds: string): number { return Math.round((new Date(today + 'T12:00:00').getTime() - new Date(ds + 'T12:00:00').getTime()) / 86400000); }
function fDate(ds: string): string { return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function fDateLong(ds: string): string { return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
const today = toDS(new Date());

// ═══ Types ═══
type ClaimStatus = 'new' | 'documented' | 'submitted' | 'in_review' | 'negotiating' | 'settled' | 'closed' | 'denied';
type ClaimPriority = 'high' | 'medium' | 'low';

const STATUS_CFG: Record<ClaimStatus, { label: string; color: string; bg: string }> = {
  new: { label: 'New', color: 'text-red-600', bg: 'bg-red-50' },
  documented: { label: 'Documented', color: 'text-amber-600', bg: 'bg-amber-50' },
  submitted: { label: 'Submitted', color: 'text-blue-600', bg: 'bg-blue-50' },
  in_review: { label: 'In Review', color: 'text-purple-600', bg: 'bg-purple-50' },
  negotiating: { label: 'Negotiating', color: 'text-orange-600', bg: 'bg-orange-50' },
  settled: { label: 'Settled', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  closed: { label: 'Closed', color: 'text-gray-500', bg: 'bg-gray-50' },
  denied: { label: 'Denied', color: 'text-red-600', bg: 'bg-red-50' },
};

type Claim = {
  id: string; claimNum: string; insurerClaimNum: string; status: ClaimStatus; priority: ClaimPriority;
  // Vehicle
  vehicle: string; category: string;
  // Damage
  damageDate: string; damageDescription: string; damagePhotos: number;
  // Client / production
  clientCompany: string; productionName: string; jobNum: string;
  clientContact: string; agent: string;
  // Insurance
  clientInsurer: string; clientPolicyNum: string; clientAdjuster: string; clientAdjusterPhone: string;
  // Financials
  repairEstimate: number; repairActual: number | null;
  lostRevenueDays: number; dailyRate: number; lostRevenueTotal: number;
  totalClaim: number;
  amountSettled: number | null;
  // Shop
  repairShop: string; repairETA: string | null;
  // Timeline
  timeline: { date: string; action: string }[];
  // Documents
  documents: { name: string; type: string; date: string }[];
  notes: string;
  createdAt: string;
  actionNeeded: { who: 'us' | 'them' | 'none'; what: string } | null;
};

const CLAIMS: Claim[] = [
  {
    id: 'cl1', claimNum: 'CLM-2026-001', insurerClaimNum: 'FEI-44821-D', status: 'submitted', priority: 'high',
    vehicle: 'SC #36', category: 'Cargo Van',
    damageDate: addDays(today, -6), damageDescription: 'Major roof damage from low clearance impact. Driver drove under a 9ft clearance sign — vehicle is 10\'2". Full roof panel crushed, AC unit destroyed, rear door frame bent.',
    damagePhotos: 8,
    clientCompany: 'Nathan Israel Prod', productionName: 'Lights Out S3', jobNum: 'NI-064',
    clientContact: 'Nathan Israel', agent: 'Jose',
    clientInsurer: 'Film Emporium Insurance', clientPolicyNum: 'FEI-2026-44821', clientAdjuster: 'Mark Reynolds', clientAdjusterPhone: '310-555-0188',
    repairEstimate: 5500, repairActual: null,
    lostRevenueDays: 21, dailyRate: 200, lostRevenueTotal: 4200,
    totalClaim: 9700,
    amountSettled: null,
    repairShop: 'Valley Auto Body', repairETA: addDays(today, 14),
    timeline: [
      { date: addDays(today, -6), action: 'Damage reported by Julian. 8 photos taken via DamageID.' },
      { date: addDays(today, -6), action: 'Jose notified. Vehicle pulled from service.' },
      { date: addDays(today, -5), action: 'Towed to Valley Auto Body. Repair estimate: $5,500.' },
      { date: addDays(today, -4), action: 'Loss of revenue calculated: 21 days × $200/day = $4,200.' },
      { date: addDays(today, -3), action: 'Claim package submitted to Film Emporium Insurance.' },
      { date: addDays(today, -1), action: 'Adjuster Mark Reynolds assigned. Inspection scheduled.' },
    ],
    documents: [
      { name: 'DamageID Photos (8)', type: 'photos', date: addDays(today, -6) },
      { name: 'Valley Auto Body Estimate', type: 'estimate', date: addDays(today, -5) },
      { name: 'Loss of Revenue Calculation', type: 'financial', date: addDays(today, -4) },
      { name: 'Demand Letter', type: 'letter', date: addDays(today, -3) },
      { name: 'Client COI — FEI Policy', type: 'insurance', date: addDays(today, -3) },
    ],
    notes: 'High priority. Vehicle is one of our top cargo vans. Nathan is a VIP client — handle diplomatically but firm on claim.',
    createdAt: addDays(today, -6),
    actionNeeded: { who: 'them', what: 'Adjuster inspection scheduled — waiting on Film Emporium' },
  },
  {
    id: 'cl2', claimNum: 'CLM-2026-002', insurerClaimNum: '', status: 'new', priority: 'medium',
    vehicle: 'Cube #15', category: 'Cube Truck',
    damageDate: addDays(today, -3), damageDescription: 'Scrape damage along right side panel. Appears to have sideswiped a pole or wall. Paint transfer and dent ~4ft long.',
    damagePhotos: 4,
    clientCompany: 'Alyssa Benedetto Prod', productionName: 'Revolve Shoot', jobNum: 'AB-025',
    clientContact: 'Alyssa Benedetto', agent: 'Jose',
    clientInsurer: 'Pending — requesting COI', clientPolicyNum: '', clientAdjuster: '', clientAdjusterPhone: '',
    repairEstimate: 1800, repairActual: null,
    lostRevenueDays: 5, dailyRate: 175, lostRevenueTotal: 875,
    totalClaim: 2675,
    amountSettled: null,
    repairShop: 'Valley Auto Body', repairETA: null,
    timeline: [
      { date: addDays(today, -3), action: 'Damage discovered at check-in by Chris. 4 photos taken.' },
      { date: addDays(today, -2), action: 'Jose notified. Requesting COI from Alyssa.' },
      { date: addDays(today, -1), action: 'Repair estimate from Valley Auto Body: $1,800.' },
    ],
    documents: [
      { name: 'DamageID Photos (4)', type: 'photos', date: addDays(today, -3) },
      { name: 'Valley Auto Body Estimate', type: 'estimate', date: addDays(today, -1) },
    ],
    notes: 'Still waiting on COI from Alyssa. She\'s a preferred client ($41K lifetime) — Jose to handle.',
    createdAt: addDays(today, -3),
    actionNeeded: { who: 'us', what: 'Need to request COI from Alyssa and submit claim package' },
  },
  {
    id: 'cl3', claimNum: 'CLM-2025-018', insurerClaimNum: 'PPI-C-9921', status: 'settled', priority: 'low',
    vehicle: 'Cube #22', category: 'Cube Truck',
    damageDate: '2025-11-15', damageDescription: 'Rear bumper damage. Backed into a loading dock pillar.',
    damagePhotos: 3,
    clientCompany: 'Alex Fymat Prod', productionName: 'Feature Film', jobNum: 'AF-2025-009',
    clientContact: 'Alex Fymat', agent: 'Jose',
    clientInsurer: 'Pacific Production Insurance', clientPolicyNum: 'PPI-88412', clientAdjuster: 'Sandra Wu', clientAdjusterPhone: '323-555-0144',
    repairEstimate: 2200, repairActual: 2100,
    lostRevenueDays: 7, dailyRate: 175, lostRevenueTotal: 1225,
    totalClaim: 3425,
    amountSettled: 3100,
    repairShop: 'Valley Auto Body', repairETA: null,
    timeline: [
      { date: '2025-11-15', action: 'Damage reported.' },
      { date: '2025-11-17', action: 'Claim submitted to Pacific Production Insurance.' },
      { date: '2025-11-22', action: 'Adjuster inspection complete.' },
      { date: '2025-12-05', action: 'Settlement offer: $3,100 (we claimed $3,425).' },
      { date: '2025-12-08', action: 'Settlement accepted. Check received.' },
    ],
    documents: [
      { name: 'DamageID Photos (3)', type: 'photos', date: '2025-11-15' },
      { name: 'Repair Invoice — $2,100', type: 'invoice', date: '2025-12-01' },
      { name: 'Settlement Check — $3,100', type: 'financial', date: '2025-12-08' },
    ],
    notes: 'Settled for $3,100 of $3,425 claimed (90%). Good outcome.',
    createdAt: '2025-11-15',
    actionNeeded: null,
  },
  {
    id: 'cl4', claimNum: 'CLM-2025-015', insurerClaimNum: '', status: 'closed', priority: 'low',
    vehicle: 'Pop #5', category: 'PopVan',
    damageDate: '2025-09-20', damageDescription: 'Interior stain damage. Coffee spill on custom upholstery.',
    damagePhotos: 2,
    clientCompany: 'Snow Story Media', productionName: 'Drake MV', jobNum: 'SS-2025-003',
    clientContact: 'Jason Mayfield', agent: 'Jose',
    clientInsurer: 'N/A — client paid directly', clientPolicyNum: '', clientAdjuster: '', clientAdjusterPhone: '',
    repairEstimate: 650, repairActual: 650,
    lostRevenueDays: 2, dailyRate: 400, lostRevenueTotal: 800,
    totalClaim: 1450,
    amountSettled: 1450,
    repairShop: 'In-House', repairETA: null,
    timeline: [
      { date: '2025-09-20', action: 'Damage noted at check-in.' },
      { date: '2025-09-22', action: 'Jason agreed to pay repair + lost revenue directly.' },
      { date: '2025-09-28', action: 'Payment received. Closed.' },
    ],
    documents: [
      { name: 'DamageID Photos (2)', type: 'photos', date: '2025-09-20' },
      { name: 'Client Payment — $1,450', type: 'financial', date: '2025-09-28' },
    ],
    notes: 'Client paid directly. No insurance claim needed.',
    createdAt: '2025-09-20',
    actionNeeded: null,
  },
];

// ═══ Component ═══
export default function ClaimsPage() {
  const [claims, setClaims] = useState<Claim[]>(CLAIMS);
  const [tab, setTab] = useState<'active' | 'settled' | 'all'>('active');
  const [selected, setSelected] = useState<Claim | null>(null);
  const [showDemandLetter, setShowDemandLetter] = useState(false);
  const [toast, setToast] = useState('');

  const activeClaims = claims.filter(c => !['settled', 'closed', 'denied'].includes(c.status));
  const settledClaims = claims.filter(c => ['settled', 'closed'].includes(c.status));
  const totalOutstanding = activeClaims.reduce((s, c) => s + c.totalClaim, 0);
  const totalRecovered = settledClaims.reduce((s, c) => s + (c.amountSettled || 0), 0);

  const filtered = useMemo(() => {
    if (tab === 'active') return claims.filter(c => !['settled', 'closed', 'denied'].includes(c.status));
    if (tab === 'settled') return claims.filter(c => ['settled', 'closed'].includes(c.status));
    return claims;
  }, [claims, tab]);

  function updateStatus(id: string, newStatus: ClaimStatus) {
    setClaims(prev => prev.map(c => c.id === id ? {
      ...c, status: newStatus,
      timeline: [...c.timeline, { date: today, action: `Status updated to ${STATUS_CFG[newStatus].label}` }]
    } : c));
    if (selected?.id === id) setSelected(prev => prev ? { ...prev, status: newStatus } : null);
  }

  function genDemandLetter(c: Claim): string {
    return `DEMAND FOR COMPENSATION — ${c.claimNum}

To: ${c.clientInsurer}
Policy: ${c.clientPolicyNum}
Adjuster: ${c.clientAdjuster}
Date: ${fDateLong(today)}

Re: Damage to ${c.vehicle} (${c.category})
Incident Date: ${fDateLong(c.damageDate)}
Production: ${c.clientCompany} — "${c.productionName}" (${c.jobNum})

Dear ${c.clientAdjuster || 'Claims Department'},

SirReel Studio Services hereby submits this demand for compensation for damage sustained to our vehicle ${c.vehicle} while under rental to ${c.clientCompany} for the production "${c.productionName}."

DAMAGE DESCRIPTION:
${c.damageDescription}

CLAIM BREAKDOWN:
1. Repair Cost: $${c.repairEstimate.toLocaleString()}
   - Estimate from: ${c.repairShop}
   - ${c.damagePhotos} photographs documenting damage (attached)

2. Loss of Revenue: $${c.lostRevenueTotal.toLocaleString()}
   - Daily rental rate: $${c.dailyRate}/day
   - Estimated days out of service: ${c.lostRevenueDays} days
   - Lost bookings during repair period

TOTAL DEMAND: $${c.totalClaim.toLocaleString()}

Supporting documentation is attached including damage photographs, repair estimate, rental rate documentation, and loss of revenue calculation.

We request payment within 30 days of receipt of this demand. Please contact us at your earliest convenience to discuss resolution.

Sincerely,

SirReel Studio Services
818-515-2389
claims@sirreel.com`;
  }

  return (
    <div>
      {/* Stats */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-3">
          {[
            { label: 'Active Claims', value: String(activeClaims.length), color: 'text-red-600', bg: 'bg-red-50' },
            { label: 'Outstanding', value: '$' + totalOutstanding.toLocaleString(), color: 'text-amber-600', bg: 'bg-amber-50' },
            { label: 'Recovered', value: '$' + totalRecovered.toLocaleString(), color: 'text-emerald-600', bg: 'bg-emerald-50' },
          ].map(s => (
            <div key={s.label} className={`px-3 py-1.5 rounded-lg border border-gray-200 ${s.bg}`}>
              <span className="text-[10px] text-gray-500 uppercase font-bold">{s.label}</span>
              <span className={`ml-2 text-[14px] font-extrabold ${s.color}`}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-2">
        {[
          { key: 'active' as const, label: 'Active', count: activeClaims.length },
          { key: 'settled' as const, label: 'Settled', count: settledClaims.length },
          { key: 'all' as const, label: 'All', count: claims.length },
        ].map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setSelected(null); }}
            className={`px-3 py-1.5 rounded text-[11px] font-semibold border ${tab === t.key ? 'bg-gray-100 text-gray-900 border-gray-300' : 'border-gray-200 text-gray-500'}`}>
            {t.label} <span className="ml-1">{t.count}</span>
          </button>
        ))}
      </div>

      {/* Split view */}
      <div className="flex gap-3 h-[calc(100vh-220px)]">
        {/* List */}
        <div className={`${selected ? 'w-[45%]' : 'w-full'} overflow-y-auto space-y-1.5`}>
          {filtered.map(c => {
            const st = STATUS_CFG[c.status];
            const isSel = selected?.id === c.id;
            const isResolved = ['settled', 'closed'].includes(c.status);
            return (
              <div key={c.id} onClick={() => setSelected(c)}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${isSel ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200 hover:border-gray-300'} ${isResolved ? 'opacity-50' : ''}`}
                style={{ borderLeftWidth: 3, borderLeftColor: c.status === 'new' ? '#dc2626' : c.status === 'documented' ? '#d97706' : c.status === 'submitted' ? '#2563eb' : c.status === 'in_review' ? '#9333ea' : c.status === 'negotiating' ? '#ea580c' : c.status === 'settled' ? '#059669' : '#9ca3af' }}>
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13px] font-bold text-gray-900">{c.vehicle}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${st.bg} ${st.color}`}>{st.label}</span>
                      <span className="text-[9px] text-gray-400">{c.claimNum}{c.insurerClaimNum && ` · ${c.insurerClaimNum}`}</span>
                    </div>
                    <div className="text-[12px] text-gray-700 mt-0.5">{c.damageDescription.slice(0, 80)}...</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {c.clientCompany} · {c.productionName} · {daysSince(c.damageDate)}d ago · {c.agent}
                    </div>
                    {c.actionNeeded && (
                      <div className={`text-[10px] mt-1 font-semibold ${c.actionNeeded.who === 'us' ? 'text-red-600' : 'text-blue-600'}`}>
                        {c.actionNeeded.who === 'us' ? '🔴 Action needed: ' : '⏳ Waiting on them: '}{c.actionNeeded.what}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-[14px] font-extrabold text-gray-900">${c.totalClaim.toLocaleString()}</div>
                    {c.amountSettled !== null && <div className="text-[10px] text-emerald-600 font-semibold">Settled ${c.amountSettled.toLocaleString()}</div>}
                  </div>
                </div>
                {/* Progress bar */}
                {(() => {
                  const steps: { key: ClaimStatus; icon: string; label: string }[] = [
                    { key: 'new', icon: '⚠️', label: 'New' },
                    { key: 'documented', icon: '📸', label: 'Documented' },
                    { key: 'submitted', icon: '📤', label: 'Submitted' },
                    { key: 'in_review', icon: '🔍', label: 'In Review' },
                    { key: 'negotiating', icon: '💬', label: 'Negotiating' },
                    { key: 'settled', icon: '💰', label: 'Settled' },
                  ];
                  const stepKeys = steps.map(s => s.key);
                  const currentIdx = stepKeys.indexOf(c.status);
                  const resolvedIdx = c.status === 'closed' ? steps.length - 1 : c.status === 'denied' ? -1 : currentIdx;
                  return (
                    <div className="mt-2.5">
                      <div className="flex items-center justify-between relative">
                        {/* Connecting line */}
                        <div className="absolute top-3 left-3 right-3 h-0.5 bg-gray-200 z-0" />
                        <div className="absolute top-3 left-3 h-0.5 bg-blue-400 z-0 transition-all" style={{ width: resolvedIdx >= 0 ? `${(resolvedIdx / (steps.length - 1)) * 100}%` : '0%', maxWidth: 'calc(100% - 24px)' }} />
                        {steps.map((s, i) => {
                          const reached = i <= resolvedIdx;
                          const isCurrent = i === resolvedIdx;
                          return (
                            <div key={s.key} className="flex flex-col items-center z-10" style={{ width: `${100 / steps.length}%` }}>
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] border-2 transition-all ${
                                reached ? isCurrent ? 'bg-white border-blue-500 shadow-sm' : 'bg-emerald-50 border-emerald-400' : 'bg-white border-gray-200'
                              }`}>
                                <span className={reached ? '' : 'grayscale opacity-30'}>{s.icon}</span>
                              </div>
                              <span className={`text-[7px] mt-0.5 font-semibold ${isCurrent ? 'text-blue-600' : reached ? 'text-emerald-600' : 'text-gray-300'}`}>{s.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>

        {/* Detail */}
        {selected && (
          <div className="w-[55%] flex-shrink-0 overflow-y-auto border-l border-gray-200 pl-3">
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="text-[10px] text-gray-400">{selected.claimNum}{selected.insurerClaimNum && <span> · Insurer Ref: <span className="text-gray-600 font-medium">{selected.insurerClaimNum}</span></span>}</div>
                <h2 className="text-lg font-bold text-gray-900">{selected.vehicle} — {selected.category}</h2>
                <a href={`/bookings?search=${encodeURIComponent(selected.jobNum)}`} className="text-[12px] text-blue-600 hover:text-blue-700 hover:underline cursor-pointer">
                  {selected.clientCompany} · {selected.productionName} #{selected.jobNum} →
                </a>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            {/* Status + actions */}
            <div className="flex items-center gap-1.5 flex-wrap mb-3">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_CFG[selected.status].bg} ${STATUS_CFG[selected.status].color}`}>{STATUS_CFG[selected.status].label}</span>
              {selected.status === 'new' && <button onClick={() => updateStatus(selected.id, 'documented')} className="px-2.5 py-1 rounded text-[10px] font-bold bg-amber-50 text-amber-600 border border-amber-200">→ Documented</button>}
              {selected.status === 'documented' && <button onClick={() => updateStatus(selected.id, 'submitted')} className="px-2.5 py-1 rounded text-[10px] font-bold bg-blue-50 text-blue-600 border border-blue-200">→ Submit Claim</button>}
              {selected.status === 'submitted' && <button onClick={() => updateStatus(selected.id, 'in_review')} className="px-2.5 py-1 rounded text-[10px] font-bold bg-purple-50 text-purple-600 border border-purple-200">→ In Review</button>}
              {selected.status === 'in_review' && <button onClick={() => updateStatus(selected.id, 'negotiating')} className="px-2.5 py-1 rounded text-[10px] font-bold bg-orange-50 text-orange-600 border border-orange-200">→ Negotiating</button>}
              {['negotiating', 'in_review'].includes(selected.status) && <button onClick={() => updateStatus(selected.id, 'settled')} className="px-2.5 py-1 rounded text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-200">✓ Settled</button>}
              {!['settled', 'closed', 'denied'].includes(selected.status) && (
                <button onClick={() => setShowDemandLetter(true)} className="px-2.5 py-1 rounded text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200">⚡ AI Demand Letter</button>
              )}
            </div>

            {/* Action needed banner */}
            {selected.actionNeeded && (
              <div className={`p-3 rounded-lg mb-3 flex items-center gap-2 ${selected.actionNeeded.who === 'us' ? 'bg-red-50 border border-red-200' : 'bg-blue-50 border border-blue-200'}`}>
                <span className="text-lg">{selected.actionNeeded.who === 'us' ? '🔴' : '⏳'}</span>
                <div>
                  <div className={`text-[12px] font-bold ${selected.actionNeeded.who === 'us' ? 'text-red-700' : 'text-blue-700'}`}>
                    {selected.actionNeeded.who === 'us' ? 'We need to act' : 'Waiting on insurance'}
                  </div>
                  <div className={`text-[11px] ${selected.actionNeeded.who === 'us' ? 'text-red-600' : 'text-blue-600'}`}>{selected.actionNeeded.what}</div>
                </div>
              </div>
            )}

            {/* Damage description */}
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 mb-3">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Damage</div>
              <div className="text-[12px] text-gray-700 leading-relaxed">{selected.damageDescription}</div>
              <div className="text-[11px] text-gray-500 mt-1">📸 {selected.damagePhotos} photos · Occurred {fDateLong(selected.damageDate)}</div>
            </div>

            {/* Financials */}
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 mb-3">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Claim Breakdown</div>
              <div className="space-y-1.5 text-[12px]">
                <div className="flex justify-between"><span className="text-gray-500">Repair Estimate</span><span className="text-gray-900 font-semibold">${selected.repairEstimate.toLocaleString()}</span></div>
                {selected.repairActual !== null && <div className="flex justify-between"><span className="text-gray-500">Repair Actual</span><span className="text-gray-900 font-semibold">${selected.repairActual.toLocaleString()}</span></div>}
                <div className="flex justify-between"><span className="text-gray-500">Loss of Revenue ({selected.lostRevenueDays}d × ${selected.dailyRate}/day)</span><span className="text-gray-900 font-semibold">${selected.lostRevenueTotal.toLocaleString()}</span></div>
                <div className="flex justify-between pt-1.5 border-t border-gray-200"><span className="font-bold text-gray-900">Total Claim</span><span className="text-lg font-extrabold text-gray-900">${selected.totalClaim.toLocaleString()}</span></div>
                {selected.amountSettled !== null && (
                  <div className="flex justify-between"><span className="font-bold text-emerald-600">Amount Settled</span><span className="text-lg font-extrabold text-emerald-600">${selected.amountSettled.toLocaleString()}</span></div>
                )}
              </div>
            </div>

            {/* Insurance + client info */}
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 mb-3">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Insurance</div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <div><span className="text-gray-400">Insurer: </span><span className="text-gray-700">{selected.clientInsurer || '—'}</span></div>
                <div><span className="text-gray-400">Policy: </span><span className="text-gray-700">{selected.clientPolicyNum || '—'}</span></div>
                <div><span className="text-gray-400">Insurer Claim #: </span><span className="text-gray-700 font-medium">{selected.insurerClaimNum || 'Pending'}</span></div>
                <div><span className="text-gray-400">Adjuster: </span><span className="text-gray-700">{selected.clientAdjuster || '—'}</span></div>
                <div><span className="text-gray-400">Adjuster Phone: </span><span className="text-gray-700">{selected.clientAdjusterPhone || '—'}</span></div>
                <div><span className="text-gray-400">Client: </span><span className="text-gray-700">{selected.clientContact}</span></div>
                <div><span className="text-gray-400">Agent: </span><span className="text-gray-700">{selected.agent}</span></div>
                <div><span className="text-gray-400">Shop: </span><span className="text-gray-700">{selected.repairShop}</span></div>
                <div><span className="text-gray-400">Repair ETA: </span><span className="text-gray-700">{selected.repairETA ? fDateLong(selected.repairETA) : '—'}</span></div>
              </div>
            </div>

            {/* Documents */}
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 mb-3">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Documents ({selected.documents.length})</div>
              <div className="space-y-1">
                {selected.documents.map((doc, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span>{doc.type === 'photos' ? '📸' : doc.type === 'estimate' ? '📋' : doc.type === 'letter' ? '📄' : doc.type === 'insurance' ? '🛡️' : '💰'}</span>
                      <span className="text-gray-700">{doc.name}</span>
                    </div>
                    <span className="text-gray-400">{fDate(doc.date)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Timeline */}
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 mb-3">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Timeline</div>
              <div className="space-y-2">
                {selected.timeline.map((t, i) => (
                  <div key={i} className="flex gap-2 text-[11px]">
                    <div className="flex flex-col items-center flex-shrink-0">
                      <div className="w-2 h-2 rounded-full bg-gray-300 mt-1" />
                      {i < selected.timeline.length - 1 && <div className="w-px flex-1 bg-gray-200 mt-0.5" />}
                    </div>
                    <div className="pb-2">
                      <div className="text-gray-400 text-[10px]">{fDate(t.date)}</div>
                      <div className="text-gray-700">{t.action}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selected.notes && (
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 mb-3 text-[11px] text-amber-700">{selected.notes}</div>
            )}
          </div>
        )}
      </div>

      {/* AI Demand Letter Modal */}
      {showDemandLetter && selected && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center" onClick={() => setShowDemandLetter(false)}>
          <div className="bg-white rounded-2xl w-[580px] max-w-[95vw] max-h-[85vh] overflow-y-auto p-5 shadow-2xl border border-gray-200" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900">⚡ AI Demand Letter</h3>
                <p className="text-[11px] text-gray-500">Auto-generated from claim data. Review and edit before sending.</p>
              </div>
              <button onClick={() => setShowDemandLetter(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <textarea className="w-full border border-gray-200 rounded-lg p-3 text-[12px] text-gray-700 font-mono resize-none leading-relaxed" rows={24}
              defaultValue={genDemandLetter(selected)} />
            <div className="flex gap-2 mt-3">
              <button onClick={() => setShowDemandLetter(false)} className="flex-1 py-2 rounded-lg bg-gray-100 text-gray-600 font-semibold text-[12px]">Cancel</button>
              <button onClick={() => { setShowDemandLetter(false); setToast('Demand letter saved to documents'); setTimeout(() => setToast(''), 3000); }}
                className="flex-1 py-2 rounded-lg bg-black text-white font-bold text-[12px]">Save to Documents</button>
              <button onClick={() => { setShowDemandLetter(false); setToast('Demand letter sent to insurer'); setTimeout(() => setToast(''), 3000); }}
                className="flex-1 py-2 rounded-lg bg-blue-600 text-white font-bold text-[12px]">Send to Insurer</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="fixed bottom-4 right-4 px-4 py-2 rounded-lg bg-emerald-500 text-white text-[12px] font-semibold shadow-lg z-50">{toast}</div>}
    </div>
  );
}
