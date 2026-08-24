'use client';

/**
 * Inquiries — THE sales workspace (2026-08-21 redesign, Wes).
 *
 * One page for the whole daily loop, replacing the old two-tab split
 * where /inquiries was a read-only table and /sales/pipeline carried
 * the same rows again with the real actions plus six more sections
 * (two structurally-broken kanbans, a dead Prospects placeholder, and
 * a SENT quote rendered four different ways). /sales/pipeline now
 * redirects here.
 *
 * Shape:
 *   1. New inbound  — live queue (web forms + Gmail suggestions),
 *      pending vs responded, with Capture & Quote / Add-on / Quick
 *      Reply / Dismiss inline. 60s poll. (NewInboundColumn — the
 *      machinery that already worked; only its home changed.)
 *   2. Quotes out   — the ONE "sent, waiting" list, nudge attached.
 *   3. Upcoming reservations + signals — glanceable context.
 *
 * Won work lives on the Jobs board (/jobs) — linked, not duplicated.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { NewInboundColumn } from '@/components/sales/NewInboundColumn';
import { QuotesOutPanel } from '@/components/sales/QuotesOutPanel';
import { SalesReservationsWidget } from '@/components/sales/SalesReservationsWidget';
import { SalesSignalsStrip } from '@/components/sales/SalesSignalsStrip';
import { CopyIntakeLinkButton } from '@/components/intake/CopyIntakeLinkButton';

export default function InquiriesPage() {
  const { data: session, status: authStatus } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  // AGENT defaults to My Deals; everyone else to Team.
  const [scope, setScope] = useState<'my' | 'team'>('team');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    setScope(role === 'AGENT' ? 'my' : 'team');
  }, [authStatus, role]);

  const refreshAll = () => setRefreshKey((k) => k + 1);

  if (authStatus === 'loading') {
    return <div className="min-h-[60vh] flex items-center justify-center text-gray-400 text-sm">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Inquiries</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            Every ask, in one place: answer it, quote it, nudge it. Won work moves to the{' '}
            <Link href="/jobs" className="text-amber-700 font-semibold hover:underline">Jobs board →</Link>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* "+ Inquiry" removed (Wes 2026-08-24): 6 manual inquiries ever,
              4 of them tests, all dismissed, zero converted. The queue's real
              intake is automatic (Gmail + web forms); creation is "+ New Job"
              in the global header — one button, lands on the job. A phone
              lead worth tracking goes through the intake link instead. */}
          <CopyIntakeLinkButton />
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[12px] font-semibold">
            <button
              onClick={() => setScope('my')}
              className={scope === 'my' ? 'px-3 py-1.5 bg-gray-900 text-white' : 'px-3 py-1.5 bg-white text-gray-500 hover:bg-gray-50'}
            >
              My Deals
            </button>
            <button
              onClick={() => setScope('team')}
              className={scope === 'team' ? 'px-3 py-1.5 bg-gray-900 text-white' : 'px-3 py-1.5 bg-white text-gray-500 hover:bg-gray-50'}
            >
              Team View
            </button>
          </div>
        </div>
      </div>

      {/* Two-column workspace (Wes, 2026-08-22): NEW INBOUND lives in the
          RIGHT column; Quotes out + Upcoming reservations stack in the
          LEFT column. DOM order keeps the live inbound queue FIRST so
          single-column (mobile) still leads with it; lg:order-* swaps the
          visual sides on desktop. items-start stops the left stack from
          stretching to the inbound column's height. */}
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <div className="lg:order-2">
          <NewInboundColumn onChange={refreshAll} />
        </div>
        <div className="lg:order-1 space-y-4">
          <QuotesOutPanel scope={scope} refreshKey={refreshKey} />
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <SalesReservationsWidget />
          </div>
        </div>
      </div>

      {/* Signals — stale quotes / pending COIs / dormant clients */}
      <SalesSignalsStrip scope={scope} onChange={refreshAll} />

    </div>
  );
}
