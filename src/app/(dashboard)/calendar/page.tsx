'use client';

import { useState, useMemo } from 'react';

// ═══ Helpers ═══
function toDS(d: Date): string {
  return d.toISOString().split('T')[0];
}
function addDays(ds: string, n: number): string {
  const d = new Date(ds + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return toDS(d);
}
function fDate(ds: string): string {
  return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
function getDaysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}
function getFirstDayOfMonth(y: number, m: number): number {
  return new Date(y, m, 1).getDay();
}

const today = toDS(new Date());

// ═══ Sample Data (will be replaced with API calls) ═══
type Booking = {
  id: string;
  cat: string;
  catShort: string;
  qty: number;
  cust: string;
  contact: string;
  job: string;
  agent: string;
  start: string;
  end: string;
  status: 'active' | 'confirmed' | 'pending' | 'cancelled';
  price: number;
};

type MaintRecord = {
  id: string;
  unit: string;
  title: string;
  start: string;
  end: string;
  vendor?: string;
};

const BOOKINGS: Booking[] = [
  { id: 'b1', cat: 'Cube Truck', catShort: 'Cube', qty: 6, cust: 'Cinepower & Light', contact: 'Terry Meadows', job: 'Commercial', agent: 'Jose', start: today, end: addDays(today, 3), status: 'active', price: 4200 },
  { id: 'b2', cat: 'Cube Truck', catShort: 'Cube', qty: 4, cust: 'Justin K Productions', contact: 'Justin K', job: 'Feature Film', agent: 'Oliver', start: addDays(today, 1), end: addDays(today, 6), status: 'confirmed', price: 4200 },
  { id: 'b3', cat: 'Cargo Van w/ LG', catShort: 'Cargo', qty: 5, cust: 'Nathan Israel Prod', contact: 'Nathan Israel', job: 'TV Series', agent: 'Jose', start: today, end: addDays(today, 4), status: 'active', price: 5000 },
  { id: 'b4', cat: 'PopVan', catShort: 'Pop', qty: 2, cust: 'Elli Legerski Prod', contact: 'Elli L', job: 'Branded Content', agent: 'Jose', start: today, end: addDays(today, 5), status: 'active', price: 4800 },
  { id: 'b5', cat: 'DLUX', catShort: 'DLUX', qty: 2, cust: 'Snow Story', contact: 'Jason Mayfield', job: 'Music Video', agent: 'Jose', start: addDays(today, 1), end: addDays(today, 4), status: 'confirmed', price: 3600 },
  { id: 'b6', cat: 'Passenger Van', catShort: 'Pass', qty: 3, cust: 'Nathalie SP Film', contact: 'Nathalie S', job: 'Short Film', agent: 'Oliver', start: addDays(today, 2), end: addDays(today, 3), status: 'confirmed', price: 1050 },
  { id: 'b7', cat: 'Camera Cube', catShort: 'Cam', qty: 2, cust: 'Maddie Harmon', contact: 'Maddie H', job: 'Documentary', agent: 'Dani', start: today, end: addDays(today, 4), status: 'active', price: 2000 },
  { id: 'b8', cat: 'Studios', catShort: 'Studio', qty: 2, cust: 'Fabletics', contact: 'Ella S', job: 'Spring Campaign', agent: 'Jose', start: addDays(today, 1), end: addDays(today, 3), status: 'confirmed', price: 18000 },
  { id: 'b9', cat: 'Cube Truck', catShort: 'Cube', qty: 3, cust: 'Alyssa Benedetto', contact: 'Alyssa B', job: 'Photo Shoot', agent: 'Jose', start: addDays(today, 4), end: addDays(today, 7), status: 'pending', price: 2100 },
  { id: 'b10', cat: 'Cube Truck', catShort: 'Cube', qty: 2, cust: 'Beth Schiffman', contact: 'Beth S', job: 'TV Pilot', agent: 'Jose', start: addDays(today, 5), end: addDays(today, 9), status: 'pending', price: 1750 },
];

const MAINT: MaintRecord[] = [
  { id: 'm1', unit: 'Cube #24(A)', title: 'Bad motor', start: '2024-01-01', end: '2026-04-01', vendor: 'High Tech' },
  { id: 'm2', unit: 'Cube #8', title: 'Transmission', start: addDays(today, -2), end: addDays(today, 5), vendor: 'High Tech' },
  { id: 'm3', unit: 'Cube #15', title: 'Oil/Reverse', start: addDays(today, -5), end: addDays(today, 15) },
  { id: 'm4', unit: 'Sprinter #2', title: 'Engine inspect', start: today, end: addDays(today, 6) },
  { id: 'm5', unit: 'SC #38', title: 'Check engine', start: addDays(today, 1), end: addDays(today, 8) },
  { id: 'm6', unit: 'Nissan #1', title: 'Motor mounts', start: addDays(today, -3), end: addDays(today, 4), vendor: 'Dealer' },
  { id: 'm7', unit: 'Pop #3', title: 'Transmission', start: '2025-03-20', end: '2026-04-01' },
  { id: 'm8', unit: 'Pop #1', title: 'Interior lights', start: today, end: addDays(today, 4) },
  { id: 'm9', unit: 'Cube #9', title: 'Battery', start: addDays(today, 1), end: addDays(today, 7) },
];

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-500/20 border-l-emerald-400 text-emerald-300',
  confirmed: 'bg-blue-500/15 border-l-blue-400 text-blue-300',
  pending: 'bg-amber-500/15 border-l-amber-400 text-amber-300',
  cancelled: 'bg-neutral-500/15 border-l-neutral-500 text-neutral-400',
};

