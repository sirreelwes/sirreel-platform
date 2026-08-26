'use client';

/**
 * Quick Reply — a fast availability-confirmation reply for an inbound client
 * email asking to hold trucks/supplies before a firm quote.
 *
 * Reuses the Capture & Quote spine end-to-end:
 *   1. parse the email via the SAME parser (POST /api/orders/parse-quote)
 *   2. real per-category availability (POST /api/sales/quick-reply/availability
 *      → getCategoryAvailability) — the reply text is built FROM these numbers
 *   3. optional soft holds via the SAME hold path (POST /api/scheduling/holds)
 *   4. review + send through the SAME gate (EmailReviewModal) — nothing auto-sends
 *
 * Job-as-root (step 4): soft holds no longer auto-create a Job. Before
 * any hold is created, the JobResolverModal opens — seeded with the
 * parsed company/contact/name/dates — and the agent explicitly picks an
 * existing Job or creates one (createJobFromDraft, status NEW). A second
 * email about the same shoot ranks the first email's Job as a candidate
 * instead of silently spawning a duplicate.
 */

import { useCallback, useEffect, useState, useRef} from 'react';
import { EmailReviewModal, type EmailReviewTarget } from '@/components/email/EmailReviewModal';
import { JobResolverModal, type ResolvedJob } from '@/components/shared/JobResolverModal';
import { isProvisionalCompanyName } from '@/lib/companies/provisional';

interface MatchedProduct { id: string; type: string; name: string; lineType?: string | null }
interface ParsedItem {
  catalogType: string | null
  quantity: number
  matchedProduct: MatchedProduct | null
  /** The client's own words for the line — the label when nothing matched. */
  description?: string | null
  /** 'AUTO_KIT' rows are server-derived accessories (chargers, spare
   *  batteries), not something the client asked for. */
  matchSource?: string | null
  /** THIS line's own window. parse-quote resolves it per line and falls back
   *  to the quote-level range, so a client asking for the same truck over two
   *  separate stretches comes back as two lines with two windows. Ignoring
   *  these was how "Aug 27–28 and Sep 2–3" went out as one Aug 27 – Sep 3
   *  span on both lines (Wes 2026-08-26). */
  pickupDate?: string | null
  returnDate?: string | null
}
/**
 * A line on the hold. Dates live PER LINE (Wes 2026-08-25: "the option to
 * add assets to hold and dates for each asset") — a van needed from the
 * 28th and a box truck from the 29th are one hold request with two
 * different windows, not two separate replies.
 *
 * Parser-detected lines seed their dates from the email's date range; the
 * agent can change them, and can add lines the parser never saw.
 */
interface Cat { id: string; name: string; quantity: number; startDate: string; endDate: string }
/** A category the agent can add by hand — GET /api/scheduling/categories. */
interface PickCat { id: string; name: string; totalUnits?: number }
/**
 * Something that rides along on the vehicle — ratchet straps, furniture
 * pads, a small gear order (Wes 2026-08-26: the most common baseline request
 * there is).
 *
 * These are NOT hold lines and never will be: expendables and gear live in
 * InventoryItem with no Asset units behind them, so the scheduler has nothing
 * to reserve. Until this list existed the parser's non-vehicle rows were
 * filtered out and thrown away — a client asked for ten ratchet straps on the
 * cargo van and the reply never mentioned them, on the hold or in the email.
 * Now they ride on the reply and on the hold's notes.
 */
interface Supply { key: string; name: string; quantity: number; inventoryItemId: string | null }
interface Line { id: string; name: string; requested: number; availableToHold: number; serviceableCount: number; status: 'available' | 'tight' | 'short' }
/** Availability is per (category, window) — the same van over two different
 *  windows has two different answers, so lines are keyed by both. */
const lineKey = (categoryId: string, start: string, end: string) => `${categoryId}|${start}|${end}`

/**
 * The stage complex, matched on the picker's own label so a rename shows
 * up here without a code change. Only this line offers area checkboxes —
 * vehicles have no areas.
 */
const isStageComplex = (categoryName: string) => /lankershim/i.test(categoryName)

interface Props {
  emailText: string;
  defaultRecipientEmail?: string | null;
  defaultRecipientName?: string | null;
  /** EmailMessage id of the inbound being replied to — drives CRM capture on send. */
  inboundEmailMessageId?: string | null;
  /** EmailThread id (email-in-Job) — feeds resolver rung ① (a thread
   *  already filed in a Job is a CLEAN_MATCH) and lets the resolved Job
   *  auto-file the thread (fill-only) after the agent's pick. */
  threadId?: string | null;
  onClose: () => void;
  onSent?: () => void;
}

const STATUS_PILL: Record<Line['status'], string> = {
  available: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  tight: 'bg-amber-50 text-amber-800 border-amber-200',
  short: 'bg-rose-50 text-rose-700 border-rose-200',
};
const STATUS_LABEL: Record<Line['status'], string> = { available: 'Available', tight: 'Tight', short: 'Spoken for' };

