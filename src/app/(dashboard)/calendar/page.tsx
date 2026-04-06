'use client';

import { useState, useMemo, useEffect } from 'react';

// ═══ Helpers ═══
function toDS(d: Date): string { return d.toISOString().split('T')[0]; }
function addDays(ds: string, n: number): string { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return toDS(d); }
function fDate(ds: string): string { return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function fDateLong(ds: string): string { return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function getDaysInMonth(y: number, m: number): number { return new Date(y, m + 1, 0).getDate(); }
function getFirstDayOfMonth(y: number, m: number): number { return new Date(y, m, 1).getDay(); }
function diffDays(a: string, b: string): number { return Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000); }
const today = toDS(new Date());

// ═══ Data ═══
const CATS: Record<string, string> = { cube: 'Cube', cargo: 'Cargo', pass: 'Pass', pop: 'Pop', cam: 'Cam', dlux: 'DLUX', scout: 'Scout', studio: 'Studio', stakebed: 'Stake' };

type JobItem = { cat: string; qty: number; start: string; end: string };
type Job = {
  id: string; company: string; jobName: string; jobNum: string;
  contact: string; agent: string; stage: string;
  items: JobItem[];
};

const JOBS: Job[] = [
  { id: 'j1', company: 'Cinepower & Light', jobName: 'Spring Auto Campaign', jobNum: 'CP-041', contact: 'Terry Meadows', agent: 'Jose', stage: 'active', items: [{ cat: 'cube', qty: 6, start: today, end: addDays(today, 3) }] },
  { id: 'j2', company: 'Justin K Prod', jobName: 'Midnight Run 2', jobNum: 'JKP-018', contact: 'Justin Kappenstein', agent: 'Oliver', stage: 'booked', items: [{ cat: 'cube', qty: 4, start: addDays(today, 1), end: addDays(today, 6) }] },
  { id: 'j3', company: 'Nathan Israel Prod', jobName: 'Lights Out S3', jobNum: 'NI-064', contact: 'Nathan Israel', agent: 'Jose', stage: 'active', items: [{ cat: 'cargo', qty: 5, start: today, end: addDays(today, 4) }] },
  { id: 'j4', company: 'Elli Legerski Prod', jobName: 'Nike Branded', jobNum: 'EL-038', contact: 'Elli Legerski', agent: 'Jose', stage: 'active', items: [{ cat: 'pop', qty: 2, start: today, end: addDays(today, 5) }] },
  { id: 'j5', company: 'Snow Story', jobName: 'Cold Front MV', jobNum: 'SS-005', contact: 'Jason Mayfield', agent: 'Jose', stage: 'booked', items: [{ cat: 'dlux', qty: 2, start: addDays(today, 1), end: addDays(today, 4) }, { cat: 'cube', qty: 3, start: addDays(today, 1), end: addDays(today, 4) }] },
  { id: 'j6', company: 'Fabletics', jobName: 'Spring Campaign', jobNum: 'FAB-001', contact: 'Ella Swanstrom', agent: 'Jose', stage: 'booked', items: [{ cat: 'studio', qty: 2, start: addDays(today, 1), end: addDays(today, 3) }] },
  { id: 'j7', company: 'Beth Schiffman Prod', jobName: 'Greystone Pilot', jobNum: 'BS-013', contact: 'Beth Schiffman', agent: 'Jose', stage: 'hold', items: [{ cat: 'cube', qty: 5, start: addDays(today, 3), end: addDays(today, 8) }, { cat: 'cargo', qty: 3, start: addDays(today, 3), end: addDays(today, 8) }] },
  { id: 'j8', company: 'Paramount', jobName: 'Untitled Drama', jobNum: 'PAR-007', contact: 'Stephen Predisik', agent: 'Oliver', stage: 'hold', items: [{ cat: 'cargo', qty: 4, start: addDays(today, 2), end: addDays(today, 5) }] },
  { id: 'j9', company: 'AJR Films', jobName: 'Megan Thee Stallion MV', jobNum: 'AJR-050', contact: 'Brandon McClover', agent: 'Jose', stage: 'inquiry', items: [{ cat: 'cube', qty: 8, start: addDays(today, 5), end: addDays(today, 12) }] },
  { id: 'j10', company: 'Alyssa Benedetto Prod', jobName: 'Revolve Shoot', jobNum: 'AB-025', contact: 'Alyssa Benedetto', agent: 'Jose', stage: 'quoted', items: [{ cat: 'cube', qty: 3, start: addDays(today, 4), end: addDays(today, 7) }] },
];

type MaintRecord = { id: string; unit: string; issue: string; start: string; end: string };
const MAINT: MaintRecord[] = [
  { id: 'mt1', unit: 'Cube #24(A)', issue: 'Bad motor', start: addDays(today, -12), end: addDays(today, 5) },
  { id: 'mt2', unit: 'Cube #8', issue: 'Transmission', start: addDays(today, -8), end: addDays(today, 7) },
  { id: 'mt3', unit: 'SC #36', issue: 'Roof damage', start: addDays(today, -6), end: addDays(today, 14) },
  { id: 'mt4', unit: 'Pop #3', issue: 'Trans (parts)', start: addDays(today, -21), end: addDays(today, 14) },
];

const STAGE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  active: { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200' },
  booked: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-200' },
  hold: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200' },
  quoted: { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-200' },
  inquiry: { bg: 'bg-sky-100', text: 'text-sky-800', border: 'border-sky-200' },
};

// ═══ Component ═══
export default function CalendarPage() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [JOBS, setJOBS] = useState<Job[]>([]);

  useEffect(() => {
    fetch('/api/timeline')
      .then(r => r.json())
      .then(d => {
        if (!d.ok) return
        const jobs: Job[] = (d.jobs || []).map((j: any) => ({
          id: j.id || j.cartId,
          company: j.company || 'Unknown',
          jobName: j.jobName || '',
          jobNum: j.rwOrderNumber ? '#' + j.rwOrderNumber : j.jobNum || '',
          contact: j.contact || '',
          agent: j.agent || '',
          stage: j.status || 'booked',
          items: (j.items || []).map((item: any) => ({
            cat: item.cat || 'cube',
            qty: item.qty || 1,
            start: item.start || today,
            end: item.end || today,
          })),
        }))
        setJOBS(jobs)
      })
      .catch(() => {})
  }, [])

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const monthLabel = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  function prevMonth() { setCurrentDate(new Date(year, month - 1, 1)); }
  function nextMonth() { setCurrentDate(new Date(year, month + 1, 1)); }
  function goToday() { setCurrentDate(new Date()); }

  // Jobs active on each day
  const jobsByDay = useMemo(() => {
    const map: Record<number, { job: Job; items: JobItem[] }[]> = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const active: { job: Job; items: JobItem[] }[] = [];
      JOBS.forEach(job => {
        const matchingItems = job.items.filter(item => item.start <= ds && item.end >= ds);
        if (matchingItems.length > 0) active.push({ job, items: matchingItems });
      });
      map[d] = active;
    }
    return map;
  }, [year, month, daysInMonth]);

  const maintByDay = useMemo(() => {
    const map: Record<number, MaintRecord[]> = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      map[d] = MAINT.filter(m => m.start <= ds && m.end >= ds);
    }
    return map;
  }, [year, month, daysInMonth]);

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-gray-900">{monthLabel}</h1>
          <div className="flex gap-1">
            <button onClick={prevMonth} className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 text-[13px] hover:bg-gray-200">‹</button>
            <button onClick={goToday} className="px-2 h-7 rounded-lg bg-gray-100 text-[11px] font-semibold text-gray-600 hover:bg-gray-200">Today</button>
            <button onClick={nextMonth} className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 text-[13px] hover:bg-gray-200">›</button>
          </div>
        </div>
        <div className="flex gap-3 text-[10px] text-gray-400">
          <span>🟢 Active</span>
          <span>🔵 Booked</span>
          <span>🟡 Hold</span>
          <span>🟣 Quoted</span>
          <span>🔴 Maintenance</span>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-gray-200">
          {days.map(d => (
            <div key={d} className="py-2 text-center text-[11px] font-bold text-gray-400 bg-gray-50">{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {/* Empty cells before first day */}
          {Array.from({ length: firstDay }, (_, i) => (
            <div key={`e${i}`} className="min-h-[110px] bg-gray-50/50 border-b border-r border-gray-100" />
          ))}

          {/* Day cells */}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const d = i + 1;
            const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isToday = ds === today;
            const isWeekend = [0, 6].includes(new Date(ds + 'T12:00:00').getDay());
            const dayJobs = jobsByDay[d] || [];
            const dayMaint = maintByDay[d] || [];

            return (
              <div key={d} className={`min-h-[110px] border-b border-r border-gray-100 p-1 ${isWeekend ? 'bg-gray-50/50' : 'bg-white'} hover:bg-blue-50/30 transition-colors`}>
                {/* Date number */}
                <div className="flex items-center justify-between mb-0.5">
                  <span className={`text-[12px] font-semibold ${isToday ? 'bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center' : 'text-gray-700 px-0.5'}`}>
                    {d}
                  </span>
                  {dayMaint.length > 0 && <span className="text-[9px] text-red-400">🔧{dayMaint.length}</span>}
                </div>

                {/* Job pills */}
                <div className="space-y-0.5">
                  {dayJobs.slice(0, 4).map(({ job, items }) => {
                    const st = STAGE_STYLES[job.stage] || STAGE_STYLES.inquiry;
                    const assetSummary = items.map(i => `${i.qty}${CATS[i.cat] || i.cat}`).join('+');
                    return (
                      <div key={job.id} onClick={() => setSelectedJob(job)}
                        className={`px-1.5 py-0.5 rounded-md text-[9px] font-medium cursor-pointer truncate border ${st.bg} ${st.text} ${st.border} hover:opacity-80`}>
                        <span className="font-bold truncate max-w-[80px] inline-block">{job.company}</span>
                        <span className="opacity-60"> {assetSummary}</span>
                      </div>
                    );
                  })}
                  {dayJobs.length > 4 && <div className="text-[9px] text-gray-400 pl-1">+{dayJobs.length - 4} more</div>}

                  {/* Maintenance pills */}
                  {dayMaint.slice(0, 2).map(m => (
                    <div key={m.id} className="px-1.5 py-0.5 rounded-md text-[9px] font-medium bg-red-50 text-red-600 border border-red-200 truncate">
                      🔧 {m.unit}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Job detail modal */}
      {selectedJob && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center" onClick={() => setSelectedJob(null)}>
          <div className="bg-white rounded-2xl w-[480px] max-w-[95vw] p-5 shadow-2xl border border-gray-200" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${(STAGE_STYLES[selectedJob.stage] || STAGE_STYLES.inquiry).bg} ${(STAGE_STYLES[selectedJob.stage] || STAGE_STYLES.inquiry).text}`}>
                    {selectedJob.stage}
                  </span>
                  <span className="text-[10px] text-gray-400">#{selectedJob.jobNum}</span>
                </div>
                <h3 className="text-lg font-bold text-gray-900">{selectedJob.company}</h3>
                <div className="text-[13px] text-gray-500">{selectedJob.jobName}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { router.push('/jobs/' + (selectedJob.id || '')); setSelectedJob(null); }}
                  className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-[11px] font-semibold hover:bg-gray-800">
                  Open Job →
                </button>
                <button onClick={() => setSelectedJob(null)} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3 text-[11px]">
              <div><span className="text-gray-400">Contact: </span><span className="text-gray-700">{selectedJob.contact}</span></div>
              <div><span className="text-gray-400">Agent: </span><span className="text-gray-700">{selectedJob.agent}</span></div>
            </div>

            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Assets</div>
            <div className="space-y-2">
              {selectedJob.items.map((item, i) => {
                const days = diffDays(item.start, item.end) + 1;
                return (
                  <div key={i} className="p-2.5 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex justify-between">
                      <span className="text-[13px] font-bold text-gray-900">{item.qty}× {CATS[item.cat] || item.cat}</span>
                      <span className="text-[11px] text-gray-500">{days} days</span>
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      {fDateLong(item.start)} → {fDateLong(item.end)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
