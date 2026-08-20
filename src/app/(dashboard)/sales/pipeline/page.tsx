'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { NewInboundColumn } from '@/components/sales/NewInboundColumn';
import { NewInquiryModal } from '@/components/sales/NewInquiryModal';
import { OpenQuotesKanban } from '@/components/sales/OpenQuotesKanban';
import { ActiveJobsKanban } from '@/components/sales/ActiveJobsKanban';
import { SalesReservationsWidget } from '@/components/sales/SalesReservationsWidget';
import { ProspectsSection } from '@/components/sales/ProspectsSection';
import { OpenQuotesPanel } from '@/components/sales/OpenQuotesPanel';
import { SalesSignalsStrip } from '@/components/sales/SalesSignalsStrip';
import { FollowUpsDuePanel } from '@/components/sales/FollowUpsDuePanel';
import { CopyIntakeLinkButton } from '@/components/intake/CopyIntakeLinkButton';
import type { LineItemDepartment } from '@prisma/client';
import type { PipelineColumn } from '@/lib/sales/pipeline';

interface PipelineJob {
  id: string;
  jobCode: string;
  name: string;
  status: 'QUOTED' | 'ACTIVE' | 'WRAPPED' | 'HOLD' | 'LOST';
  startDate: string | null;
  endDate: string | null;
  estimatedValue: number | null;
  orderTotal: number;
  updatedAt: string;
  company: { id: string; name: string };
  agent: { id: string; name: string };
  pipelineColumn?: PipelineColumn | null;
  quoteBreakdown?: {
    quotes: number;
    won: number;
    pending: number;
    lost: number;
    expired: number;
  };
  departments?: LineItemDepartment[];
}

export default function PipelinePage() {
  const { data: session, status: authStatus } = useSession();
  const user = session?.user as { role?: string } | undefined;
  const role = user?.role;

  // AGENT defaults to My Deals; everyone else (including unknown role) defaults to Team.
  const defaultScope: 'my' | 'team' = role === 'AGENT' ? 'my' : 'team';
  const [scope, setScope] = useState<'my' | 'team'>(defaultScope);
  const [jobs, setJobs] = useState<PipelineJob[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  // Phase 6.5b — manual-entry modal moved up from /inquiries to here
  // so the Pipeline header carries the "+ Inquiry" affordance.
  const [showNewInquiry, setShowNewInquiry] = useState(false);
  // Funnel-mouth badge (Wes, 2026-08-20): Pipeline shows worked deals, and
  // the raw asks live one surface upstream on /inquiries — invisible from
  // here. Surface the count of NEW inquiries so an agent standing in
  // Pipeline can see the intake backlog without checking the other tab.
  // Null = not loaded; badge renders only when > 0.
  const [newInquiryCount, setNewInquiryCount] = useState<number | null>(null);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    setScope(role === 'AGENT' ? 'my' : 'team');
  }, [authStatus, role]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    setLoading(true);
    const params = new URLSearchParams({
      statuses: 'QUOTED,ACTIVE,WRAPPED',
      include: 'quoteStatus,departments',
    });
    if (scope === 'my') params.set('mine', '1');
    fetch(`/api/jobs?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs || []))
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }, [scope, authStatus, refreshKey]);

  const refreshAll = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    // Same endpoint the Inquiries queue reads; NEW is its default filter.
    fetch('/api/inquiries?status=NEW')
      .then((r) => r.json())
      .then((d) => setNewInquiryCount(Array.isArray(d.inquiries) ? d.inquiries.length : null))
      .catch(() => setNewInquiryCount(null));
  }, [authStatus, refreshKey]);

  if (authStatus === 'loading') {
    return <div className="min-h-[60vh] flex items-center justify-center text-zinc-500 text-sm">Loading…</div>;
  }

  // Open Quotes = Jobs with at least one Order. Cards land in DRAFT/SENT/WON/LOST
  // columns per the earliest-unfinished-state rule (computed server-side as
  // pipelineColumn).
  const openQuoteJobs = (jobs || []).filter(
    (j) => j.pipelineColumn != null && j.status === 'QUOTED'
  );
  // Active Jobs = Jobs that are in production (ACTIVE) or have wrapped.
  const activeJobs = (jobs || []).filter(
    (j) => j.status === 'ACTIVE' || j.status === 'WRAPPED'
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Sales Pipeline</h1>
          <p className="text-xs text-gray-500 mt-1">
            Inquiries → Open Quotes → Active Jobs. Click any card to open the job.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {newInquiryCount != null && newInquiryCount > 0 && (
            <a
              href="/inquiries"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
              title="Untriaged submissions waiting on the Inquiries queue"
            >
              {newInquiryCount} new inquir{newInquiryCount === 1 ? 'y' : 'ies'} →
            </a>
          )}
          <CopyIntakeLinkButton />
          <button
            onClick={() => setShowNewInquiry(true)}
            className="text-xs font-semibold bg-gray-900 hover:bg-gray-800 text-white px-3 py-1.5 rounded-lg"
          >
            + Inquiry
          </button>
          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
            <ScopeButton active={scope === 'my'} onClick={() => setScope('my')}>My Deals</ScopeButton>
            <ScopeButton active={scope === 'team'} onClick={() => setScope('team')}>Team View</ScopeButton>
          </div>
        </div>
      </div>

      {/* New inbound is the most time-sensitive — surfaced first. */}
      <NewInboundColumn onChange={refreshAll} />

      {/* Open Quotes — every quote sent to a client but not yet booked, with
          amount + age, stalest first (most at-risk money on top). */}
      <OpenQuotesPanel scope={scope} />

      <SalesSignalsStrip scope={scope} onChange={refreshAll} />

      <FollowUpsDuePanel scope={scope} />

      <SalesReservationsWidget />

      <OpenQuotesKanban
        jobs={openQuoteJobs.map((j) => ({
          id: j.id,
          jobCode: j.jobCode,
          name: j.name,
          estimatedValue: j.estimatedValue,
          orderTotal: j.orderTotal,
          updatedAt: j.updatedAt,
          company: j.company,
          agent: j.agent,
          pipelineColumn: j.pipelineColumn ?? null,
          quoteBreakdown: j.quoteBreakdown,
          departments: j.departments,
        }))}
        loading={loading}
        onChange={refreshAll}
      />

      <ActiveJobsKanban
        jobs={activeJobs.map((j) => ({
          id: j.id,
          jobCode: j.jobCode,
          name: j.name,
          status: j.status,
          startDate: j.startDate,
          endDate: j.endDate,
          estimatedValue: j.estimatedValue,
          orderTotal: j.orderTotal,
          company: j.company,
          agent: j.agent,
        }))}
        loading={loading}
      />

      <ProspectsSection />

      {/* Phase 6.5b — manual inquiry entry from the Pipeline header.
          Replaces the standalone /inquiries tab's New button. On
          create, refresh the whole page so the new card appears in
          the New inbound column. */}
      <NewInquiryModal
        open={showNewInquiry}
        onClose={() => setShowNewInquiry(false)}
        onCreated={() => {
          setShowNewInquiry(false);
          refreshAll();
        }}
      />
    </div>
  );
}

function ScopeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
        active ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}