export function QuickReplyModal({ emailText, defaultRecipientEmail, defaultRecipientName, inboundEmailMessageId, threadId, onClose, onSent }: Props) {
  const [phase, setPhase] = useState<'parsing' | 'ready' | 'error'>('parsing');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const [clientName, setClientName] = useState<string | null>(null);
  // Company typeahead (Wes, 2026-08-25). The field was free text, so an
  // agent could type a company we already know and still be told "add the
  // client & contact to the CRM first" — soft holds were gated on
  // `holdable`, which is only ever set from the AI parse's EXACT match at
  // open time. Picking a known company here resolves that same companyId,
  // so the hold checkbox unlocks without leaving the modal.
  const [companyHits, setCompanyHits] = useState<Array<{ id: string; name: string }>>([]);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [matchedCompanyId, setMatchedCompanyId] = useState<string | null>(null);
  // The exact name WE set (parse prefill or a dropdown pick). Compared by
  // VALUE, not consumed like a boolean flag: React double-invokes effects
  // in dev, which desynced a boolean guard and swallowed the agent's first
  // real edit — the match label stayed green while the field said something
  // else entirely (caught in preview, 2026-08-25).
  const adoptedName = useRef<string | null>(null);
  // The contact the parser resolved, kept even when the company didn't —
  // a company pick plus this is enough to enable soft holds.
  const [parsedPersonId, setParsedPersonId] = useState<string | null>(null);

  // Job typeahead (Wes, 2026-08-25) — same shape as the company one above.
  // Beyond convenience: picking an EXISTING job pre-resolves `job`, so the
  // send path no longer has to stop and open the JobResolverModal, and a
  // client asking for more gear on a job we already have stops spawning a
  // duplicate.
  const [jobHits, setJobHits] = useState<Array<{ id: string; jobCode: string; name: string; companyId: string | null; companyName: string | null; status: string }>>([]);
  const [jobOpen, setJobOpen] = useState(false);
  const adoptedJobName = useRef<string | null>(null);

  // Contact typeahead (Wes, 2026-08-26). "Reply to" was display-only text,
  // so when the parser failed to resolve the sender to a CRM Person there
  // was no way to say who they are — and soft holds need BOTH a company
  // and a person, so an unresolved contact kept the checkbox locked even
  // after the company field was fixed. Picking a contact here supplies the
  // missing half (and their affiliated company, if we don't have one yet).
  const [contactHits, setContactHits] = useState<Array<{ id: string; name: string; email: string; phone: string | null; companyId: string | null; companyName: string | null }>>([]);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactQuery, setContactQuery] = useState('');
  const adoptedContact = useRef<string | null>(null);
  const [jobName, setJobName] = useState<string | null>(null);
  const [pickup, setPickup] = useState<string | null>(null);
  const [ret, setRet] = useState<string | null>(null);
  const [recipientEmail, setRecipientEmail] = useState<string | null>(null);
  const [recipientName, setRecipientName] = useState<string | null>(null);
  const [cats, setCats] = useState<Cat[]>([]);
  const [supplies, setSupplies] = useState<Supply[]>([]);
  // Supply typeahead over the real catalog (GET /api/inventory/search) with a
  // free-text fallback — a client can ask for something we don't stock a code
  // for, and a note the warehouse can read beats a dropped line.
  const [supplyQuery, setSupplyQuery] = useState('');
  const [supplyHits, setSupplyHits] = useState<Array<{ id: string; code: string; description: string }>>([]);
  const [supplyOpen, setSupplyOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [holdable, setHoldable] = useState<{ companyId: string; personId: string } | null>(null);

  const [softHold, setSoftHold] = useState(true);
  // The resolved Job the soft holds will live in — always a REAL row
  // (agent-picked or agent-created via the resolver). Never auto-set.
  const [job, setJob] = useState<{ jobId: string; jobCode: string; name: string } | null>(null);
  const [resolverOpen, setResolverOpen] = useState(false);
  // Fold a request for the prod company + project name into the reply.
  // Default ON when the parse gave us neither — that's the "missing info" case.
  const [askForDetails, setAskForDetails] = useState(false);
  const [holdStatus, setHoldStatus] = useState<string | null>(null);
  // Stage areas the agent can name on a Lankershim hold (Wes 2026-08-25).
  // Checking one does NOT hold that stage on its own: the client is asked
  // to confirm the areas in the reply, and the formal hold follows. So
  // this records WHAT was asked for without silently consuming capacity.
  // Everyone the client CC'd on the inbound email. Pre-fills the reply's
  // CC so the coordinator/UPM who were looped in stay looped in — replying
  // to the sender alone quietly drops them (Wes 2026-08-25).
  const [inboundCc, setInboundCc] = useState<string[]>([]);
  const [stageAreas, setStageAreas] = useState<Array<{ id: string; name: string; kind: string }>>([]);
  const [areasByCat, setAreasByCat] = useState<Record<string, string[]>>({});

  // Categories the agent can add by hand (GET /api/scheduling/categories —
  // the same list the gantt's "+ New Hold" picker uses, so ids line up with
  // what POST /api/scheduling/holds expects).
  const [pickCats, setPickCats] = useState<PickCat[]>([]);
  const [addingId, setAddingId] = useState('');
  const [working, setWorking] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<EmailReviewTarget | null>(null);

  /**
   * Availability, one request per distinct window.
   *
   * Lines used to share one date range, so this was a single call. With
   * per-line dates the same category can be asked about twice with two
   * different answers, so results are keyed by (category, window) and the
   * windows are grouped to keep the request count at the number of
   * DISTINCT windows rather than the number of lines.
   */
  const refreshAvailability = useCallback(async (rows: Cat[]) => {
    const dated = rows.filter((c) => c.startDate && c.endDate)
    if (dated.length === 0) { setLines([]); return }
    const windows = new Map<string, Cat[]>()
    for (const c of dated) {
      const k = `${c.startDate}|${c.endDate}`
      const list = windows.get(k)
      if (list) list.push(c)
      else windows.set(k, [c])
    }
    const results = await Promise.all(
      [...windows.entries()].map(async ([k, group]) => {
        const [start, end] = k.split('|')
        try {
          const ar = await fetch('/api/sales/quick-reply/availability', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categories: group, pickup: start, return: end }),
          })
          const aj = await ar.json()
          if (!ar.ok || !aj.ok) return []
          return (aj.lines || []).map((l: Line) => ({ ...l, id: lineKey(l.id, start, end) }))
        } catch {
          return [] // best-effort: a failed window shows no pill, not a broken modal
        }
      }),
    )
    setLines(results.flat())
  }, [])

  const run = useCallback(async () => {
    setPhase('parsing');
    setErrMsg(null);
    try {
      const pr = await fetch('/api/orders/parse-quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: emailText }),
      });
      const pj = await pr.json();
      if (!pr.ok) throw new Error(pj.error || `Parse failed (${pr.status})`);

      const parsed = pj.parsed || {};
      const items: ParsedItem[] = Array.isArray(pj.items) ? pj.items : [];
      // Pre-merge this asked catalogType === 'ASSET_CATEGORY', because
      // vehicles were the only thing in that table. Every catalog hit is
      // type INVENTORY now, so the vehicle test reads the matched row's
      // own line type or the availability check would find nothing.
      // parse-quote fills a dateless line with today/tomorrow rather than
      // leaving it blank, so adopting per-line dates unconditionally would
      // invent a hold window on an email that named no dates at all. The
      // quote-level range is the signal that real dates were found — without
      // it we keep the existing blank-and-let-the-rep-pick behaviour.
      const rangeFound = !!(parsed.startDate && parsed.endDate);
      const assetCats: Cat[] = items
        .filter((i) => i.matchedProduct?.lineType === 'VEHICLE'
          || (i.catalogType === 'ASSET_CATEGORY' && i.matchedProduct))
        .map((i) => ({
          id: i.matchedProduct!.id,
          name: i.matchedProduct!.name,
          quantity: Math.max(1, Math.floor(i.quantity || 1)),
          // This line's own window, falling back to the email's range;
          // per-line editable below.
          startDate: rangeFound ? (i.pickupDate || parsed.startDate) : '',
          endDate: rangeFound ? (i.returnDate || parsed.endDate) : '',
        }));

      // Everything the client asked for that ISN'T a holdable vehicle/stage.
      // Kit accessories the SERVER derived are excluded — this list is what
      // the client asked for, and it gets read back to them.
      const supplyLines: Supply[] = items
        .filter((i) => !(i.matchedProduct?.lineType === 'VEHICLE'
          || (i.catalogType === 'ASSET_CATEGORY' && i.matchedProduct)))
        .filter((i) => i.matchSource !== 'AUTO_KIT')
        .map((i, idx) => ({
          key: `p${idx}`,
          name: (i.matchedProduct?.name || i.description || '').trim(),
          quantity: Math.max(1, Math.floor(i.quantity || 1)),
          inventoryItemId: i.matchedProduct?.id ?? null,
        }))
        .filter((sup) => !!sup.name);
      setSupplies(supplyLines);

      adoptedName.current = (parsed.clientName ?? '').trim() || null;
      setClientName(parsed.clientName ?? null);
      adoptedJobName.current = (parsed.productionName ?? '').trim() || null;
      setJobName(parsed.productionName ?? null);
      // Default the "ask the client" toggle ON when we have neither the
      // production company nor a job name — the reply will request them.
      setAskForDetails(!(parsed.clientName || parsed.productionName));
      setPickup(parsed.startDate ?? null);
      setRet(parsed.endDate ?? null);
      {
        const seed = parsed.contactEmail ?? defaultRecipientEmail ?? '';
        adoptedContact.current = seed || null;
        setContactQuery(seed);
      }
      setRecipientEmail(parsed.contactEmail ?? defaultRecipientEmail ?? null);
      setRecipientName(parsed.contactName ?? defaultRecipientName ?? null);
      setCats(assetCats);

      // Soft-hold needs an existing company + person (the parse resolves both
      // when the client is already in the CRM). Otherwise it's skipped.
      // Only an EXACT key match is adopted (clientMatchMeta.exact) —
      // fuzzy candidates are never blind-picked; the Job resolver is
      // where the agent settles company questions.
      const companyId: string | null =
        pj.clientMatchMeta?.exact === true && Array.isArray(pj.clientMatch) && pj.clientMatch[0]?.id
          ? pj.clientMatch[0].id
          : null;
      const contact = Array.isArray(pj.contacts) ? pj.contacts.find((c: { existing_person_id?: string | null }) => c.existing_person_id) : null;
      const personId: string | null = contact?.existing_person_id ?? null;
      // Only the CRM link is a hard requirement now: a hold has to belong to
      // a company + person. The parser finding nothing is no longer
      // disqualifying, because the agent can add lines themselves.
      const canHold = !!companyId && !!personId;
      setMatchedCompanyId(companyId);
      setHoldable(canHold ? { companyId: companyId!, personId: personId! } : null);
      // Remember the parsed contact even when the company didn't resolve —
      // if the agent then PICKS the company below, that's all we need to
      // enable holds.
      setParsedPersonId(personId);
      if (!canHold) setSoftHold(false);
      else if (assetCats.length === 0) setSoftHold(false); // nothing to hold YET — agent opts in after adding

      if (assetCats.length > 0) await refreshAvailability(assetCats);
      setPhase('ready');
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, [emailText, defaultRecipientEmail, defaultRecipientName, refreshAvailability]);

  // Debounced company lookup against the same endpoint CompanyPicker uses.
  useEffect(() => {
    const q = (clientName ?? '').trim();
    // A name we adopted ourselves keeps its match and doesn't re-search.
    if (adoptedName.current !== null && q === adoptedName.current) return;
    adoptedName.current = null;
    // Typing a NEW name invalidates any previously matched company — the
    // hold must not stay armed against the wrong client.
    setMatchedCompanyId(null);
    if (q.length < 2) {
      setCompanyHits([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/companies?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => {
          const hits = Array.isArray(d.companies) ? d.companies : [];
          setCompanyHits(hits);
          // Exact (case-insensitive) name → adopt silently; the agent
          // typed the company's real name, no need to make them click.
          const exact = hits.find((c: { name: string }) => c.name.toLowerCase() === q.toLowerCase());
          if (exact) {
            adoptedName.current = exact.name;
            setMatchedCompanyId(exact.id);
            setCompanyOpen(false);
          } else {
            setCompanyOpen(hits.length > 0);
          }
        })
        .catch(() => setCompanyHits([]));
    }, 300);
    return () => clearTimeout(t);
  }, [clientName]);

  // Keep `holdable` in step with the company the agent has actually chosen.
  useEffect(() => {
    if (matchedCompanyId && parsedPersonId) {
      setHoldable((prev) =>
        prev?.companyId === matchedCompanyId ? prev : { companyId: matchedCompanyId, personId: parsedPersonId },
      );
    } else if (!matchedCompanyId) {
      setHoldable(null);
      setSoftHold(false);
    }
  }, [matchedCompanyId, parsedPersonId]);

  // Debounced job lookup. Scoped to the matched company when we have one —
  // "Neon Nights" for THIS client beats every Neon Nights in the book.
  useEffect(() => {
    const q = (jobName ?? '').trim();
    if (adoptedJobName.current !== null && q === adoptedJobName.current) return;
    adoptedJobName.current = null;
    // Editing the name detaches any previously picked job: the holds must
    // not land on a job the agent has moved away from.
    setJob(null);
    if (q.length < 2) {
      setJobHits([]);
      return;
    }
    const shape = (d: { jobs?: unknown }) =>
      (Array.isArray(d.jobs) ? d.jobs : []).slice(0, 6).map((j: {
        id: string; jobCode: string; name: string; status: string;
        company?: { id: string; name: string } | null;
      }) => ({
        id: j.id, jobCode: j.jobCode, name: j.name, status: j.status,
        companyId: j.company?.id ?? null, companyName: j.company?.name ?? null,
      }));
    const search = async (companyId: string | null) => {
      const params = new URLSearchParams({ search: q, statuses: 'QUOTED,ACTIVE' });
      if (companyId) params.set('companyId', companyId);
      const r = await fetch(`/api/jobs?${params.toString()}`);
      return shape(await r.json());
    };
    const t = setTimeout(() => {
      (async () => {
        // Scoped first — this client's own jobs are what the agent means
        // nine times in ten. If the scope finds nothing, fall back to an
        // org-wide search rather than silently insisting the project is
        // new: the parser may have matched the wrong company, or this may
        // be a new contact at a company we already work with. Picking a
        // cross-company hit moves the company with it (handled at the
        // click), so the agent can't half-attach.
        let hits = await search(matchedCompanyId);
        if (hits.length === 0 && matchedCompanyId) hits = await search(null);
        setJobHits(hits);
        setJobOpen(hits.length > 0);
      })().catch(() => setJobHits([]));
    }, 300);
    return () => clearTimeout(t);
  }, [jobName, matchedCompanyId]);

  // Debounced contact lookup over /api/persons (tokenized name/email match).
  useEffect(() => {
    const q = contactQuery.trim();
    if (adoptedContact.current !== null && q === adoptedContact.current) return;
    adoptedContact.current = null;
    // Typing detaches the CRM link but KEEPS the typed value as the
    // send-to address: replying to an address we have no Person for is
    // completely normal and must keep working.
    setParsedPersonId(null);
    setRecipientEmail(q.includes('@') ? q : null);
    setRecipientName(null);
    if (q.length < 2) {
      setContactHits([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/persons?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => {
          const hits = (Array.isArray(d.persons) ? d.persons : []).slice(0, 6).map((p: {
            id: string; firstName: string; lastName: string; email: string; phone: string | null;
            company?: { id: string; name: string } | null;
          }) => ({
            id: p.id,
            name: [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.email,
            email: p.email,
            phone: p.phone,
            companyId: p.company?.id ?? null,
            companyName: p.company?.name ?? null,
          }));
          setContactHits(hits);
          setContactOpen(hits.length > 0);
        })
        .catch(() => setContactHits([]));
    }, 300);
    return () => clearTimeout(t);
  }, [contactQuery]);

  // Debounced supply lookup over the inventory catalog.
  useEffect(() => {
    const q = supplyQuery.trim();
    if (q.length < 2) { setSupplyHits([]); setSupplyOpen(false); return; }
    const t = setTimeout(() => {
      fetch(`/api/inventory/search?q=${encodeURIComponent(q)}&limit=6`)
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d) => {
          const hits = (Array.isArray(d.items) ? d.items : []).map((i: { id: string; code: string; description: string | null }) => ({
            id: i.id, code: i.code, description: i.description || i.code,
          }));
          setSupplyHits(hits);
          setSupplyOpen(hits.length > 0);
        })
        .catch(() => setSupplyHits([]));
    }, 300);
    return () => clearTimeout(t);
  }, [supplyQuery]);

  useEffect(() => { run(); }, [run]);

  useEffect(() => {
    let live = true;
    if (inboundEmailMessageId) {
      const ex = encodeURIComponent(defaultRecipientEmail || '');
      fetch(`/api/email-messages/${encodeURIComponent(inboundEmailMessageId)}/cc?exclude=${ex}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (live && d?.clients) setInboundCc(d.clients); })
        .catch(() => {});
    }
    fetch('/api/scheduling/stage-areas?picker=quickreply')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setStageAreas(d.areas || []); })
      .catch(() => {});
    fetch('/api/scheduling/categories')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setPickCats(d.categories || d.rows || (Array.isArray(d) ? d : [])); })
      .catch(() => { /* picker just stays empty; the parsed lines still work */ });
    return () => { live = false; };
  }, []);

  /** Edit one hold line, then re-check availability for the new shape. */
  const updateCat = useCallback((index: number, patch: Partial<Cat>) => {
    setCats((prev) => {
      const next = prev.map((c, i) => (i === index ? { ...c, ...patch } : c));
      void refreshAvailability(next);
      return next;
    });
  }, [refreshAvailability]);

  const removeCat = useCallback((index: number) => {
    setCats((prev) => {
      const next = prev.filter((_, i) => i !== index);
      void refreshAvailability(next);
      if (next.length === 0) setSoftHold(false);
      return next;
    });
  }, [refreshAvailability]);

  const addCat = useCallback((categoryId: string) => {
    const pick = pickCats.find((p) => p.id === categoryId);
    if (!pick) return;
    setCats((prev) => {
      // Same category twice is legitimate — two different windows — so this
      // does not dedupe. It only seeds sensible dates from the email.
      const next: Cat[] = [...prev, {
        id: pick.id, name: pick.name, quantity: 1,
        startDate: pickup ?? '', endDate: ret ?? '',
      }];
      void refreshAvailability(next);
      return next;
    });
    setAddingId('');
  }, [pickCats, pickup, ret, refreshAvailability]);

  const addSupply = useCallback((name: string, inventoryItemId: string | null) => {
    const clean = name.trim();
    if (!clean) return;
    setSupplies((prev) => [...prev, { key: `m${prev.length}-${clean}`, name: clean, quantity: 1, inventoryItemId }]);
    setSupplyQuery('');
    setSupplyHits([]);
    setSupplyOpen(false);
  }, []);

  /** Outer window across every dated hold line — min start, max end. */
  const holdWindow = (): { start: string; end: string } | null => {
    const dated = cats.filter((c) => c.startDate && c.endDate);
    if (dated.length === 0) return null;
    return {
      start: dated.reduce((a, c) => (c.startDate < a ? c.startDate : a), dated[0].startDate),
      end: dated.reduce((a, c) => (c.endDate > a ? c.endDate : a), dated[0].endDate),
    };
  };

  const buildPayload = (heldWindow: { start: string; end: string } | null) => ({
    recipientEmail: recipientEmail!,
    recipientName,
    clientName: clientName?.trim() || null,
    jobName: jobName?.trim() || null,
    pickup,
    return: ret,
    categories: cats,
    // Read back to the client in the reply, and written onto the hold's
    // notes below — a supply line that only lives in the agent's head is how
    // a truck leaves the yard without the straps.
    supplies: supplies.map((sup) => ({ name: sup.name, quantity: sup.quantity })),
    askForDetails,
    // "If the agent chooses to hold, the email should reflect that" (Wes
    // 2026-08-25). Only the WINDOW travels — the client is told their gear
    // is set aside, never which units, so nothing commits a named truck.
    heldFrom: heldWindow?.start ?? null,
    heldTo: heldWindow?.end ?? null,
    inboundEmailMessageId: inboundEmailMessageId ?? null,
  });

  // Every hold attaches to the agent-resolved Job — the route's inline
  // newJobName creation is gone; jobId is always real by this point.
  // companyId is passed explicitly (not read from state) so a resolve
  // that just re-pointed the company isn't lost to a stale closure.
  /**
   * Booking notes. The supplies list is written onto EVERY hold in the
   * request rather than one of them: it belongs to the booking, not to a
   * particular truck, and the person reading the hold on the gantt is the
   * person who has to put the straps on whichever truck they're loading.
   */
  const holdNotes = () => {
    const base = 'Soft hold from Quick Reply — pending client confirmation.';
    if (supplies.length === 0) return base;
    const list = supplies.map((sup) => `${sup.quantity} × ${sup.name}`).join(', ');
    return `${base}\nOn the vehicle: ${list}.`;
  };

  const createSoftHolds = async (resolved: { jobId: string; name: string }, companyId: string) => {
    if (!holdable) return;
    setHoldStatus('Creating soft holds…');
    let created = 0;
    for (const c of cats) {
      if (!c.startDate || !c.endDate) continue; // a line with no window cannot be held
      const line = lines.find((l) => l.id === lineKey(c.id, c.startDate, c.endDate));
      const isBackup = !!line && line.status !== 'available'; // tight/short queue behind as backups
      const body: Record<string, unknown> = {
        // Per-line window, not the email's overall range.
        categoryId: c.id, startDate: c.startDate, endDate: c.endDate, quantity: c.quantity,
        companyId, personId: holdable.personId,
        jobId: resolved.jobId, jobName: resolved.name,
        bufferDays: 1, bufferOverride: true, isBackup,
        notes: holdNotes(),
      };
      try {
        const r = await fetch('/api/scheduling/holds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json();
        if (r.ok && j.ok) {
          created++;
          // Record which areas were asked for. Best-effort and AFTER the
          // hold: losing the area list is a note lost, losing the hold is
          // a truck lost, so a failure here must never fail the hold.
          const areaIds = areasByCat[c.id] ?? [];
          if (areaIds.length && j.bookingItem?.id) {
            try {
              await fetch(`/api/scheduling/booking-items/${j.bookingItem.id}/areas`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ areaIds }),
              });
            } catch { /* the hold stands regardless */ }
          }
        }
      } catch { /* best-effort; reported in the count */ }
    }
    const attempted = cats.filter((c) => c.startDate && c.endDate).length;
    setHoldStatus(`Created ${created} of ${attempted} soft hold${attempted === 1 ? '' : 's'} — spoken-for on the gantt.`);
  };

  const proceed = async (resolved: { jobId: string; name: string } | null, companyId: string | null) => {
    setWorking(true);
    const willHold = softHold && !!holdable && cats.length > 0 && !!resolved;
    if (willHold) await createSoftHolds(resolved!, companyId ?? holdable!.companyId);
    // The email only mentions a hold when one was actually placed — the
    // claim follows the action rather than the checkbox.
    setReviewTarget({ kind: 'quick-reply', payload: buildPayload(willHold ? holdWindow() : null) });
    setWorking(false);
  };

  const reviewAndSend = () => {
    if (!recipientEmail) return;
    // Soft holds need a Job (Job-as-root). If the agent hasn't resolved
    // one yet, open the resolver — the send continues from onJobResolved.
    if (softHold && holdable && cats.length > 0 && !job) {
      setResolverOpen(true);
      return;
    }
    void proceed(job, holdable?.companyId ?? null);
  };

  const onJobResolved = (r: ResolvedJob) => {
    const resolved = { jobId: r.id, jobCode: r.jobCode, name: r.name };
    setJob(resolved);
    // The Job is the root object: if the agent attached to a Job under a
    // different company, the holds follow the Job's company (the holds
    // route rejects a job/company mismatch).
    const companyId = r.companyId ?? holdable?.companyId ?? null;
    if (holdable && companyId && holdable.companyId !== companyId) {
      setHoldable({ ...holdable, companyId });
    }
    // Keep the reply copy in sync with the Job the holds actually live in.
    setJobName(r.name);
    // Email-in-Job: file this thread in the resolved Job (fill-only —
    // a thread an operator already filed elsewhere is left alone).
    if (threadId) {
      void fetch(`/api/email-threads/${encodeURIComponent(threadId)}/job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: r.id, onlyIfUnfiled: true }),
      }).catch(() => {});
    }
    setResolverOpen(false);
    void proceed(resolved, companyId);
  };

  if (resolverOpen) {
    return (
      <JobResolverModal
        context={{
          companyId: holdable?.companyId ?? null,
          companyName: clientName?.trim() || null,
          contactEmail: recipientEmail || null,
          // Same list that seeds the reply's CC — the Job gets the people
          // the client actually looped in, not just the sender.
          ccContactEmails: inboundCc,
          contactName: recipientName || null,
          jobNameHint: jobName?.trim() || null,
          dates: pickup && ret ? { start: pickup.slice(0, 10), end: ret.slice(0, 10) } : null,
          threadId: threadId ?? null,
          sourceRef: 'sales:quick-reply',
        }}
        onResolved={onJobResolved}
        onClose={() => setResolverOpen(false)}
      />
    );
  }

  if (reviewTarget) {
    return (
      <EmailReviewModal
        initialCc={inboundCc}
        target={reviewTarget}
        onClose={() => setReviewTarget(null)}
        onSent={() => { onSent?.(); onClose(); }}
      />
    );
  }

  const fmt = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between px-5 py-3.5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Quick Reply</h2>
            <p className="text-[11px] text-gray-400">Confirm availability &amp; reply — no quote yet</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </header>

        <div className="px-5 py-4 space-y-4">
          {phase === 'parsing' && <div className="text-sm text-gray-500 py-6 text-center">Reading the email…</div>}
          {phase === 'error' && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">{errMsg}</div>}

          {phase === 'ready' && (
            <>
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="relative">
                    <label className="block text-[10px] uppercase tracking-wide text-gray-400 font-bold mb-1">Production company</label>
                    <input
                      value={clientName ?? ''}
                      onChange={(e) => setClientName(e.target.value)}
                      onFocus={() => { if (companyHits.length && !matchedCompanyId) setCompanyOpen(true); }}
                      placeholder="e.g. Golden Heart Films"
                      className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-[12px] text-gray-800 placeholder-gray-300 focus:outline-none focus:border-gray-400"
                    />
                    {matchedCompanyId ? (
                      <div className="mt-1 text-[10px] text-emerald-700">✓ Matched a client we already have</div>
                    ) : (clientName ?? '').trim().length >= 2 ? (
                      <div className="mt-1 text-[10px] text-gray-400">New client — not in the CRM yet</div>
                    ) : null}
                    {companyOpen && companyHits.length > 0 && (
                      <div className="absolute z-20 left-0 right-0 top-[52px] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                        {companyHits.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              adoptedName.current = c.name;
                              setClientName(c.name);
                              setMatchedCompanyId(c.id);
                              setCompanyOpen(false);
                            }}
                            className="block w-full text-left px-2.5 py-1.5 text-[12px] text-gray-800 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                          >
                            {c.name}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setCompanyOpen(false)}
                          className="block w-full text-left px-2.5 py-1 text-[10px] text-gray-500 hover:bg-gray-50"
                        >
                          Keep &ldquo;{clientName}&rdquo; as a new client
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <label className="block text-[10px] uppercase tracking-wide text-gray-400 font-bold mb-1">Project / job name</label>
                    <input
                      value={jobName ?? ''}
                      onChange={(e) => setJobName(e.target.value)}
                      onFocus={() => { if (jobHits.length && !job) setJobOpen(true); }}
                      placeholder="e.g. Neon Nights"
                      className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-[12px] text-gray-800 placeholder-gray-300 focus:outline-none focus:border-gray-400"
                    />
                    {job ? (
                      <div className="mt-1 text-[10px] text-emerald-700">
                        ✓ Existing job {job.jobCode} — holds land here
                      </div>
                    ) : (jobName ?? '').trim().length >= 2 ? (
                      <div className="mt-1 text-[10px] text-gray-400">New project — a job gets created</div>
                    ) : null}
                    {jobOpen && jobHits.length > 0 && (
                      <div className="absolute z-20 left-0 right-0 top-[52px] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                        {jobHits.map((j) => (
                          <button
                            key={j.id}
                            type="button"
                            onClick={() => {
                              adoptedJobName.current = j.name;
                              setJobName(j.name);
                              setJob({ jobId: j.id, jobCode: j.jobCode, name: j.name });
                              // Attaching to a job under a different company
                              // moves the company too — the Job is the root,
                              // and holds follow it (same rule onJobResolved
                              // applies when the resolver is used instead).
                              if (j.companyId && j.companyId !== matchedCompanyId) {
                                setMatchedCompanyId(j.companyId);
                                if (j.companyName) {
                                  adoptedName.current = j.companyName;
                                  setClientName(j.companyName);
                                }
                              }
                              setJobOpen(false);
                            }}
                            className="block w-full text-left px-2.5 py-1.5 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                          >
                            <span className="text-[12px] text-gray-800">{j.name}</span>
                            <span className="block text-[10px] text-gray-400">
                              <span className="font-mono">{j.jobCode}</span>
                              {j.companyName ? ` · ${j.companyName}` : ''} · {j.status.toLowerCase()}
                            </span>
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setJobOpen(false)}
                          className="block w-full text-left px-2.5 py-1 text-[10px] text-gray-500 hover:bg-gray-50"
                        >
                          Keep &ldquo;{jobName}&rdquo; as a new project
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {/* Ask only for the field(s) we don't have. Hidden entirely
                    when both are filled — there's nothing to ask. The label
                    names exactly what the reply will request. */}
                {(() => {
                  // A provisional "(company TBC)" placeholder is a company
                  // in the schema but not in reality — treat it as missing
                  // so the reply still asks, which is the whole point of
                  // letting the Job be created without one.
                  const companyMissing = !clientName?.trim() || isProvisionalCompanyName(clientName);
                  const jobMissing = !jobName?.trim();
                  if (!companyMissing && !jobMissing) return null;
                  const askField =
                    companyMissing && jobMissing
                      ? 'production company & project name'
                      : companyMissing
                        ? 'production company'
                        : 'project name';
                  return (
                    <label className="flex items-start gap-2 text-[12px] text-gray-700 cursor-pointer select-none">
                      <input type="checkbox" checked={askForDetails} onChange={(e) => setAskForDetails(e.target.checked)} className="mt-0.5 accent-emerald-600" />
                      <span>Ask the client for their {askField} in the reply<span className="text-gray-400"> — we don&apos;t have {companyMissing && jobMissing ? 'these' : 'this'} yet</span></span>
                    </label>
                  );
                })()}
                <div className="text-[12px] text-gray-700 pt-0.5 border-t border-gray-200">
                  <div><span className="text-gray-400">Dates</span> · {fmt(pickup)} – {fmt(ret)}</div>
                  <div className="relative flex items-baseline gap-1.5">
                    <span className="text-gray-400 shrink-0">Reply to</span>
                    <span className="text-gray-400 shrink-0">·</span>
                    <span className="flex-1 min-w-0">
                      <input
                        value={contactQuery}
                        onChange={(e) => setContactQuery(e.target.value)}
                        onFocus={() => { if (contactHits.length && !parsedPersonId) setContactOpen(true); }}
                        placeholder="name or email"
                        className="w-full bg-transparent border-b border-dashed border-gray-300 focus:border-gray-500 focus:outline-none text-[12px] font-mono text-gray-700 placeholder-gray-300 py-0.5"
                      />
                      {parsedPersonId ? (
                        <span className="block text-[10px] text-emerald-700 mt-0.5">
                          ✓ {recipientName ? `${recipientName} — ` : ''}linked to their contact record
                        </span>
                      ) : contactQuery.trim() && !contactQuery.includes('@') ? (
                        <span className="block text-[10px] text-amber-700 mt-0.5">
                          Pick a contact, or type a full email address to reply to
                        </span>
                      ) : null}
                      {contactOpen && contactHits.length > 0 && (
                        <span className="absolute z-20 left-0 right-0 top-[26px] block bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                          {contactHits.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                adoptedContact.current = c.email;
                                setContactQuery(c.email);
                                setRecipientEmail(c.email);
                                setRecipientName(c.name);
                                setParsedPersonId(c.id);
                                // Their affiliated company fills the other
                                // half of the hold gate when we don't have
                                // one yet. An already-matched company is
                                // left alone — the agent chose it.
                                if (c.companyId && !matchedCompanyId) {
                                  setMatchedCompanyId(c.companyId);
                                  if (c.companyName) {
                                    adoptedName.current = c.companyName;
                                    setClientName(c.companyName);
                                  }
                                }
                                setContactOpen(false);
                              }}
                              className="block w-full text-left px-2.5 py-1.5 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                            >
                              <span className="text-[12px] text-gray-800">{c.name}</span>
                              <span className="block text-[10px] text-gray-400 font-mono">{c.email}</span>
                              {c.companyName && <span className="block text-[10px] text-gray-400">{c.companyName}</span>}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => setContactOpen(false)}
                            className="block w-full text-left px-2.5 py-1 text-[10px] text-gray-500 hover:bg-gray-50"
                          >
                            Keep &ldquo;{contactQuery}&rdquo; as the reply address
                          </button>
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Editable hold lines. The parser seeds these; the agent adds,
                  removes and re-dates them. Each row carries its own window,
                  and availability is checked against THAT window. */}
              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">Equipment to hold</div>
                  {cats.length === 0 && (
                    <span className="text-[11px] text-gray-400">nothing detected — add below</span>
                  )}
                </div>

                {cats.length > 0 && (
                  <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-2">
                    {cats.map((c, i) => {
                      const l = lines.find((x) => x.id === lineKey(c.id, c.startDate, c.endDate));
                      const noDates = !c.startDate || !c.endDate;
                      const badRange = !noDates && c.endDate < c.startDate;
                      return (
                        <li key={`${c.id}-${i}`} className="px-3 py-2 text-[12px]">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-gray-800 font-medium flex-1 min-w-[140px]">{c.name}</span>
                            <label className="flex items-center gap-1 text-gray-400">
                              <span className="text-[10px] uppercase">Qty</span>
                              <input
                                type="number" min={1} max={99} value={c.quantity}
                                onChange={(e) => updateCat(i, { quantity: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
                                className="w-14 border border-gray-300 rounded px-1.5 py-1 text-gray-800 text-[12px] focus:outline-none focus:border-emerald-500"
                              />
                            </label>
                            <input
                              type="date" value={c.startDate} aria-label={`${c.name} start date`}
                              onChange={(e) => updateCat(i, { startDate: e.target.value })}
                              className="border border-gray-300 rounded px-1.5 py-1 text-gray-800 text-[12px] focus:outline-none focus:border-emerald-500"
                            />
                            <span className="text-gray-400">–</span>
                            <input
                              type="date" value={c.endDate} min={c.startDate || undefined} aria-label={`${c.name} end date`}
                              onChange={(e) => updateCat(i, { endDate: e.target.value })}
                              className="border border-gray-300 rounded px-1.5 py-1 text-gray-800 text-[12px] focus:outline-none focus:border-emerald-500"
                            />
                            <button
                              type="button" onClick={() => removeCat(i)} aria-label={`Remove ${c.name}`}
                              className="text-gray-300 hover:text-rose-600 px-1 text-[14px] leading-none"
                            >
                              ×
                            </button>
                          </div>
                          {isStageComplex(c.name) && stageAreas.length > 0 && (
                            <div className="mt-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2">
                              <div className="text-[11px] font-semibold text-gray-600 mb-1">
                                Which areas? <span className="font-normal text-gray-400">any or all — we confirm with the client before it&rsquo;s formally held</span>
                              </div>
                              <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                                {stageAreas.map((a) => {
                                  const picked = areasByCat[c.id] ?? [];
                                  const on = picked.includes(a.id);
                                  return (
                                    <label key={a.id} className="flex items-center gap-1.5 text-[12px] text-gray-700 cursor-pointer select-none">
                                      <input
                                        type="checkbox" checked={on} className="accent-emerald-600"
                                        onChange={(e) => setAreasByCat((m) => {
                                          const cur = m[c.id] ?? [];
                                          return { ...m, [c.id]: e.target.checked ? [...cur, a.id] : cur.filter((x) => x !== a.id) };
                                        })}
                                      />
                                      {a.name}
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-2">
                            {badRange ? (
                              <span className="text-[11px] text-rose-600">End date is before the start date.</span>
                            ) : noDates ? (
                              <span className="text-[11px] text-amber-700">Set both dates — this line won&rsquo;t be held without them.</span>
                            ) : l ? (
                              <>
                                <span className="text-gray-400 text-[11px]">{l.availableToHold} of {l.serviceableCount} open</span>
                                <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded border ${STATUS_PILL[l.status]}`}>{STATUS_LABEL[l.status]}</span>
                              </>
                            ) : (
                              <span className="text-gray-400 text-[11px]">checking availability…</span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <select
                  value={addingId}
                  onChange={(e) => { setAddingId(e.target.value); if (e.target.value) addCat(e.target.value); }}
                  aria-label="Add equipment to the hold"
                  className="w-full border border-dashed border-gray-300 rounded-lg px-2.5 py-2 text-[12px] text-gray-600 bg-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="">+ Add equipment to hold…</option>
                  {pickCats.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {cats.length === 0 && (
                  <div className="text-[11px] text-gray-400 mt-1">
                    With nothing here the reply just asks the client for their item list.
                  </div>
                )}
              </div>

              {/* Riding along — supplies / small gear orders that travel on
                  the vehicle. Not held (nothing to reserve against), but
                  named in the reply and written onto the hold's notes. */}
              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">On the vehicle</div>
                  <span className="text-[11px] text-gray-400">straps, pads, a small gear order</span>
                </div>

                {supplies.length > 0 && (
                  <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-2">
                    {supplies.map((sup, i) => (
                      <li key={sup.key} className="px-3 py-2 text-[12px] flex items-center gap-2">
                        <span className="text-gray-800 font-medium flex-1 min-w-[140px]">{sup.name}</span>
                        <label className="flex items-center gap-1 text-gray-400">
                          <span className="text-[10px] uppercase">Qty</span>
                          <input
                            type="number" min={1} max={999} value={sup.quantity}
                            aria-label={`${sup.name} quantity`}
                            onChange={(e) => {
                              const q = Math.max(1, Math.min(999, Number(e.target.value) || 1));
                              setSupplies((prev) => prev.map((x, xi) => (xi === i ? { ...x, quantity: q } : x)));
                            }}
                            className="w-16 border border-gray-300 rounded px-1.5 py-1 text-gray-800 text-[12px] focus:outline-none focus:border-emerald-500"
                          />
                        </label>
                        <button
                          type="button" aria-label={`Remove ${sup.name}`}
                          onClick={() => setSupplies((prev) => prev.filter((_, xi) => xi !== i))}
                          className="text-gray-300 hover:text-rose-600 px-1 text-[14px] leading-none"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="relative">
                  <input
                    value={supplyQuery}
                    onChange={(e) => setSupplyQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        // Free text is a legitimate answer — the client's own
                        // words on the hold beat waiting for a catalog code.
                        addSupply(supplyQuery, null);
                      }
                    }}
                    placeholder="+ Add supplies or gear on the vehicle…"
                    aria-label="Add supplies or gear that ride on the vehicle"
                    className="w-full border border-dashed border-gray-300 rounded-lg px-2.5 py-2 text-[12px] text-gray-700 placeholder-gray-400 bg-white focus:outline-none focus:border-emerald-500"
                  />
                  {supplyOpen && supplyHits.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 top-[38px] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                      {supplyHits.map((h) => (
                        <button
                          key={h.id}
                          type="button"
                          onClick={() => addSupply(h.description, h.id)}
                          className="block w-full text-left px-2.5 py-1.5 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                        >
                          <span className="text-[12px] text-gray-800">{h.description}</span>
                          <span className="block text-[10px] text-gray-400 font-mono">{h.code}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => addSupply(supplyQuery, null)}
                        className="block w-full text-left px-2.5 py-1 text-[10px] text-gray-500 hover:bg-gray-50"
                      >
                        Add &ldquo;{supplyQuery}&rdquo; as typed
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-[10px] text-gray-400">Common:</span>
                  {['ratchet strap', 'furniture pad'].map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setSupplyQuery(q)}
                      className="text-[10px] text-gray-600 border border-gray-200 rounded-full px-2 py-0.5 hover:border-emerald-400 hover:text-emerald-700"
                    >
                      {q}s
                    </button>
                  ))}
                </div>
                {supplies.length > 0 && (
                  <div className="text-[11px] text-gray-400 mt-1">
                    Named in the reply and noted on the hold — these aren&rsquo;t reserved units, so nothing is held against them.
                  </div>
                )}
              </div>

              <label className={`flex items-start gap-2 text-[12px] ${holdable && cats.length > 0 ? 'text-gray-700 cursor-pointer' : 'text-gray-400 cursor-not-allowed'} select-none`}>
                <input type="checkbox" checked={softHold && cats.length > 0} disabled={!holdable || cats.length === 0} onChange={(e) => setSoftHold(e.target.checked)} className="mt-0.5 accent-emerald-600" />
                <span>
                  Create soft holds so these show as spoken-for on the gantt until the client confirms.
                  {holdable && cats.length > 0 && (
                    <span className="block text-[11px] text-gray-400 mt-0.5">
                      The reply will tell them their equipment is set aside for these dates — without naming units.
                    </span>
                  )}
                  {!holdable && <span className="block text-[11px] text-gray-400 mt-0.5">Unavailable — add the client &amp; contact to the CRM first.</span>}
                  {holdable && cats.length === 0 && <span className="block text-[11px] text-gray-400 mt-0.5">Add equipment above first.</span>}
                </span>
              </label>

              {softHold && holdable && cats.length > 0 && (
                <div className="text-[12px] pl-6 -mt-2">
                  {job ? (
                    <span className="text-gray-700">
                      Holds go into <span className="font-mono text-[11px] text-gray-500">[{job.jobCode}]</span>{' '}
                      <span className="font-medium">{job.name}</span>
                      <button type="button" onClick={() => setResolverOpen(true)} className="ml-2 text-[11px] font-medium text-emerald-700 hover:text-emerald-800">
                        Change
                      </button>
                    </span>
                  ) : (
                    <span className="text-gray-400">
                      You&rsquo;ll pick or create the Job for these holds when you hit send — we check for an existing Job on this shoot first.
                    </span>
                  )}
                </div>
              )}

              {holdStatus && <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2.5 py-1.5">{holdStatus}</div>}
            </>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-gray-500 hover:text-gray-800 text-sm font-medium">Cancel</button>
          <button
            onClick={reviewAndSend}
            disabled={phase !== 'ready' || !recipientEmail || working}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-300 text-white text-sm font-bold rounded-lg"
          >
            {working ? 'Preparing…' : 'Review & send reply →'}
          </button>
        </footer>
      </div>
    </div>
  );
}
