"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { isHighRiskEmailDomain } from "@/lib/email/emailDomain";
import type { ClientBadge } from "@/lib/crm/clientBadges";
import { CaptureReviewWidget } from "@/components/crm/CaptureReviewWidget";
import { OutreachQuickLogModal } from "@/components/crm/OutreachQuickLogModal";

type Company = {
  id: string; name: string; tier: string; totalSpend: string; totalBookings: number;
  billingEmail: string | null; coiOnFile: boolean; coiExpiry: string | null;
  updatedAt: string;
  _count: { orders: number };
  affiliations: { person: { id: string; firstName: string; lastName: string; role: string; email: string; phone: string | null } }[];
  // Server-derived (21d149c). Per-row badge facts.
  badges?: ClientBadge[];
  loyalSinceYear?: number | null;
};

type PersonResult = {
  id: string; firstName: string; lastName: string; email: string; phone: string | null;
  role: string; tier: string; totalSpend: string; totalBookings: number;
  affiliations: { company: { id: string; name: string }; isCurrent: boolean }[];
  // Server-derived (21d149c). Combines primary-company inheritance
  // (value badges + NEGOTIATES + QUIET) with the person's own
  // FOLLOW_UP_DUE flag.
  badges?: ClientBadge[];
  primaryCompanyBadgeFacts?: { loyalSinceYear: number | null } | null;
};

// Client badge palette — light-tokens mapped to the spec's intent.
// TOP_CLIENT keeps gold/amber. NEGOTIATES is coral (returning-today
// cadence token) so it no longer reads as just-another-gold-badge.
const BADGE_TONE: Record<ClientBadge, string> = {
  TOP_CLIENT:    'bg-chip-warn-bg text-chip-warn-fg',
  REPEAT:        'bg-chip-good-bg text-chip-good-fg',
  LOYAL:         'bg-cadence-invoiced-bg text-cadence-invoiced-fg',
  NEW:           'bg-cadence-booked-bg text-cadence-booked-fg',
  NEGOTIATES:    'bg-cadence-returning-today-bg text-cadence-returning-today-fg',
  FOLLOW_UP_DUE: 'bg-chip-bad-bg text-chip-bad-fg',
  QUIET:         'bg-chip-neutral-bg text-chip-neutral-fg',
};

// Inline Tabler-style icons — kept tiny + currentColor so they ride
// the same `text-*` token as the surrounding badge. We inline rather
// than pull a library: only seven shapes, never updated, no need to
// ship a runtime dep just for this strip + chip set.
const ICON_PROPS = {
  width: 12,
  height: 12,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function StarIcon() { // ti-star
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 17.75 5.83 21l1.18-6.88L2 9.24l6.91-1L12 2l3.09 6.24 6.91 1-5.01 4.88L18.18 21z" />
    </svg>
  );
}
function RepeatIcon() { // ti-repeat
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 12V9a3 3 0 0 1 3-3h13" />
      <path d="m17 3 3 3-3 3" />
      <path d="M20 12v3a3 3 0 0 1-3 3H4" />
      <path d="m7 21-3-3 3-3" />
    </svg>
  );
}
function HourglassIcon() { // ti-hourglass — LOYAL
  return (
    <svg {...ICON_PROPS}>
      <path d="M6.5 7h11" />
      <path d="M6.5 17h11" />
      <path d="M6 3h12v3a6 6 0 0 1-3 5.2v1.6A6 6 0 0 1 18 18v3H6v-3a6 6 0 0 1 3-5.2v-1.6A6 6 0 0 1 6 6z" />
    </svg>
  );
}
function SparklesIcon() { // ti-sparkles — NEW
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </svg>
  );
}
function DiscountIcon() { // ti-discount — NEGOTIATES
  return (
    <svg {...ICON_PROPS}>
      <path d="m9 15 6-6" />
      <circle cx="9.5" cy="9.5" r="1.2" />
      <circle cx="14.5" cy="14.5" r="1.2" />
      <path d="M5 7.5 7.5 5h9L19 7.5v9L16.5 19h-9L5 16.5z" />
    </svg>
  );
}
function BellIcon() { // ti-bell — FOLLOW_UP_DUE
  return (
    <svg {...ICON_PROPS}>
      <path d="M10 5a2 2 0 0 1 4 0" />
      <path d="M17 16h2l-2-3v-3a5 5 0 0 0-10 0v3l-2 3h2" />
      <path d="M9 17a3 3 0 0 0 6 0" />
    </svg>
  );
}
function ZzzIcon() { // ti-zzz — QUIET
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 7h6L4 17h6" />
      <path d="M14 4h6l-6 8h6" />
      <path d="M16 14h4l-4 6h4" />
    </svg>
  );
}

