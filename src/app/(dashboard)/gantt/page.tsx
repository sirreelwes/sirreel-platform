'use client';

import { useState, useMemo } from 'react';

// ═══ Helpers ═══
function toDS(d: Date): string { return d.toISOString().split('T')[0]; }
function addDays(ds: string, n: number): string { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return toDS(d); }
function diffDays(a: string, b: string): number { return Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000); }
function fDay(ds: string): string { return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' }); }
function fMonth(ds: string): string { return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
const today = toDS(new Date());

// ═══ Fleet ═══
const CATS = [
  { key: 'cube', label: 'Cube Truck', short: 'Cube', units: 41, color: '#3b82f6' },
  { key: 'cargo', label: 'Cargo Van w/ LG', short: 'Cargo', units: 30, color: '#8b5cf6' },
  { key: 'pass', label: 'Passenger Van', short: 'Pass', units: 10, color: '#06b6d4' },
  { key: 'pop', label: 'PopVan', short: 'Pop', units: 9, color: '#f59e0b' },
  { key: 'cam', label: 'Camera Cube', short: 'Cam', units: 7, color: '#ec4899' },
  { key: 'dlux', label: 'DLUX', short: 'DLUX', units: 8, color: '#10b981' },
  { key: 'scout', label: 'ProScout/VTR', short: 'Scout', units: 3, color: '#f97316' },
  { key: 'studio', label: 'Studios', short: 'Studio', units: 10, color: '#6366f1' },
  { key: 'stakebed', label: 'Stakebed', short: 'Stake', units: 3, color: '#78716c' },
];
function catOf(k: string) { return CATS.find(c => c.key === k); }

// Generate individual units per category
type Unit = { id: string; name: string; cat: string; status: 'available' | 'booked' | 'maintenance' };
function generateUnits(): Unit[] {
  const units: Unit[] = [];
  const maintUnits: Record<string, string[]> = {
    cube: ['Cube #24(A)', 'Cube #8', 'Cube #15', 'Cube #9'],
    cargo: ['SC #38', 'SC #36', 'Nissan #1', 'Sprinter #2'],
    pop: ['Pop #3', 'Pop #1'],
  };
  CATS.forEach(cat => {
    for (let i = 1; i <= cat.units; i++) {
      const name = `${cat.short} #${i}`;
      const isMaint = maintUnits[cat.key]?.some(m => m === name);
      units.push({ id: `${cat.key}-${i}`, name, cat: cat.key, status: isMaint ? 'maintenance' : 'available' });
    }
  });
  return units;
}
const ALL_UNITS = generateUnits();

// ═══ Jobs ═══
type JobItem = { cat: string; qty: number; start: string; end: string };
type Job = {
  id: string; company: string; jobName: string; jobNum: string;
  contact: string; agent: string; stage: string;
  items: JobItem[];
  color: string;
};

const JOBS: Job[] = [
  { id: 'j1', company: 'Cinepower & Light', jobName: 'Spring Auto Campaign', jobNum: 'CP-041', contact: 'Terry Meadows', agent: 'Jose', stage: 'active', items: [
    { cat: 'cube', qty: 6, start: today, end: addDays(today, 3) },
  ], color: '#3b82f6' },
  { id: 'j2', company: 'Justin K Productions', jobName: 'Midnight Run 2', jobNum: 'JKP-018', contact: 'Justin Kappenstein', agent: 'Oliver', stage: 'booked', items: [
    { cat: 'cube', qty: 4, start: addDays(today, 1), end: addDays(today, 6) },
  ], color: '#8b5cf6' },
  { id: 'j3', company: 'Nathan Israel Prod', jobName: 'Lights Out S3', jobNum: 'NI-064', contact: 'Nathan Israel', agent: 'Jose', stage: 'active', items: [
    { cat: 'cargo', qty: 5, start: today, end: addDays(today, 4) },
  ], color: '#06b6d4' },
  { id: 'j4', company: 'Elli Legerski Prod', jobName: 'Nike Branded', jobNum: 'EL-038', contact: 'Elli Legerski', agent: 'Jose', stage: 'active', items: [
    { cat: 'pop', qty: 2, start: today, end: addDays(today, 5) },
  ], color: '#f59e0b' },
  { id: 'j5', company: 'Snow Story Media', jobName: 'Cold Front MV', jobNum: 'SS-005', contact: 'Jason Mayfield', agent: 'Jose', stage: 'booked', items: [
    { cat: 'dlux', qty: 2, start: addDays(today, 1), end: addDays(today, 4) },
    { cat: 'cube', qty: 3, start: addDays(today, 1), end: addDays(today, 4) },
  ], color: '#10b981' },
  { id: 'j6', company: 'Fabletics', jobName: 'Spring Campaign', jobNum: 'FAB-001', contact: 'Ella Swanstrom', agent: 'Jose', stage: 'booked', items: [
    { cat: 'studio', qty: 2, start: addDays(today, 1), end: addDays(today, 3) },
  ], color: '#6366f1' },
  { id: 'j7', company: 'Beth Schiffman Prod', jobName: 'Greystone Pilot', jobNum: 'BS-013', contact: 'Beth Schiffman', agent: 'Jose', stage: 'hold', items: [
    { cat: 'cube', qty: 5, start: addDays(today, 3), end: addDays(today, 8) },
    { cat: 'cargo', qty: 3, start: addDays(today, 3), end: addDays(today, 8) },
  ], color: '#f97316' },
  { id: 'j8', company: 'Paramount Pictures', jobName: 'Untitled Drama', jobNum: 'PAR-007', contact: 'Stephen Predisik', agent: 'Oliver', stage: 'hold', items: [
    { cat: 'cargo', qty: 4, start: addDays(today, 2), end: addDays(today, 5) },
  ], color: '#ec4899' },
  { id: 'j9', company: 'AJR Films', jobName: 'Megan Thee Stallion MV', jobNum: 'AJR-050', contact: 'Brandon McClover', agent: 'Jose', stage: 'inquiry', items: [
    { cat: 'cube', qty: 8, start: addDays(today, 5), end: addDays(today, 12) },
  ], color: '#ef4444' },
  { id: 'j10', company: 'Alyssa Benedetto Prod', jobName: 'Revolve Shoot', jobNum: 'AB-025', contact: 'Alyssa Benedetto', agent: 'Jose', stage: 'quoted', items: [
    { cat: 'cube', qty: 3, start: addDays(today, 4), end: addDays(today, 7) },
  ], color: '#a855f7' },
];

// Maintenance blocks (for asset view)
const MAINT_BLOCKS: { unitName: string; issue: string; start: string; end: string }[] = [
  { unitName: 'Cube #24(A)', issue: 'Bad motor', start: addDays(today, -12), end: addDays(today, 5) },
  { unitName: 'Cube #8', issue: 'Transmission', start: addDays(today, -8), end: addDays(today, 7) },
  { unitName: 'Cube #15', issue: 'Oil/reverse', start: addDays(today, -5), end: addDays(today, 2) },
  { unitName: 'Cube #9', issue: 'Battery', start: addDays(today, -2), end: today },
  { unitName: 'SC #38', issue: 'Check engine', start: addDays(today, -4), end: addDays(today, 4) },
  { unitName: 'SC #36', issue: 'Roof damage', start: addDays(today, -6), end: addDays(today, 14) },
  { unitName: 'Nissan #1', issue: 'Motor mounts', start: addDays(today, -7), end: addDays(today, 3) },
  { unitName: 'Pop #3', issue: 'Transmission', start: addDays(today, -21), end: addDays(today, 14) },
  { unitName: 'Pop #1', issue: 'Interior lights', start: addDays(today, -1), end: addDays(today, 2) },
];

const STAGE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  active: { bg: 'bg-emerald-400', border: 'border-emerald-500', text: 'text-white' },
  booked: { bg: 'bg-blue-400', border: 'border-blue-500', text: 'text-white' },
  hold: { bg: 'bg-amber-300', border: 'border-amber-400', text: 'text-amber-900' },
  quoted: { bg: 'bg-purple-300', border: 'border-purple-400', text: 'text-purple-900' },
  inquiry: { bg: 'bg-sky-200', border: 'border-sky-300', text: 'text-sky-800' },
};

// ═══ Component ═══
export default function GanttPage() {
  const [view, setView] = useState<'job' | 'asset'>('job');
  const [weeks, setWeeks] = useState(2);
  const [catFilter, setCatFilter] = useState('all');
  const [selected, setSelected] = useState<Job | null>(null);

  // Date range
  const startDate = addDays(today, -2);
  const totalDays = weeks * 7;
  const dates = Array.from({ length: totalDays }, (_, i) => addDays(startDate, i));
  const dayWidth = weeks <= 2 ? 48 : weeks <= 3 ? 36 : 28;

  function getBarStyle(itemStart: string, itemEnd: string) {
    const s = Math.max(0, diffDays(startDate, itemStart));
    const e = Math.min(totalDays - 1, diffDays(startDate, itemEnd));
    if (e < 0 || s >= totalDays) return null;
    return { left: s * dayWidth, width: (e - s + 1) * dayWidth - 2 };
  }

  const todayOffset = diffDays(startDate, today);

  // Asset assignments: map each unit to its jobs
  const unitAssignments = useMemo(() => {
    const map: Record<string, { job: Job; item: JobItem; unitIndex: number }[]> = {};
    JOBS.forEach(job => {
      job.items.forEach(item => {
        const cat = item.cat;
        // Assign to specific unit numbers
        const catUnits = ALL_UNITS.filter(u => u.cat === cat && u.status !== 'maintenance');
        let assigned = 0;
        for (const unit of catUnits) {
          if (assigned >= item.qty) break;
          // Check if unit is already assigned during these dates
          const existing = map[unit.id] || [];
          const conflict = existing.some(a => a.item.end >= item.start && a.item.start <= item.end);
          if (!conflict) {
            if (!map[unit.id]) map[unit.id] = [];
            map[unit.id].push({ job, item, unitIndex: assigned });
            assigned++;
          }
        }
      });
    });
    return map;
  }, []);

  // Filtered units for asset view
  const filteredUnits = useMemo(() => {
    if (catFilter === 'all') return ALL_UNITS;
    return ALL_UNITS.filter(u => u.cat === catFilter);
  }, [catFilter]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-gray-900">Timeline</h1>
          {/* View toggle */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => setView('job')} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${view === 'job' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>By Job</button>
            <button onClick={() => setView('asset')} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${view === 'asset' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>By Asset</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {view === 'asset' && (
            <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-[11px] bg-white">
              <option value="all">All Categories</option>
              {CATS.map(c => <option key={c.key} value={c.key}>{c.label} ({c.units})</option>)}
            </select>
          )}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {[1, 2, 3, 4].map(w => (
              <button key={w} onClick={() => setWeeks(w)} className={`px-2 py-1 rounded-md text-[10px] font-semibold ${weeks === w ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{w}W</button>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-3 mb-2 text-[10px] flex-wrap">
        {[
          { label: 'Active', color: 'bg-emerald-400' },
          { label: 'Booked', color: 'bg-blue-400' },
          { label: 'Hold', color: 'bg-amber-300' },
          { label: 'Quoted', color: 'bg-purple-300' },
          { label: 'Inquiry', color: 'bg-sky-200' },
          { label: 'Maintenance', color: 'bg-red-200' },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1">
            <div className={`w-3 h-2 rounded-sm ${l.color}`} />
            <span className="text-gray-500">{l.label}</span>
          </div>
        ))}
      </div>

      {/* Gantt chart */}
      <div className="flex border border-gray-200 rounded-lg overflow-hidden bg-white" style={{ height: 'calc(100vh - 210px)' }}>
        {/* Left labels */}
        <div className="w-44 flex-shrink-0 border-r border-gray-200 bg-gray-50 z-10 overflow-y-auto">
          {/* Date header spacer */}
          <div className="h-10 border-b border-gray-200 px-3 flex items-center text-[10px] font-bold text-gray-400 uppercase">
            {view === 'job' ? 'Jobs' : 'Assets'}
          </div>

          {view === 'job' ? (
            /* Job labels */
            JOBS.map(job => (
              <div key={job.id}>
                {/* Job header */}
                <div className="h-8 border-b border-gray-200 px-3 flex items-center cursor-pointer hover:bg-gray-100" onClick={() => setSelected(job)}>
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-gray-900 truncate">{job.company}</div>
                    <div className="text-[9px] text-gray-400 truncate">{job.jobName} #{job.jobNum}</div>
                  </div>
                </div>
                {/* Item rows */}
                {job.items.map((item, i) => (
                  <div key={i} className="h-7 border-b border-gray-100 px-3 pl-6 flex items-center">
                    <span className="text-[10px] text-gray-500">{item.qty}× {catOf(item.cat)?.short}</span>
                  </div>
                ))}
              </div>
            ))
          ) : (
            /* Asset labels */
            filteredUnits.map(unit => {
              const maint = MAINT_BLOCKS.find(m => m.unitName === unit.name);
              return (
                <div key={unit.id} className="h-7 border-b border-gray-100 px-3 flex items-center justify-between">
                  <span className={`text-[10px] font-medium ${maint ? 'text-red-500' : 'text-gray-700'}`}>{unit.name}</span>
                  {maint && <span className="text-[8px] text-red-400 font-bold">🔧</span>}
                </div>
              );
            })
          )}
        </div>

        {/* Right: timeline */}
        <div className="flex-1 overflow-x-auto overflow-y-auto">
          {/* Date header */}
          <div className="flex h-10 border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
            {dates.map(ds => {
              const isToday = ds === today;
              const isWeekend = [0, 6].includes(new Date(ds + 'T12:00:00').getDay());
              return (
                <div key={ds} style={{ width: dayWidth, minWidth: dayWidth }}
                  className={`flex-shrink-0 flex items-center justify-center text-[10px] border-r border-gray-100 ${isToday ? 'bg-blue-50 font-bold text-blue-600' : isWeekend ? 'bg-gray-100/50 text-gray-400' : 'text-gray-500'}`}>
                  {fDay(ds)}
                </div>
              );
            })}
          </div>

          {/* Rows */}
          <div className="relative">
            {/* Today line */}
            {todayOffset >= 0 && todayOffset < totalDays && (
              <div className="absolute top-0 bottom-0 z-20 pointer-events-none" style={{ left: todayOffset * dayWidth + dayWidth / 2, width: 2, background: '#3b82f6' }}>
                <div className="absolute -top-0 -left-[3px] w-2 h-2 rounded-full bg-blue-500" />
              </div>
            )}

            {view === 'job' ? (
              /* ═══ JOB VIEW ═══ */
              JOBS.map(job => {
                const sc = STAGE_COLORS[job.stage] || STAGE_COLORS.inquiry;
                return (
                  <div key={job.id}>
                    {/* Job header row */}
                    <div className="relative h-8 border-b border-gray-200 bg-gray-50/50">
                      {/* Grid lines */}
                      <div className="absolute inset-0 flex">
                        {dates.map(ds => (
                          <div key={ds} style={{ width: dayWidth, minWidth: dayWidth }} className="flex-shrink-0 border-r border-gray-100/50" />
                        ))}
                      </div>
                      {/* Spanning bar for entire job */}
                      {(() => {
                        const jobStart = job.items.reduce((min, i) => i.start < min ? i.start : min, job.items[0].start);
                        const jobEnd = job.items.reduce((max, i) => i.end > max ? i.end : max, job.items[0].end);
                        const bar = getBarStyle(jobStart, jobEnd);
                        if (!bar) return null;
                        return (
                          <div className={`absolute top-1 h-6 rounded ${sc.bg} opacity-20 cursor-pointer`}
                            style={{ left: bar.left, width: bar.width }}
                            onClick={() => setSelected(job)} />
                        );
                      })()}
                    </div>
                    {/* Item rows */}
                    {job.items.map((item, i) => {
                      const bar = getBarStyle(item.start, item.end);
                      return (
                        <div key={i} className="relative h-7 border-b border-gray-100">
                          <div className="absolute inset-0 flex">
                            {dates.map(ds => (
                              <div key={ds} style={{ width: dayWidth, minWidth: dayWidth }}
                                className={`flex-shrink-0 border-r border-gray-100/50 ${[0, 6].includes(new Date(ds + 'T12:00:00').getDay()) ? 'bg-gray-50/50' : ''}`} />
                            ))}
                          </div>
                          {bar && (
                            <div className={`absolute top-1 h-5 rounded-md ${sc.bg} border ${sc.border} flex items-center px-1.5 cursor-pointer hover:opacity-90 transition-opacity`}
                              style={{ left: bar.left, width: bar.width }}
                              onClick={() => setSelected(job)}>
                              <span className={`text-[9px] font-bold ${sc.text} truncate`}>
                                {item.qty}× {catOf(item.cat)?.short} · {fMonth(item.start)}–{fMonth(item.end)}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            ) : (
              /* ═══ ASSET VIEW ═══ */
              filteredUnits.map(unit => {
                const assignments = unitAssignments[unit.id] || [];
                const maint = MAINT_BLOCKS.find(m => m.unitName === unit.name);
                return (
                  <div key={unit.id} className="relative h-7 border-b border-gray-100">
                    {/* Grid */}
                    <div className="absolute inset-0 flex">
                      {dates.map(ds => (
                        <div key={ds} style={{ width: dayWidth, minWidth: dayWidth }}
                          className={`flex-shrink-0 border-r border-gray-100/50 ${[0, 6].includes(new Date(ds + 'T12:00:00').getDay()) ? 'bg-gray-50/50' : ''}`} />
                      ))}
                    </div>
                    {/* Maintenance block */}
                    {maint && (() => {
                      const bar = getBarStyle(maint.start, maint.end);
                      if (!bar) return null;
                      return (
                        <div className="absolute top-1 h-5 rounded-md bg-red-200 border border-red-300 flex items-center px-1.5"
                          style={{ left: bar.left, width: bar.width }}>
                          <span className="text-[9px] font-bold text-red-700 truncate">🔧 {maint.issue}</span>
                        </div>
                      );
                    })()}
                    {/* Booking blocks */}
                    {assignments.map((a, i) => {
                      const bar = getBarStyle(a.item.start, a.item.end);
                      if (!bar) return null;
                      const sc = STAGE_COLORS[a.job.stage] || STAGE_COLORS.inquiry;
                      return (
                        <div key={i} className={`absolute top-1 h-5 rounded-md ${sc.bg} border ${sc.border} flex items-center px-1.5 cursor-pointer hover:opacity-90`}
                          style={{ left: bar.left, width: bar.width }}
                          onClick={() => setSelected(a.job)}>
                          <span className={`text-[9px] font-bold ${sc.text} truncate`}>
                            {a.job.company.split(' ')[0]} · {a.job.jobNum}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Job detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl w-[480px] max-w-[95vw] p-5 shadow-2xl border border-gray-200" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="text-[10px] text-gray-400 uppercase font-bold">#{selected.jobNum} · {selected.stage.toUpperCase()}</div>
                <h3 className="text-lg font-bold text-gray-900">{selected.company}</h3>
                <div className="text-[13px] text-gray-500">{selected.jobName}</div>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3 text-[11px]">
              <div><span className="text-gray-400">Contact: </span><span className="text-gray-700">{selected.contact}</span></div>
              <div><span className="text-gray-400">Agent: </span><span className="text-gray-700">{selected.agent}</span></div>
            </div>

            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Assets</div>
            {selected.items.map((item, i) => {
              const days = diffDays(item.start, item.end) + 1;
              return (
                <div key={i} className="flex justify-between py-2 border-b border-gray-100 last:border-0 text-[12px]">
                  <div>
                    <span className="font-semibold text-gray-900">{item.qty}× {catOf(item.cat)?.label}</span>
                    <span className="text-gray-400 ml-2">{fMonth(item.start)} – {fMonth(item.end)} ({days}d)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
