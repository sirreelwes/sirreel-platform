'use client';

import { useState, useMemo } from 'react';

// ═══ Types ═══
type Tier = 'vip' | 'preferred' | 'standard' | 'new';
type Role = 'UPM' | 'Producer' | 'Line Producer' | 'Prod Coordinator' | 'Art Coordinator' | 'Trans Coordinator' | 'Other';

type Affiliation = { companyId: string; companyName: string; production: string | null; spend: number; bookings: number; isCurrent: boolean };

type Person = {
  id: string; firstName: string; lastName: string; email: string; phone: string;
  role: Role; tier: Tier; agent: string; totalSpend: number; totalBookings: number;
  lastBooking: string | null; coi: boolean; notes: string;
  affiliations: Affiliation[];
};

type Company = {
  id: string; name: string; type: string; totalSpend: number; totalBookings: number;
  billingEmail: string | null; coi: boolean; coiExpiry: string | null;
  people: { personId: string; name: string; role: Role; production: string | null; spend: number }[];
};

// ═══ Helpers ═══
function toDS(d: Date): string { return d.toISOString().split('T')[0]; }
function addDays(ds: string, n: number): string { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return toDS(d); }
const today = toDS(new Date());
function daysSince(d: string | null): number { if (!d) return 999; return Math.round((new Date(today + 'T12:00:00').getTime() - new Date(d + 'T12:00:00').getTime()) / 86400000); }
function fDate(ds: string | null): string { if (!ds) return 'Never'; return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

const TIER_CFG: Record<Tier, { label: string; color: string; bg: string }> = {
  vip: { label: 'VIP', color: 'text-yellow-700', bg: 'bg-yellow-50' },
  preferred: { label: 'Preferred', color: 'text-blue-600', bg: 'bg-blue-50' },
  standard: { label: 'Standard', color: 'text-neutral-600', bg: 'bg-gray-100' },
  new: { label: 'New', color: 'text-emerald-600', bg: 'bg-emerald-50' },
};

const ROLE_COLORS: Record<string, string> = {
  'UPM': 'text-orange-600 bg-orange-50',
  'Producer': 'text-purple-600 bg-purple-50',
  'Line Producer': 'text-pink-600 bg-pink-50',
  'Prod Coordinator': 'text-cyan-600 bg-cyan-50',
  'Art Coordinator': 'text-teal-600 bg-teal-50',
  'Trans Coordinator': 'text-amber-600 bg-amber-50',
  'Other': 'text-neutral-600 bg-gray-100',
};

// ═══ Data ═══
const PEOPLE: Person[] = [
  { id: 'p1', firstName: 'Terry', lastName: 'Meadows', email: 'rentals@cinepowerlight.com', phone: '818-846-0123', role: 'UPM', tier: 'vip', agent: 'Jose', totalSpend: 87500, totalBookings: 45, lastBooking: addDays(today, -2), coi: true, notes: 'Major account. Always needs cubes + cargo. Fast turnaround. Follows us from show to show.', affiliations: [
    { companyId: 'co1', companyName: 'Cinepower & Light', production: 'Spring Auto Campaign', spend: 52000, bookings: 28, isCurrent: true },
    { companyId: 'co19', companyName: 'Netflix', production: 'Stranger Things S5', spend: 25000, bookings: 12, isCurrent: false },
    { companyId: 'co20', companyName: 'Paramount Pictures', production: 'MI: Dead Reckoning P2', spend: 10500, bookings: 5, isCurrent: false },
  ]},
  { id: 'p2', firstName: 'Justin', lastName: 'Kappenstein', email: 'jtkappenstein@gmail.com', phone: '610-733-5834', role: 'Producer', tier: 'vip', agent: 'Oliver', totalSpend: 142000, totalBookings: 75, lastBooking: addDays(today, -5), coi: true, notes: 'Highest booking count. Feature films, very organized. Works across multiple studios.', affiliations: [
    { companyId: 'co2', companyName: 'Justin K Productions', production: 'Midnight Run 2', spend: 82000, bookings: 42, isCurrent: true },
    { companyId: 'co20', companyName: 'Paramount Pictures', production: 'Untitled Thriller', spend: 28000, bookings: 15, isCurrent: false },
    { companyId: 'co19', companyName: 'Netflix', production: 'Glass Onion 3', spend: 20000, bookings: 11, isCurrent: false },
    { companyId: 'co21', companyName: 'HBO / Max', production: 'White Lotus S4', spend: 12000, bookings: 7, isCurrent: false },
  ]},
  { id: 'p3', firstName: 'Nathan', lastName: 'Israel', email: 'nathan.israel@me.com', phone: '562-708-4444', role: 'UPM', tier: 'vip', agent: 'Jose', totalSpend: 118000, totalBookings: 64, lastBooking: today, coi: true, notes: 'TV series work. Repeat client, prefers cargo vans. Currently on HBO show.', affiliations: [
    { companyId: 'co3', companyName: 'Nathan Israel Prod', production: 'Lights Out S3', spend: 78000, bookings: 42, isCurrent: false },
    { companyId: 'co21', companyName: 'HBO / Max', production: 'Industry S4', spend: 10000, bookings: 6, isCurrent: true },
    { companyId: 'co19', companyName: 'Netflix', production: 'Unknown Project', spend: 30000, bookings: 16, isCurrent: false },
  ]},
  { id: 'p4', firstName: 'Elli', lastName: 'Legerski', email: 'elli.legerski@gmail.com', phone: '719-406-8300', role: 'Producer', tier: 'preferred', agent: 'Jose', totalSpend: 64200, totalBookings: 38, lastBooking: today, coi: true, notes: 'Branded content. Uses PopVans heavily.', affiliations: [
    { companyId: 'co4', companyName: 'Elli Legerski Prod', production: null, spend: 64200, bookings: 38, isCurrent: true },
  ]},
  { id: 'p5', firstName: 'Brandon', lastName: 'McClover', email: 'brandon.ajrfilms@gmail.com', phone: '323-921-6504', role: 'Producer', tier: 'preferred', agent: 'Jose', totalSpend: 38500, totalBookings: 21, lastBooking: addDays(today, -9), coi: true, notes: 'Music videos. Quick bookings, usually 1-2 day rentals.', affiliations: [
    { companyId: 'co5', companyName: 'AJR Films', production: null, spend: 38500, bookings: 21, isCurrent: true },
  ]},
  { id: 'p6', firstName: 'Alyssa', lastName: 'Benedetto', email: 'alycancreate@gmail.com', phone: '516-458-7846', role: 'Producer', tier: 'preferred', agent: 'Jose', totalSpend: 41000, totalBookings: 24, lastBooking: addDays(today, -6), coi: true, notes: 'Photo shoots & commercials. Consistent booker.', affiliations: [
    { companyId: 'co14', companyName: 'Alyssa Benedetto Prod', production: null, spend: 41000, bookings: 24, isCurrent: true },
  ]},
  { id: 'p7', firstName: 'Stephen', lastName: 'Predisik', email: 's.predisik@gmail.com', phone: '310-975-4462', role: 'UPM', tier: 'preferred', agent: 'Oliver', totalSpend: 54000, totalBookings: 32, lastBooking: addDays(today, -37), coi: true, notes: 'Feature films. Reliable. Works across studios. Should follow up for spring projects.', affiliations: [
    { companyId: 'co15', companyName: 'Stephen Predisik Films', production: 'The Last Mile', spend: 32000, bookings: 18, isCurrent: false },
    { companyId: 'co20', companyName: 'Paramount Pictures', production: 'Untitled Drama', spend: 22000, bookings: 14, isCurrent: false },
  ]},
  { id: 'p8', firstName: 'Nathalie', lastName: 'Sar Shalom', email: 'natspfilm@gmail.com', phone: '818-825-2861', role: 'Producer', tier: 'preferred', agent: 'Oliver', totalSpend: 28400, totalBookings: 17, lastBooking: addDays(today, -4), coi: true, notes: 'AFI projects. Uses Lankershim standing sets frequently.', affiliations: [
    { companyId: 'co6', companyName: 'Nathalie SP Film', production: null, spend: 28400, bookings: 17, isCurrent: true },
  ]},
  { id: 'p9', firstName: 'Beth', lastName: 'Schiffman', email: 'bschiffman@icloud.com', phone: '818-599-1267', role: 'UPM', tier: 'standard', agent: 'Jose', totalSpend: 22000, totalBookings: 12, lastBooking: '2025-12-15', coi: false, notes: "TV pilots. Haven't heard from her since December.", affiliations: [
    { companyId: 'co11', companyName: 'Beth Schiffman Prod', production: null, spend: 22000, bookings: 12, isCurrent: false },
  ]},
  { id: 'p10', firstName: 'Alex', lastName: 'Fymat', email: 'afymat@yahoo.com', phone: '323-493-1011', role: 'Producer', tier: 'standard', agent: 'Jose', totalSpend: 19500, totalBookings: 11, lastBooking: '2025-11-20', coi: false, notes: 'Went quiet in November. Was a regular.', affiliations: [
    { companyId: 'co12', companyName: 'Alex Fymat Prod', production: null, spend: 19500, bookings: 11, isCurrent: false },
  ]},
  { id: 'p11', firstName: 'Maddie', lastName: 'Harmon', email: 'madharmon96@gmail.com', phone: '602-748-0393', role: 'Producer', tier: 'standard', agent: 'Dani', totalSpend: 16800, totalBookings: 10, lastBooking: today, coi: false, notes: 'Documentaries. Camera cubes.', affiliations: [
    { companyId: 'co13', companyName: 'Maddie Harmon Prod', production: null, spend: 16800, bookings: 10, isCurrent: true },
  ]},
  { id: 'p12', firstName: 'Taylor', lastName: 'Woods', email: 'taylor.rose.woods@gmail.com', phone: '347-401-3357', role: 'Prod Coordinator', tier: 'standard', agent: 'Jose', totalSpend: 15200, totalBookings: 9, lastBooking: '2026-01-20', coi: true, notes: "Commercials. Hasn't booked in a while.", affiliations: [
    { companyId: 'co16', companyName: 'Taylor Woods Prod', production: null, spend: 15200, bookings: 9, isCurrent: false },
  ]},
  { id: 'p13', firstName: 'Bethel', lastName: 'Teshome', email: 'bethel.teshome18@gmail.com', phone: '562-688-7392', role: 'Producer', tier: 'standard', agent: 'Jose', totalSpend: 14500, totalBookings: 9, lastBooking: '2025-10-05', coi: false, notes: 'Music videos. Lost touch — need to re-engage.', affiliations: [
    { companyId: 'co17', companyName: 'Bethel Teshome Prod', production: null, spend: 14500, bookings: 9, isCurrent: false },
  ]},
  { id: 'p14', firstName: 'Jason', lastName: 'Mayfield', email: 'jason@snowstory.com', phone: '817-874-2259', role: 'Producer', tier: 'standard', agent: 'Jose', totalSpend: 12600, totalBookings: 5, lastBooking: addDays(today, -1), coi: true, notes: 'Music videos. Likes DLUX trailers for talent.', affiliations: [
    { companyId: 'co7', companyName: 'Snow Story Media', production: null, spend: 12600, bookings: 5, isCurrent: true },
  ]},
  { id: 'p15', firstName: 'Laura', lastName: 'DuBois', email: 'laura@thewildfactory.com', phone: '516-241-1371', role: 'Prod Coordinator', tier: 'standard', agent: 'Jose', totalSpend: 7200, totalBookings: 4, lastBooking: today, coi: true, notes: 'Scout vans mostly.', affiliations: [
    { companyId: 'co8', companyName: 'Wild Factory', production: null, spend: 7200, bookings: 4, isCurrent: true },
  ]},
  { id: 'p16', firstName: 'Jason', lastName: 'Friedman-Mendez', email: 'jason@jaykatproductions.com', phone: '917-755-5002', role: 'Producer', tier: 'standard', agent: 'Jose', totalSpend: 6800, totalBookings: 4, lastBooking: addDays(today, -46), coi: false, notes: 'Growing account. Short films.', affiliations: [
    { companyId: 'co9', companyName: 'JayKat Productions', production: null, spend: 6800, bookings: 4, isCurrent: false },
  ]},
  { id: 'p17', firstName: 'Neka', lastName: 'Berrian', email: 'neka.berrian@gmail.com', phone: '323-590-2379', role: 'Producer', tier: 'standard', agent: 'Dani', totalSpend: 5800, totalBookings: 4, lastBooking: '2026-01-10', coi: false, notes: 'Indie films.', affiliations: [
    { companyId: 'co18', companyName: 'Neka Berrian Prod', production: null, spend: 5800, bookings: 4, isCurrent: false },
  ]},
  { id: 'p18', firstName: 'Ella', lastName: 'Swanstrom', email: 'ESwanstrom@fabletics.com', phone: '503-871-6121', role: 'Prod Coordinator', tier: 'new', agent: 'Jose', totalSpend: 0, totalBookings: 0, lastBooking: null, coi: false, notes: 'New client. Spring campaign inquiry. Big potential — studio + fleet.', affiliations: [
    { companyId: 'co10', companyName: 'Fabletics', production: 'Spring Campaign', spend: 0, bookings: 0, isCurrent: true },
  ]},
];

// Build companies from affiliations
const COMPANIES: Company[] = (() => {
  const map: Record<string, Company> = {};
  PEOPLE.forEach(p => p.affiliations.forEach(a => {
    if (!map[a.companyId]) {
      map[a.companyId] = { id: a.companyId, name: a.companyName, type: 'Production', totalSpend: 0, totalBookings: 0, billingEmail: null, coi: false, coiExpiry: null, people: [] };
    }
    map[a.companyId].totalSpend += a.spend;
    map[a.companyId].totalBookings += a.bookings;
    map[a.companyId].people.push({ personId: p.id, name: `${p.firstName} ${p.lastName}`, role: p.role, production: a.production, spend: a.spend });
  }));
  return Object.values(map).sort((a, b) => b.totalSpend - a.totalSpend);
})();

// ═══ Component ═══
export default function CRMPage() {
  const [tab, setTab] = useState<'people' | 'companies' | 'followup' | 'segments'>('people');
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('All');
  const [roleFilter, setRoleFilter] = useState('All');
  const [sortBy, setSortBy] = useState('spend');
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);

  const needFollowUp = PEOPLE.filter(p => daysSince(p.lastBooking) > 30).length;
  const totalPeopleSpend = PEOPLE.reduce((s, p) => s + p.totalSpend, 0);

  // Filtered people
  const filteredPeople = useMemo(() => {
    let list = PEOPLE.filter(p => {
      const q = search.toLowerCase();
      const ms = !q || `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) || p.email.toLowerCase().includes(q) || p.affiliations.some(a => a.companyName.toLowerCase().includes(q));
      const mt = tierFilter === 'All' || p.tier === tierFilter;
      const mr = roleFilter === 'All' || p.role === roleFilter;
      return ms && mt && mr;
    });
    if (tab === 'followup') list = list.filter(p => daysSince(p.lastBooking) > 30);
    list.sort((a, b) => {
      if (sortBy === 'spend') return b.totalSpend - a.totalSpend;
      if (sortBy === 'bookings') return b.totalBookings - a.totalBookings;
      if (sortBy === 'recent') return daysSince(a.lastBooking) - daysSince(b.lastBooking);
      if (sortBy === 'inactive') return daysSince(b.lastBooking) - daysSince(a.lastBooking);
      return a.lastName.localeCompare(b.lastName);
    });
    return list;
  }, [search, tierFilter, roleFilter, sortBy, tab]);

  const filteredCompanies = useMemo(() => {
    const q = search.toLowerCase();
    return COMPANIES.filter(c => !q || c.name.toLowerCase().includes(q) || c.people.some(p => p.name.toLowerCase().includes(q)))
      .sort((a, b) => b.totalSpend - a.totalSpend);
  }, [search]);

  const detail = selectedPerson || selectedCompany;

  return (
    <div className="flex gap-4 h-[calc(100vh-120px)]">
      {/* Left panel */}
      <div className={`${detail ? 'w-[55%]' : 'w-full'} flex flex-col min-w-0 transition-all`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-lg font-bold text-gray-900">CRM</h1>
            <div className="flex gap-3 text-[11px] mt-0.5">
              <span className="text-gray-500">{PEOPLE.length} people · {COMPANIES.length} companies</span>
              <span className="text-amber-700 font-semibold">${totalPeopleSpend.toLocaleString()} lifetime</span>
              <span className="text-amber-400 font-semibold">{needFollowUp} need follow-up</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-2">
          {[
            { key: 'people' as const, label: '👤 People', count: PEOPLE.length },
            { key: 'companies' as const, label: '🏢 Companies', count: COMPANIES.length },
            { key: 'followup' as const, label: '🔔 Follow-Up', count: needFollowUp },
            { key: 'segments' as const, label: '📊 Segments', count: null },
          ].map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setSelectedPerson(null); setSelectedCompany(null); }}
              className={`px-3 py-1.5 rounded-md text-[11px] font-semibold border transition-all ${
                tab === t.key ? 'bg-gray-100 text-gray-900 border-white/20' : 'bg-transparent border-gray-200 text-gray-500 hover:border-gray-400'
              }`}>
              {t.label}{t.count !== null && <span className="ml-1.5 text-[10px]">{t.count}</span>}
            </button>
          ))}
        </div>

        {/* Segments view */}
        {tab === 'segments' ? (
          <div className="grid grid-cols-2 gap-2 overflow-y-auto">
            {[
              { label: 'VIP People', desc: 'Top spenders across all shows', filter: (p: Person) => p.tier === 'vip', color: 'border-l-yellow-400' },
              { label: 'Multi-Company', desc: 'People who bring business from multiple companies', filter: (p: Person) => p.affiliations.length > 1, color: 'border-l-orange-400' },
              { label: 'UPMs', desc: 'Unit Production Managers — key decision makers', filter: (p: Person) => p.role === 'UPM', color: 'border-l-orange-300' },
              { label: 'Producers', desc: 'Producers — direct relationships', filter: (p: Person) => p.role === 'Producer', color: 'border-l-purple-400' },
              { label: 'Coordinators', desc: 'Production & Art Coordinators', filter: (p: Person) => p.role.includes('Coordinator'), color: 'border-l-cyan-400' },
              { label: 'At Risk (60+ days)', desc: "Haven't booked in 2 months", filter: (p: Person) => daysSince(p.lastBooking) > 60, color: 'border-l-red-400' },
              { label: 'Missing COI', desc: 'Need insurance cert on file', filter: (p: Person) => !p.coi && p.totalBookings > 0, color: 'border-l-red-400' },
              { label: 'New People', desc: 'Recent additions to nurture', filter: (p: Person) => p.tier === 'new', color: 'border-l-emerald-400' },
            ].map(seg => {
              const matches = PEOPLE.filter(seg.filter);
              const revenue = matches.reduce((s, p) => s + p.totalSpend, 0);
              return (
                <div key={seg.label} className={`p-3 bg-white rounded-lg border border-gray-200 border-l-[3px] ${seg.color}`}>
                  <div className="font-bold text-gray-900 text-[13px]">{seg.label}</div>
                  <div className="text-[11px] text-gray-400 mb-2">{seg.desc}</div>
                  <div className="flex gap-6">
                    <div><div className="text-[9px] text-gray-400 font-bold uppercase">People</div><div className="text-lg font-extrabold text-gray-900">{matches.length}</div></div>
                    <div><div className="text-[9px] text-gray-400 font-bold uppercase">Revenue</div><div className="text-lg font-extrabold text-amber-700">${revenue.toLocaleString()}</div></div>
                  </div>
                  <div className="mt-2 text-[10px] text-gray-400">{matches.slice(0, 3).map(p => `${p.firstName} ${p.lastName}`).join(', ')}{matches.length > 3 ? ` +${matches.length - 3}` : ''}</div>
                </div>
              );
            })}
          </div>
        ) : tab === 'companies' ? (
          /* ═══ COMPANIES LIST ═══ */
          <>
            <div className="flex gap-2 mb-2">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search company or person name..." className="input flex-1 text-[12px] py-1.5" />
            </div>
            <div className="flex-1 overflow-y-auto space-y-1">
              {filteredCompanies.map(c => {
                const isSelected = selectedCompany?.id === c.id;
                return (
                  <div key={c.id} onClick={() => { setSelectedCompany(c); setSelectedPerson(null); }}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${isSelected ? 'bg-gray-100 border-white/20' : 'bg-white border-gray-200 hover:border-gray-400'}`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-[13px] font-bold text-gray-900">{c.name}</div>
                        <div className="text-[11px] text-gray-400 mt-0.5">
                          {c.people.length} {c.people.length === 1 ? 'person' : 'people'} · {c.totalBookings} bookings
                        </div>
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          {c.people.slice(0, 3).map(p => p.name).join(', ')}{c.people.length > 3 ? ` +${c.people.length - 3}` : ''}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[14px] font-extrabold text-amber-700">${c.totalSpend.toLocaleString()}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          /* ═══ PEOPLE LIST ═══ */
          <>
            <div className="flex gap-2 mb-2 flex-wrap">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, company..." className="input flex-1 min-w-[180px] text-[12px] py-1.5" />
              <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="input w-36 text-[11px] py-1.5 appearance-none cursor-pointer">
                <option value="All">All Roles</option>
                <option value="UPM">UPM</option>
                <option value="Producer">Producer</option>
                <option value="Line Producer">Line Producer</option>
                <option value="Prod Coordinator">Coordinator</option>
              </select>
              <select value={tierFilter} onChange={e => setTierFilter(e.target.value)} className="input w-28 text-[11px] py-1.5 appearance-none cursor-pointer">
                <option value="All">All Tiers</option>
                <option value="vip">VIP</option>
                <option value="preferred">Preferred</option>
                <option value="standard">Standard</option>
                <option value="new">New</option>
              </select>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="input w-28 text-[11px] py-1.5 appearance-none cursor-pointer">
                <option value="spend">Revenue ↓</option>
                <option value="bookings">Bookings ↓</option>
                <option value="recent">Recent</option>
                <option value="inactive">Inactive</option>
                <option value="name">Name</option>
              </select>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1">
              {filteredPeople.map(p => {
                const tc = TIER_CFG[p.tier];
                const ds = daysSince(p.lastBooking);
                const isSelected = selectedPerson?.id === p.id;
                const multiCompany = p.affiliations.length > 1;
                return (
                  <div key={p.id} onClick={() => { setSelectedPerson(p); setSelectedCompany(null); }}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${isSelected ? 'bg-gray-100 border-white/20' : 'bg-white border-gray-200 hover:border-gray-400'}`}
                    style={{ borderLeftWidth: 3, borderLeftColor: tc.color.includes('yellow') ? '#ffd700' : tc.color.includes('blue') ? '#4488ff' : tc.color.includes('emerald') ? '#44cc66' : '#666' }}>
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-bold text-gray-900">{p.firstName} {p.lastName}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${ROLE_COLORS[p.role] || ROLE_COLORS['Other']}`}>{p.role}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${tc.bg} ${tc.color}`}>{tc.label}</span>
                          {multiCompany && <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-orange-50 text-orange-600">{p.affiliations.length} companies</span>}
                          {!p.coi && p.totalBookings > 0 && <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-red-50 text-red-600">NO COI</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400 flex-wrap">
                          <span>{p.affiliations.find(a => a.isCurrent)?.companyName || p.affiliations[0]?.companyName}</span>
                          <span>·</span>
                          <span>Agent: {p.agent}</span>
                          <span>·</span>
                          <span className={ds > 60 ? 'text-red-600 font-bold' : ds > 30 ? 'text-amber-400 font-semibold' : ''}>
                            {p.lastBooking ? `${ds}d ago` : 'Never'}
                          </span>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-[14px] font-extrabold text-amber-700">${p.totalSpend.toLocaleString()}</div>
                        <div className="text-[10px] text-gray-400">{p.totalBookings} bookings</div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filteredPeople.length === 0 && <div className="py-8 text-center text-gray-400">No people match your filters</div>}
            </div>
          </>
        )}
      </div>

      {/* ═══ PERSON DETAIL PANEL ═══ */}
      {selectedPerson && (
        <div className="w-[45%] flex-shrink-0 overflow-y-auto border-l border-gray-200 pl-4">
          <div className="flex justify-between items-start mb-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-xl font-bold text-gray-900">{selectedPerson.firstName} {selectedPerson.lastName}</h2>
                <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${ROLE_COLORS[selectedPerson.role]}`}>{selectedPerson.role}</span>
                <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${TIER_CFG[selectedPerson.tier].bg} ${TIER_CFG[selectedPerson.tier].color}`}>{TIER_CFG[selectedPerson.tier].label}</span>
              </div>
              <div className="text-[12px] text-gray-400">{selectedPerson.email}</div>
              <div className="text-[12px] text-gray-400">{selectedPerson.phone}</div>
            </div>
            <button onClick={() => setSelectedPerson(null)} className="text-gray-500 hover:text-black text-sm p-1">✕</button>
          </div>

          {/* Lifetime stats */}
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-3xl font-extrabold text-amber-700">${selectedPerson.totalSpend.toLocaleString()}</span>
            <span className="text-[12px] text-gray-400">across {selectedPerson.affiliations.length} {selectedPerson.affiliations.length === 1 ? 'company' : 'companies'}</span>
          </div>

          <div className="grid grid-cols-4 gap-2 mb-4">
            {[
              { l: 'Bookings', v: String(selectedPerson.totalBookings), c: 'text-gray-900' },
              { l: 'Companies', v: String(selectedPerson.affiliations.length), c: selectedPerson.affiliations.length > 1 ? 'text-orange-600' : 'text-gray-900' },
              { l: 'Last Active', v: daysSince(selectedPerson.lastBooking) + 'd', c: daysSince(selectedPerson.lastBooking) > 30 ? 'text-amber-400' : 'text-emerald-600' },
              { l: 'Agent', v: selectedPerson.agent, c: 'text-gray-500' },
            ].map(s => (
              <div key={s.l} className="p-2 bg-white rounded-lg border border-gray-200">
                <div className="text-[8px] font-bold text-gray-400 uppercase tracking-wider">{s.l}</div>
                <div className={`text-[14px] font-bold mt-0.5 ${s.c}`}>{s.v}</div>
              </div>
            ))}
          </div>

          {/* Production history — the key feature */}
          <div className="p-3 bg-white rounded-lg border border-gray-200 mb-3">
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">
              Production History ({selectedPerson.affiliations.length} {selectedPerson.affiliations.length === 1 ? 'company' : 'companies'})
            </div>
            <div className="space-y-2">
              {selectedPerson.affiliations.map((a, i) => (
                <div key={i} className={`p-2.5 rounded-lg border ${a.isCurrent ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-bold text-gray-900">{a.companyName}</span>
                        {a.isCurrent && <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-emerald-500/20 text-emerald-600">CURRENT</span>}
                      </div>
                      {a.production && <div className="text-[11px] text-gray-500 mt-0.5">{a.production}</div>}
                    </div>
                    <div className="text-right">
                      <div className="text-[13px] font-bold text-amber-700">${a.spend.toLocaleString()}</div>
                      <div className="text-[9px] text-gray-400">{a.bookings} bookings</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          {selectedPerson.notes && (
            <div className="p-3 bg-white rounded-lg border border-gray-200 mb-3">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Notes</div>
              <div className="text-[12px] text-gray-500 leading-relaxed">{selectedPerson.notes}</div>
            </div>
          )}

          {/* Actions */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button className="btn-secondary text-[11px] text-left px-3">📧 Send Email</button>
            <button className="btn-secondary text-[11px] text-left px-3">📋 New Booking</button>
            <button className="btn-secondary text-[11px] text-left px-3">📝 Add Note</button>
            <button className="btn-secondary text-[11px] text-left px-3">🔗 Add Affiliation</button>
          </div>

          {/* Follow-up alert */}
          {daysSince(selectedPerson.lastBooking) > 30 && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-500/20 text-[12px]">
              <div className="font-bold text-amber-600 mb-1">⚠ Follow-Up Needed</div>
              <div className="text-amber-700">
                {selectedPerson.firstName} hasn&apos;t booked in {daysSince(selectedPerson.lastBooking)} days.
                {selectedPerson.affiliations.length > 1
                  ? ` They've worked across ${selectedPerson.affiliations.length} companies — likely starting a new show soon.`
                  : selectedPerson.totalSpend > 20000 ? ' High-value relationship worth re-engaging.' : ' Consider reaching out about upcoming projects.'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ COMPANY DETAIL PANEL ═══ */}
      {selectedCompany && (
        <div className="w-[45%] flex-shrink-0 overflow-y-auto border-l border-gray-200 pl-4">
          <div className="flex justify-between items-start mb-3">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{selectedCompany.name}</h2>
              <div className="text-[12px] text-gray-400 mt-0.5">
                {selectedCompany.people.length} {selectedCompany.people.length === 1 ? 'person' : 'people'} · {selectedCompany.totalBookings} bookings
              </div>
            </div>
            <button onClick={() => setSelectedCompany(null)} className="text-gray-500 hover:text-black text-sm p-1">✕</button>
          </div>

          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-3xl font-extrabold text-amber-700">${selectedCompany.totalSpend.toLocaleString()}</span>
            <span className="text-[12px] text-gray-400">company total</span>
          </div>

          {/* People who've worked for this company */}
          <div className="p-3 bg-white rounded-lg border border-gray-200 mb-3">
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">
              People ({selectedCompany.people.length})
            </div>
            <div className="space-y-2">
              {selectedCompany.people.map((p, i) => {
                const fullPerson = PEOPLE.find(pp => pp.id === p.personId);
                return (
                  <div key={i} className="p-2.5 bg-gray-50 rounded-lg border border-gray-200 cursor-pointer hover:border-gray-400 transition-all"
                    onClick={() => { if (fullPerson) { setSelectedPerson(fullPerson); setSelectedCompany(null); } }}>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-bold text-gray-900">{p.name}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${ROLE_COLORS[p.role]}`}>{p.role}</span>
                        </div>
                        {p.production && <div className="text-[11px] text-gray-500 mt-0.5">{p.production}</div>}
                      </div>
                      <div className="text-right">
                        <div className="text-[13px] font-bold text-amber-700">${p.spend.toLocaleString()}</div>
                        {fullPerson && <div className="text-[9px] text-gray-400">${fullPerson.totalSpend.toLocaleString()} lifetime</div>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button className="btn-secondary text-[11px] text-left px-3">📋 New Booking</button>
            <button className="btn-secondary text-[11px] text-left px-3">📝 Edit Company</button>
          </div>
        </div>
      )}
    </div>
  );
}