// ═══ Calendar Page ═══
export default function CalendarPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [selected, setSelected] = useState<Booking | null>(null);

  const monthName = new Date(year, month).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  // Build calendar data
  const calData = useMemo(() => {
    const dim = getDaysInMonth(year, month);
    const map: Record<string, { bookings: Booking[]; maint: MaintRecord[] }> =
      {};
    for (let d = 1; d <= dim; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      map[ds] = {
        bookings: BOOKINGS.filter(
          (b) => b.start <= ds && b.end >= ds && b.status !== 'cancelled'
        ),
        maint: MAINT.filter(
          (m) => m.start <= ds && (m.end || '2099-01-01') >= ds
        ),
      };
    }
    return map;
  }, [year, month]);

  function prevMonth() {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  function goToday() {
    setYear(new Date().getFullYear());
    setMonth(new Date().getMonth());
  }

  const firstDay = getFirstDayOfMonth(year, month);
  const daysInMonth = getDaysInMonth(year, month);

  return (
    <div>
      {/* Calendar header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="btn-secondary px-2.5 py-1.5 text-sm"
          >
            ◀
          </button>
          <h1 className="text-lg font-bold text-white min-w-[180px] text-center">
            {monthName}
          </h1>
          <button
            onClick={nextMonth}
            className="btn-secondary px-2.5 py-1.5 text-sm"
          >
            ▶
          </button>
          <button
            onClick={goToday}
            className="btn-secondary text-[11px] font-semibold"
          >
            Today
          </button>
        </div>

        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-sirreel-text-muted">Active</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            <span className="text-sirreel-text-muted">Confirmed</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-sirreel-text-muted">Pending</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-sirreel-text-muted">Maint</span>
          </span>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-px mb-px">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div
            key={d}
            className="py-1.5 text-center text-[10px] font-bold text-sirreel-text-dim uppercase tracking-wider"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px">
        {/* Empty cells before first day */}
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`e${i}`} className="min-h-[100px] bg-[#0b0b0b] rounded" />
        ))}

        {/* Day cells */}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const data = calData[ds] || { bookings: [], maint: [] };
          const isToday = ds === today;
          const isWeekend =
            new Date(ds + 'T12:00:00').getDay() === 0 ||
            new Date(ds + 'T12:00:00').getDay() === 6;

          return (
            <div
              key={day}
              className={`min-h-[100px] p-1 rounded transition-colors overflow-hidden ${
                isToday
                  ? 'bg-white/5 ring-1 ring-white/20'
                  : isWeekend
                    ? 'bg-[#0a0a0a]'
                    : 'bg-[#0c0c0c]'
              } hover:bg-[#141414]`}
            >
              {/* Day number */}
              <div
                className={`text-[11px] mb-0.5 ${
                  isToday
                    ? 'font-extrabold text-white'
                    : 'font-medium text-sirreel-text-dim'
                }`}
              >
                {isToday ? (
                  <span className="bg-white text-black px-1.5 py-0.5 rounded-full text-[10px] font-bold">
                    {day}
                  </span>
                ) : (
                  day
                )}
              </div>

              {/* Maintenance */}
              {data.maint.slice(0, 1).map((m) => (
                <div
                  key={m.id}
                  className="text-[8px] px-1 py-0.5 mb-0.5 rounded bg-red-500/10 text-red-400 font-semibold truncate"
                >
                  🔧 {m.unit}
                </div>
              ))}

              {/* Bookings */}
              {data.bookings.slice(0, 3).map((b) => (
                <button
                  key={b.id}
                  onClick={() => setSelected(b)}
                  className={`w-full text-left text-[8px] px-1 py-0.5 mb-0.5 rounded border-l-2 font-semibold truncate transition-all hover:brightness-125 ${STATUS_COLORS[b.status]}`}
                >
                  {b.qty}× {b.catShort} {b.cust.split(' ')[0]}
                </button>
              ))}

              {data.bookings.length > 3 && (
                <div className="text-[8px] text-sirreel-text-dim pl-1">
                  +{data.bookings.length - 3} more
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Booking Detail Modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-[#141414] border border-sirreel-border-hover rounded-2xl w-[420px] max-w-[95vw] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold text-white">
                  {selected.cust}
                </h3>
                <p className="text-[12px] text-sirreel-text-muted mt-0.5">
                  {selected.cat} · {selected.qty} units
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-sirreel-text-muted hover:text-white transition-colors text-sm"
              >
                ✕
              </button>
            </div>

            {/* Status badge */}
            <div className="mb-4">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${STATUS_COLORS[selected.status]}`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    selected.status === 'active'
                      ? 'bg-emerald-400'
                      : selected.status === 'confirmed'
                        ? 'bg-blue-400'
                        : 'bg-amber-400'
                  }`}
                />
                {selected.status}
              </span>
            </div>

            {/* Details grid */}
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Job', selected.job],
                ['Contact', selected.contact],
                ['Agent', selected.agent],
                ['Dates', `${fDate(selected.start)} — ${fDate(selected.end)}`],
                ['Rate', `$${Math.round(selected.price / selected.qty / (Math.max(1, Math.round((new Date(selected.end + 'T12:00:00').getTime() - new Date(selected.start + 'T12:00:00').getTime()) / 86400000)) + 1))}/day`],
                ['Total', `$${selected.price.toLocaleString()}`],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="label">{label}</div>
                  <div className="text-[13px] text-sirreel-text mt-0.5">
                    {value}
                  </div>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-2 mt-5">
              <button className="btn-secondary flex-1 text-[11px]">
                Edit Booking
              </button>
              <button className="btn-primary flex-1 text-[11px]">
                Open in Bookings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