function BadgeIcon({ badge }: { badge: ClientBadge }) {
  switch (badge) {
    case 'TOP_CLIENT':    return <StarIcon />;
    case 'REPEAT':        return <RepeatIcon />;
    case 'LOYAL':         return <HourglassIcon />;
    case 'NEW':           return <SparklesIcon />;
    case 'NEGOTIATES':    return <DiscountIcon />;
    case 'FOLLOW_UP_DUE': return <BellIcon />;
    case 'QUIET':         return <ZzzIcon />;
  }
}

function badgeLabel(b: ClientBadge, loyalSinceYear: number | null | undefined): string {
  switch (b) {
    case 'TOP_CLIENT':    return 'Top client';
    case 'REPEAT':        return 'Repeat';
    case 'LOYAL':         return `Loyal\u2009\u00b7\u2009since ${loyalSinceYear ?? '?'}`;
    case 'NEW':           return 'New';
    case 'NEGOTIATES':    return 'Negotiates';
    case 'FOLLOW_UP_DUE': return 'Follow-up due';
    case 'QUIET':         return 'Quiet';
  }
}

function ClientBadgeChips({
  badges,
  loyalSinceYear,
}: {
  badges: ClientBadge[] | undefined;
  loyalSinceYear?: number | null;
}) {
  if (!badges || badges.length === 0) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap mt-1">
      {badges.map((b) => (
        <span
          key={b}
          className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${BADGE_TONE[b]}`}
        >
          <BadgeIcon badge={b} />
          {badgeLabel(b, loyalSinceYear)}
        </span>
      ))}
    </div>
  );
}

type FollowUp = {
  id: string; type: string; subject: string | null; body: string; dueDate: string | null;
  completed: boolean; createdAt: string;
  agent: { id: string; name: string };
  company: { id: string; name: string } | null;
  person: { id: string; firstName: string; lastName: string } | null;
};

const TIER_STYLES: Record<string, string> = {
  VIP: "bg-chip-warn-bg text-chip-warn-fg",
  PREFERRED: "bg-cadence-booked-bg text-cadence-booked-fg",
  STANDARD: "bg-chip-neutral-bg text-chip-neutral-fg",
  NEW: "bg-chip-good-bg text-chip-good-fg",
};

const fmt = (n: string | number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n));

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

export default function CRMPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  // "Select-for-quote" mode — driven by /new-quote linking here when the
  // AI couldn't extract a company. Force the Companies tab, swap row
  // clicks from "open detail" to "select and bounce back", and surface
  // an explicit Select button so the action is obvious.
  const selectForQuote = searchParams?.get('selectForQuote') === '1';
  const returnInquiryId = searchParams?.get('inquiryId') || null;

  // People-first default. selectForQuote (incoming from the new-quote
  // builder's "pick a client" flow) still lands on Companies — that
  // flow specifically needs the company picker.
  const [tab, setTab] = useState<"companies" | "people">(
    selectForQuote ? "companies" : "people",
  );
  const [companies, setCompanies] = useState<Company[]>([]);
  const [people, setPeople] = useState<PersonResult[]>([]);
  // Role-chip strip state for the People tab. Counts come from the
  // /api/crm/people response (single groupBy, internal-staff excluded
  // server-side). Active filter is mirrored to the URL `?role=` so it
  // survives refresh and is shareable.
  const [roleStats, setRoleStats] = useState<{ total: number; byRole: Record<string, number> } | null>(null);
  const roleFromUrl = searchParams?.get('role') ?? null;
  const [roleFilter, setRoleFilter] = useState<string | null>(roleFromUrl);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [sort, setSort] = useState("spend");
  const [loading, setLoading] = useState(true);

  // Population aggregates from /api/crm/stats — the strip + segment
  // chips show the same numbers regardless of pagination/filter so a
  // tap-to-filter doesn't change the count next to it.
  const [stats, setStats] = useState<{
    topClientSpendCutoff: number;
    topClientsCount: number;
    goneQuietCount: number;
    discountWatchCount: number;
    neverOrderedCount: number;
    followUpDueCount: number;
    totalCompanies: number;
  } | null>(null);

  // Add company modal
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTier, setNewTier] = useState("NEW");
  const [newEmail, setNewEmail] = useState("");

  // Add contact modal
  const [showAddContact, setShowAddContact] = useState(false);
  // Quick-log outreach modal (Oliver's outside-sales flow).
  const [showLogOutreach, setShowLogOutreach] = useState(false);
  const [cFirst, setCFirst] = useState("");
  const [cLast, setCLast] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cMobile, setCMobile] = useState("");
  const [cRole, setCRole] = useState("OTHER");

  // Companies-list segment filter. Drives the server-side `segment`
  // query param so the chip operates over the FULL population
  // (filter happens BEFORE the take:100 page slice). The chips on
  // the Companies tab and the strip's company-side cards share this
  // single state — one source of truth per the spec.
  // 'followups' stays a People-tab concern (no server segment).
  const [segmentFilter, setSegmentFilter] = useState<
    null | 'followups' | 'topClients' | 'quiet' | 'discount' | 'neverOrdered'
  >(null);

  const fetchCompanies = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (tierFilter) params.set("tier", tierFilter);
    params.set("sort", sort);
    if (
      segmentFilter === 'topClients' ||
      segmentFilter === 'quiet' ||
      segmentFilter === 'discount' ||
      segmentFilter === 'neverOrdered'
    ) {
      params.set("segment", segmentFilter);
    }
    const res = await fetch(`/api/crm/companies?${params}`);
    const data = await res.json();
    setCompanies(data.companies || []);
  }, [search, tierFilter, sort, segmentFilter]);

  const fetchPeople = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (roleFilter) params.set("role", roleFilter);
    const res = await fetch(`/api/crm/people?${params}`);
    const data = await res.json();
    setPeople(data.people || []);
    if (data.roleStats) setRoleStats(data.roleStats);
  }, [search, roleFilter]);

  const fetchFollowUps = useCallback(async () => {
    const res = await fetch("/api/crm/activities?pending=true");
    const data = await res.json();
    setFollowUps(data.activities || []);
  }, []);

  const fetchStats = useCallback(async () => {
    const res = await fetch("/api/crm/stats");
    if (!res.ok) return;
    const data = await res.json();
    setStats(data);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      tab === "companies" ? fetchCompanies() : fetchPeople(),
    ]).then(() => setLoading(false));
  }, [tab, fetchCompanies, fetchPeople]);

  // Mirror roleFilter into the URL so refresh + share preserve it.
  // Replace (not push) so the back button doesn't accumulate every
  // chip click as a history entry.
  useEffect(() => {
    if (tab !== 'people') return;
    const params = new URLSearchParams(window.location.search);
    if (roleFilter) params.set('role', roleFilter);
    else params.delete('role');
    const query = params.toString();
    const next = `/crm${query ? `?${query}` : ''}`;
    if (next !== window.location.pathname + window.location.search) {
      router.replace(next, { scroll: false });
    }
  }, [roleFilter, tab, router]);

  // Follow-ups fetch independent of the tab — drives the
  // "Needs attention" strip at the top of the page, which is always
  // visible regardless of which list is open. /api/crm/stats runs
  // alongside for the population aggregates (strip + segment chips).
  useEffect(() => {
    fetchFollowUps();
    fetchStats();
  }, [fetchFollowUps, fetchStats]);

  const addContact = async () => {
    if (!cFirst || !cLast || !cEmail) return;
    const res = await fetch("/api/crm/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: cFirst, lastName: cLast, email: cEmail,
        phone: cPhone || null, mobile: cMobile || null,
        role: cRole, tier: "STANDARD",
      }),
    });
    if (res.ok) {
      setShowAddContact(false);
      setCFirst(""); setCLast(""); setCEmail(""); setCPhone(""); setCMobile(""); setCRole("OTHER");
      fetchPeople();
    } else {
      const data = await res.json();
      alert(data.error || "Failed to add contact");
    }
  };

  const addCompany = async () => {
    if (!newName) return;
    await fetch("/api/crm/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, tier: newTier, billingEmail: newEmail || null }),
    });
    setShowAdd(false); setNewName(""); setNewEmail("");
    fetchCompanies();
  };

  const completeFollowUp = async (id: string) => {
    await fetch(`/api/crm/activities/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    fetchFollowUps();
  };

  // Strip counts come from /api/crm/stats — population aggregates,
  // not the loaded page. Fall back to the local activities array
  // for followUps so the count stays live while the user marks
  // them complete inline.
  const pendingCount = stats?.followUpDueCount ?? followUps.filter(f => !f.completed).length;
  const goneQuietCount = stats?.goneQuietCount ?? 0;
  const discountWatchCount = stats?.discountWatchCount ?? 0;
  const topClientsCount = stats?.topClientsCount ?? 0;
  const neverOrderedCount = stats?.neverOrderedCount ?? 0;

  // Company-list filtering is now SERVER-side via segment=*; the page
  // just renders whatever /api/crm/companies returned. No local
  // filter — the chip filters operate on the FULL population (not
  // the take:100 slice) precisely because the server is doing the
  // work. People-side 'followups' stays a local filter for now (the
  // /api/crm/people route doesn't take a segment param yet).
  const filteredCompanies = companies;
  const filteredPeople =
    segmentFilter === 'followups'
      ? people.filter((p) => p.badges?.includes('FOLLOW_UP_DUE'))
      : people;

  const selectCompanyForQuote = (companyId: string) => {
    const params = new URLSearchParams();
    if (returnInquiryId) params.set('inquiryId', returnInquiryId);
    params.set('clientCompanyId', companyId);
    router.push(`/orders/new-quote?${params.toString()}`);
  };

  const cancelSelectForQuote = () => {
    const params = new URLSearchParams();
    if (returnInquiryId) params.set('inquiryId', returnInquiryId);
    router.push(`/orders/new-quote${params.toString() ? `?${params.toString()}` : ''}`);
  };

  return (
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1400px] mx-auto">
      {selectForQuote && (
        <div className="mb-4 rounded-xl bg-chip-warn-bg border border-chip-warn-fg/30 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-chip-warn-fg">
            <span className="font-semibold">Select a company for your new quote.</span>{' '}
            <span className="text-chip-warn-fg">Click any company below — you&apos;ll be returned to the quote builder with it pre-filled.</span>
          </div>
          <button
            onClick={cancelSelectForQuote}
            className="px-3 py-1.5 bg-lt-card border border-chip-warn-fg/30 text-chip-warn-fg text-xs font-semibold rounded-lg hover:bg-chip-warn-bg"
          >
            Cancel
          </button>
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-lt-fg">Clients</h1>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowLogOutreach(true)}
            className="min-h-[2.5rem] px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg transition-colors">
            + Log outreach
          </button>
          <button onClick={() => setShowAddContact(true)}
            className="min-h-[2.5rem] px-4 py-2 bg-lt-inner hover:bg-lt-hairline text-lt-fg text-sm font-medium rounded-lg transition-colors">
            + Add Contact
          </button>
          <button onClick={() => setShowAdd(true)}
            className="min-h-[2.5rem] px-4 py-2 bg-lt-fg hover:bg-black text-white text-sm font-medium rounded-lg transition-colors">
            + Add Company
          </button>
        </div>
      </div>

      {/* Needs attention — three live-count cards. Tapping a card
          routes the list to the matching subset (and switches tabs
          if the data lives there). Re-tapping the active card
          clears the filter. */}
      <NeedsAttentionStrip
        followUpCount={pendingCount}
        goneQuietCount={goneQuietCount}
        discountWatchCount={discountWatchCount}
        active={
          segmentFilter === 'followups' || segmentFilter === 'quiet' || segmentFilter === 'discount'
            ? segmentFilter
            : null
        }
        onPick={(next) => {
          if (next === segmentFilter) {
            setSegmentFilter(null);
            return;
          }
          setSegmentFilter(next);
          // Route to the tab whose list will surface the filter.
          // Follow-ups + people-side filters live on the People tab;
          // company-side filters (quiet, discount) on Companies.
          if (next === 'followups') setTab('people');
          else if (next === 'quiet' || next === 'discount') setTab('companies');
        }}
      />

      {/* Tabs — People first; Contacts renamed to People (label only;
          underlying tab key + route + data shape unchanged). Follow-
          Ups tab is gone, surfaced in the strip above. */}
      <div className="flex gap-1 mb-4 bg-lt-inner rounded-lg p-0.5 w-fit">
        {([["people", "People"], ["companies", "Companies"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => { setTab(key as typeof tab); setSearch(""); setRoleFilter(null); }}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === key ? "bg-white text-lt-fg" : "text-lt-fg2 hover:text-lt-fg"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      {(
        <div className="flex gap-3 mb-4">
          <input type="text" placeholder={tab === "companies" ? "Search companies..." : "Search people..."}
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="flex-1 max-w-sm px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg placeholder:text-lt-fg3 focus:outline-none focus:border-lt-fg2" />
          {tab === "companies" && (
            <>
              <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}
                className="px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg">
                <option value="">All Tiers</option>
                <option value="VIP">VIP</option>
                <option value="PREFERRED">Preferred</option>
                <option value="STANDARD">Standard</option>
                <option value="NEW">New</option>
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value)}
                className="px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg">
                <option value="spend">Top Spend</option>
                <option value="name">A-Z</option>
                <option value="recent">Recent</option>
              </select>
            </>
          )}
        </div>
      )}

      {/* CRM auto-capture review — People tab only. Mirrors the
          ClaimMailTriage widget pattern: counts header, NEEDS_REVIEW
          rows with Add+Dismiss, AUTO_CAPTURED audit list with Undo,
          SKIPPED rows visible for forensics. onChanged refreshes the
          People list so newly-added contacts surface without a manual
          reload. */}
      {tab === 'people' && (
        <CaptureReviewWidget onChanged={() => { fetchPeople(); }} />
      )}

      {/* Role-stats chip strip — People tab only. Counts come from
          /api/crm/people (single groupBy, server-side filter on
          @sirreel.com so internal staff are excluded from totals but
          still visible in the table). Counts respect the active search
          but NOT the active role filter (otherwise clicking PRODUCER
          would zero every other chip and defeat the strip). Matches
          the Companies tab's SegmentChips rhythm: rounded-full pills,
          dark-bg/white when active. */}
      {tab === 'people' && roleStats && roleStats.total > 0 && (
        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          <button
            type="button"
            onClick={() => setRoleFilter(null)}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors inline-flex items-center gap-1.5 ${
              roleFilter === null
                ? 'bg-lt-fg border-lt-fg text-white'
                : 'bg-lt-card border-lt-hairline text-lt-fg2 hover:border-lt-fg2'
            }`}
            title="Show every role"
          >
            <span>All</span>
            <span className={`font-mono ${roleFilter === null ? 'text-white' : 'text-lt-fg3'}`}>{roleStats.total}</span>
          </button>
          {(() => {
            // Spec ordering: count DESC, OTHER always last regardless
            // of count. Zero-count roles don't render at all so the
            // strip stays scannable on small client books.
            const PERSON_ROLE_LABELS: Record<string, string> = {
              UPM: 'UPM',
              PRODUCER: 'Producer',
              LINE_PRODUCER: 'Line Producer',
              PRODUCTION_COORDINATOR: 'Prod. Coordinator',
              PRODUCTION_SUPERVISOR: 'Prod. Supervisor',
              TRANSPORTATION_COORDINATOR: 'Transpo',
              ART_COORDINATOR: 'Art Coord.',
              COORDINATOR: 'Coordinator',
              OWNER: 'Owner',
              OTHER: 'Other',
            }
            const entries = Object.entries(roleStats.byRole)
              .filter(([k, v]) => v > 0 && k !== 'OTHER')
              .sort(([, a], [, b]) => b - a)
            if ((roleStats.byRole.OTHER ?? 0) > 0) {
              entries.push(['OTHER', roleStats.byRole.OTHER])
            }
            return entries.map(([role, count]) => {
              const isActive = roleFilter === role
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => setRoleFilter(isActive ? null : role)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors inline-flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-lt-fg border-lt-fg text-white'
                      : 'bg-lt-card border-lt-hairline text-lt-fg2 hover:border-lt-fg2'
                  }`}
                  title={isActive ? 'Tap to clear filter' : `Filter to ${PERSON_ROLE_LABELS[role] ?? role}`}
                >
                  <span>{PERSON_ROLE_LABELS[role] ?? role}</span>
                  <span className={`font-mono ${isActive ? 'text-white' : 'text-lt-fg3'}`}>{count}</span>
                </button>
              )
            })
          })()}
        </div>
      )}

      {/* Sales-segment chips — Companies tab only. Server-driven
          (segment=* on /api/crm/companies), so each chip filters
          over the FULL population, not the take:100 page slice.
          Chip counts come from /api/crm/stats so they don't drift.
          Sharing state with the strip means tapping the Gone-quiet
          card and the Gone-quiet chip do exactly the same thing —
          one source of truth. */}
      {tab === "companies" && (
        <SegmentChips
          active={
            segmentFilter === 'topClients' ||
            segmentFilter === 'quiet' ||
            segmentFilter === 'neverOrdered'
              ? segmentFilter
              : null
          }
          counts={{
            topClients: topClientsCount,
            quiet: goneQuietCount,
            neverOrdered: neverOrderedCount,
          }}
          onPick={(next) => setSegmentFilter(next === segmentFilter ? null : next)}
        />
      )}

      {/* Companies Tab */}
      {tab === "companies" && (
        <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-lt-hairline text-lt-fg2 text-left text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Tier</th>
                <th className="px-4 py-3 font-medium">Key Contacts</th>
                <th className="px-4 py-3 font-medium text-right">Total Spend</th>
                <th className="px-4 py-3 font-medium text-center">Bookings</th>
                <th className="px-4 py-3 font-medium text-center">Orders</th>
                <th className="px-4 py-3 font-medium text-center">COI</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-lt-fg3">Loading...</td></tr>
              ) : filteredCompanies.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-lt-fg3">
                  {segmentFilter === 'quiet'
                    ? 'No gone-quiet companies — every active client has ordered in the last 90 days.'
                    : segmentFilter === 'discount'
                      ? 'No companies on discount-watch — nobody is set to Frequent or Always negotiate.'
                      : segmentFilter === 'topClients'
                        ? 'No top clients yet — nothing has crossed the 90th-percentile spend cutoff.'
                        : segmentFilter === 'neverOrdered'
                          ? 'No never-ordered companies — every client on file has at least one order.'
                          : 'No companies found'}
                </td></tr>
              ) : filteredCompanies.map((co) => (
                <tr
                  key={co.id}
                  onClick={() => selectForQuote ? selectCompanyForQuote(co.id) : router.push(`/crm/${co.id}`)}
                  className={`border-b border-lt-hairline/50 cursor-pointer transition-colors ${
                    selectForQuote ? 'hover:bg-chip-warn-bg' : 'hover:bg-lt-inner/50'
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="text-lt-fg font-medium">{co.name}</div>
                    <ClientBadgeChips badges={co.badges} loyalSinceYear={co.loyalSinceYear} />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${TIER_STYLES[co.tier] || "bg-lt-inner text-lt-fg2"}`}>
                      {co.tier}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-lt-fg2 text-xs">
                    {co.affiliations.length > 0
                      ? co.affiliations.map(a => `${a.person.firstName} ${a.person.lastName}`).join(", ")
                      : <span className="text-lt-fg3">No contacts</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-lt-fg font-mono">{fmt(co.totalSpend)}</td>
                  <td className="px-4 py-3 text-center text-lt-fg2">{co.totalBookings}</td>
                  <td className="px-4 py-3 text-center text-lt-fg2">{co._count.orders}</td>
                  <td className="px-4 py-3 text-center">
                    {selectForQuote ? (
                      <div className="flex items-center justify-center gap-2">
                        <span className={`text-[10px] ${co.coiOnFile ? 'text-chip-good-fg' : 'text-lt-fg3'}`}>
                          {co.coiOnFile ? 'COI ✓' : 'no COI'}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); selectCompanyForQuote(co.id); }}
                          className="px-2.5 py-1 bg-lt-fg hover:bg-black text-white text-[11px] font-bold rounded"
                        >
                          Select →
                        </button>
                      </div>
                    ) : co.coiOnFile
                      ? <span className="text-chip-good-fg text-xs">On File</span>
                      : <span className="text-lt-fg3 text-xs">Missing</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* People Tab */}
      {tab === "people" && (
        <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-lt-hairline text-lt-fg2 text-left text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium text-right">Spend</th>
                <th className="px-4 py-3 font-medium text-center">Bookings</th>
                <th className="px-2 py-3 font-medium text-right w-10" aria-label="Edit" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-lt-fg3">Loading...</td></tr>
              ) : filteredPeople.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-lt-fg3">
                  {segmentFilter === 'followups'
                    ? 'No follow-ups due — inbox zero.'
                    : 'No contacts found'}
                </td></tr>
              ) : filteredPeople.map((p) => (
                // ?edit=1 hands the person-detail page a hint to open
                // in edit mode immediately — saves one click vs. the
                // detail page's standard "click Edit then change fields"
                // flow. The detail page reads the param on mount.
                <tr
                  key={p.id}
                  onClick={() => router.push(`/crm/people/${p.id}?edit=1`)}
                  className="group border-b border-lt-hairline/50 hover:bg-lt-inner cursor-pointer transition-colors"
                  title={`Click to edit ${p.firstName} ${p.lastName}`}
                >
                  <td className="px-4 py-3">
                    <div className="text-lt-fg font-medium group-hover:text-black">{p.firstName} {p.lastName}</div>
                    <ClientBadgeChips
                      badges={p.badges}
                      loyalSinceYear={p.primaryCompanyBadgeFacts?.loyalSinceYear ?? null}
                    />
                  </td>
                  <td className="px-4 py-3 text-lt-fg2 text-xs">{p.role.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3 text-lt-fg2 text-xs">
                    {p.affiliations.length > 0
                      ? p.affiliations.map(a => a.company.name).join(", ")
                      : "--"}
                  </td>
                  <td className="px-4 py-3 text-lt-fg2 text-xs">
                    <span className="inline-flex items-baseline gap-1.5 flex-wrap">
                      <span>{p.email}</span>
                      {isHighRiskEmailDomain(p.email) && (
                        <span
                          className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-chip-neutral-bg text-chip-neutral-fg whitespace-nowrap"
                          title="Apple iCloud may silently filter mail to this address — confirm receipt or use another channel."
                        >
                          iCloud — may be filtered
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-lt-fg2 text-xs">{p.phone || "--"}</td>
                  <td className="px-4 py-3 text-right text-lt-fg font-mono">{fmt(p.totalSpend)}</td>
                  <td className="px-4 py-3 text-center text-lt-fg2">{p.totalBookings}</td>
                  {/* Trailing chevron with a hover-revealed "Edit"
                      label so the affordance reads as "this row is
                      tappable to edit" at a glance. */}
                  <td className="px-3 py-3 text-right whitespace-nowrap text-lt-fg3 group-hover:text-lt-fg text-xs">
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity mr-1 font-medium">Edit</span>
                    <span aria-hidden="true">›</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Follow-Ups tab content moved to the NeedsAttentionStrip
          rendered above. completeFollowUp + fetchFollowUps + the
          underlying /api/crm/activities calls are unchanged. */}

      {/* Add Contact Modal */}
      {showAddContact && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddContact(false)}>
          <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-lt-fg mb-4">Add Contact</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-lt-fg2 mb-1">First Name *</label>
                  <input type="text" value={cFirst} onChange={(e) => setCFirst(e.target.value)}
                    className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg" />
                </div>
                <div>
                  <label className="block text-xs text-lt-fg2 mb-1">Last Name *</label>
                  <input type="text" value={cLast} onChange={(e) => setCLast(e.target.value)}
                    className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-lt-fg2 mb-1">Email *</label>
                <input type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-lt-fg2 mb-1">Office Phone</label>
                  <input type="tel" value={cPhone} onChange={(e) => setCPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg" />
                </div>
                <div>
                  <label className="block text-xs text-lt-fg2 mb-1">Mobile</label>
                  <input type="tel" value={cMobile} onChange={(e) => setCMobile(e.target.value)}
                    className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-lt-fg2 mb-1">Role</label>
                <select value={cRole} onChange={(e) => setCRole(e.target.value)}
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg">
                  <option value="OTHER">Other</option>
                  <option value="UPM">UPM</option>
                  <option value="PRODUCER">Producer</option>
                  <option value="LINE_PRODUCER">Line Producer</option>
                  <option value="PRODUCTION_COORDINATOR">Production Coordinator</option>
                  <option value="PRODUCTION_SUPERVISOR">Production Supervisor</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={addContact} disabled={!cFirst || !cLast || !cEmail}
                className="px-4 py-2 bg-lt-fg hover:bg-black disabled:bg-lt-inner text-white text-sm font-medium rounded-lg">
                Add Contact
              </button>
              <button onClick={() => setShowAddContact(false)} className="px-4 py-2 text-lt-fg2 hover:text-lt-fg text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Company Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAdd(false)}>
          <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-lt-fg mb-4">Add Company</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-lt-fg2 mb-1">Company Name *</label>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg" />
              </div>
              <div>
                <label className="block text-xs text-lt-fg2 mb-1">Tier</label>
                <select value={newTier} onChange={(e) => setNewTier(e.target.value)}
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg">
                  <option value="NEW">New</option><option value="STANDARD">Standard</option>
                  <option value="PREFERRED">Preferred</option><option value="VIP">VIP</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-lt-fg2 mb-1">Billing Email</label>
                <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={addCompany} disabled={!newName}
                className="px-4 py-2 bg-lt-fg hover:bg-black disabled:bg-lt-inner text-white text-sm font-medium rounded-lg">
                Add Company
              </button>
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-lt-fg2 hover:text-lt-fg text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
      {showLogOutreach && (
        <OutreachQuickLogModal
          onClose={() => setShowLogOutreach(false)}
          onSaved={() => {
            // Refresh population stats so the FOLLOW-UPS DUE card
            // picks up any newly-logged follow-up immediately.
            fetchStats();
          }}
        />
      )}
      </div>
    </div>
  );
}

// "Needs attention" strip — three live-count cards across the top
// of the Clients page. Each card surfaces a signal worth acting on
// and taps to filter the list below to the matching subset:
//   Follow-ups due  → People where badges includes FOLLOW_UP_DUE
//   Gone quiet      → Companies with no order in the last QUIET_DAYS
//   Discount-watch  → Companies whose discountTendency is
//                     FREQUENT or ALWAYS
// Re-tap an active card to clear the filter. Counts update with
// the underlying data — no extra round trips.
type AttentionKey = 'followups' | 'quiet' | 'discount';

function NeedsAttentionStrip({
  followUpCount,
  goneQuietCount,
  discountWatchCount,
  active,
  onPick,
}: {
  followUpCount: number;
  goneQuietCount: number;
  discountWatchCount: number;
  active: AttentionKey | null;
  onPick: (next: AttentionKey) => void;
}) {
  const cards: { key: AttentionKey; label: string; count: number; tone: string; Icon: () => JSX.Element; activeBg: string }[] = [
    { key: 'followups', label: 'Follow-ups due', count: followUpCount,      tone: 'text-chip-bad-fg',      Icon: BellIcon,     activeBg: 'bg-chip-bad-bg border-chip-bad-fg' },
    { key: 'quiet',     label: 'Gone quiet',     count: goneQuietCount,     tone: 'text-chip-neutral-fg',  Icon: ZzzIcon,      activeBg: 'bg-chip-neutral-bg border-chip-neutral-fg' },
    { key: 'discount',  label: 'Discount-watch', count: discountWatchCount, tone: 'text-cadence-returning-today-fg', Icon: DiscountIcon, activeBg: 'bg-cadence-returning-today-bg border-cadence-returning-today-fg' },
  ];
  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-lt-fg3 mb-2">Needs attention</div>
      <div className="grid grid-cols-3 gap-3">
        {cards.map((c) => {
          const isActive = active === c.key;
          const hasAny = c.count > 0;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onPick(c.key)}
              className={`text-left rounded-xl border p-3 transition-colors ${
                isActive
                  ? c.activeBg
                  : hasAny
                    ? 'bg-lt-card border-lt-hairline hover:border-lt-fg2'
                    : 'bg-lt-card border-lt-hairline opacity-70 hover:opacity-100'
              }`}
              title={
                isActive
                  ? `Tap to clear filter`
                  : hasAny
                    ? `Tap to filter the list to ${c.label.toLowerCase()}`
                    : 'Nothing here right now'
              }
            >
              <div className="flex items-start justify-between gap-2">
                <span className={`inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold ${isActive ? c.tone : 'text-lt-fg2'}`}>
                  <c.Icon />
                  {c.label}
                </span>
                {isActive && <span className="text-[10px] text-lt-fg3">tap to clear</span>}
              </div>
              <div className={`mt-1 text-2xl font-semibold font-mono ${hasAny ? c.tone : 'text-lt-fg3'}`}>
                {c.count}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Sales-segment chips above the Companies table. Each chip filters
// the list to a population subset — All / Top clients / Gone quiet /
// Never ordered. The filter is server-side (segment=* query param),
// so chips operate on the full population, not the take:100 page
// slice. Counts come from /api/crm/stats. "Gone quiet" shares state
// with the strip's Gone-quiet card — one filter, two entry points.
type SegmentKey = 'topClients' | 'quiet' | 'neverOrdered';

function SegmentChips({
  active,
  counts,
  onPick,
}: {
  active: SegmentKey | null;
  counts: { topClients: number; quiet: number; neverOrdered: number };
  onPick: (next: SegmentKey) => void;
}) {
  // "All" is just the null/cleared state — re-tapping the active chip
  // clears it via the parent's toggle logic, so the explicit All chip
  // is a discoverable affordance for the same gesture.
  const chips: { key: SegmentKey; label: string; count: number }[] = [
    { key: 'topClients',   label: 'Top clients',   count: counts.topClients },
    { key: 'quiet',        label: 'Gone quiet',    count: counts.quiet },
    { key: 'neverOrdered', label: 'Never ordered', count: counts.neverOrdered },
  ];
  return (
    <div className="flex items-center gap-1.5 mb-3 flex-wrap">
      <button
        type="button"
        onClick={() => active && onPick(active)}
        className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
          active === null
            ? 'bg-lt-fg border-lt-fg text-white'
            : 'bg-lt-card border-lt-hairline text-lt-fg2 hover:border-lt-fg2'
        }`}
        title="Show every company"
      >
        All
      </button>
      {chips.map((c) => {
        const isActive = active === c.key;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onPick(c.key)}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors inline-flex items-center gap-1.5 ${
              isActive
                ? 'bg-lt-fg border-lt-fg text-white'
                : 'bg-lt-card border-lt-hairline text-lt-fg2 hover:border-lt-fg2'
            }`}
            title={isActive ? 'Tap to clear filter' : `Filter to ${c.label.toLowerCase()}`}
          >
            <span>{c.label}</span>
            <span className={`font-mono ${isActive ? 'text-white' : 'text-lt-fg3'}`}>{c.count}</span>
          </button>
        );
      })}
    </div>
  );
}
