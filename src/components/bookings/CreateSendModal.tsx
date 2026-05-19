'use client';
import { useState, useEffect, useRef } from 'react';
import { ContactPicker, EMPTY_CONTACT_PICKER_VALUE, type ContactPickerValue } from '@/components/shared/ContactPicker';
import { formatPhone } from '@/lib/format/phone';

const VEHICLE_TYPES = [
  'Cube Truck', 'Cargo Van', 'Passenger Van', 'PopVan',
  'Restroom Trailer', 'Walkies', 'Production Supplies', 'Grip', 'Electric',
];

const STAGE_SETS = [
  { id: 'hospital', label: 'Hospital Set' },
  { id: 'morgue', label: 'Morgue / Laboratory' },
  { id: 'police', label: 'Police Station / Jail' },
];

type Props = { onClose: () => void; agentId?: string; agentName?: string; };

export default function CreateSendModal({ onClose, agentId, agentName }: Props) {
  const [companyQuery, setCompanyQuery] = useState('');
  const [companySuggestions, setCompanySuggestions] = useState<any[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<any>(null);
  // Primary contact is managed by the shared ContactPicker. The picker
  // tracks mode (searching / selected_existing / creating_new), the
  // selected personId (if any), and the name/phone/email payload. When
  // mode === 'selected_existing' the phone/email come from CRM and are
  // shown read-only; in creating_new they're editable and a new Person
  // row is created at /api/bookings/create-send submit time.
  const [contact, setContact] = useState<ContactPickerValue>(EMPTY_CONTACT_PICKER_VALUE);
  const [jobName, setJobName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Rental categories — multi-select. The system derives the
  // (legacy-named) contractType from this set: any of gear/vehicles
  // requires a Rental Agreement; stage requires a Stage Contract; the
  // intersection produces contractType='both' so the API generates
  // both contracts. Replaces the old single-select 'vehicles'|'stage'|
  // 'both' button group.
  type Category = 'gear' | 'stage' | 'vehicles';
  const [categories, setCategories] = useState<Set<Category>>(new Set());
  const toggleCategory = (c: Category) => {
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };
  const hasStage = categories.has('stage');
  const hasRentalSide = categories.has('gear') || categories.has('vehicles');
  const contractType: 'vehicles' | 'stage' | 'both' | '' = hasStage && hasRentalSide
    ? 'both'
    : hasStage
      ? 'stage'
      : hasRentalSide
        ? 'vehicles'
        : '';

  // Vehicle fields
  const [selectedVehicles, setSelectedVehicles] = useState<string[]>([]);

  // Stage fields
  const [stageSets, setStageSets] = useState<string[]>([]);
  const [stagePrelitSets, setStagePrelitSets] = useState<string[]>([]);
  const [stageRatePerDay, setStageRatePerDay] = useState('');
  const [stageOtRate, setStageOtRate] = useState('300');
  const [stagePrepDays, setStagePrepDays] = useState('');
  const [stageShootDays, setStageShootDays] = useState('');
  const [stageStrikeDays, setStageStrikeDays] = useState('');
  const [stageDarkDays, setStageDarkDays] = useState('');
  const [stageLighting, setStageLighting] = useState('');
  const [stageGrip, setStageGrip] = useState('');
  const [stageTruckParking, setStageTruckParking] = useState('');
  const [stageCrewParking, setStageCrewParking] = useState('');
  const [stageNotes, setStageNotes] = useState('');

  const companyRef = useRef<HTMLDivElement>(null);

  // Contact-typeahead useEffect removed — ContactPicker owns its own
  // debounced /api/persons search now. When the user picks an existing
  // CRM contact, the picker also surfaces the linked company; the
  // useEffect below auto-fills the company field with it.
  useEffect(() => {
    if (contact.mode === 'selected_existing' && contact.company && !selectedCompany) {
      setSelectedCompany(contact.company);
      setCompanyQuery(contact.company.name);
    }
  }, [contact.mode, contact.company, selectedCompany]);

  useEffect(() => {
    if (companyQuery.length < 1) { setCompanySuggestions([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/companies?q=${encodeURIComponent(companyQuery)}`);
      const data = await res.json();
      setCompanySuggestions(data.companies || []);
    }, 200);
    return () => clearTimeout(t);
  }, [companyQuery]);

  const selectCompany = (company: any) => {
    setSelectedCompany(company); setCompanyQuery(company.name); setCompanySuggestions([]);
  };
  const toggleVehicle = (v: string) => setSelectedVehicles(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  const toggleSet = (id: string) => setStageSets(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const togglePrelit = (id: string) => setStagePrelitSets(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const copy = (text: string, key: string) => { navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 2000); };

  const showVehicles = hasRentalSide;
  const showStage = hasStage;

  const submit = async () => {
    if (!jobName || !startDate || !contact.email || !contractType) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/bookings/create-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: selectedCompany?.id,
          companyName: selectedCompany ? undefined : companyQuery,
          // personId is set only when the user picked an existing CRM
          // contact. When mode === 'creating_new', the API creates a new
          // Person row from personName / personEmail / personPhone.
          personId: contact.personId,
          personEmail: contact.email,
          personName: contact.name,
          personPhone: contact.phone,
          agentId, jobName, startDate, endDate,
          // contractType is derived client-side from `categories` so the
          // legacy API contract stays unchanged. `categories` is also sent
          // so the backend (or future analytics) has the raw selection.
          contractType,
          categories: Array.from(categories),
          vehicleTypes: selectedVehicles,
          notes,
          stageDetails: showStage ? {
            sets: stageSets,
            prelitSets: stagePrelitSets,
            ratePerDay: stageRatePerDay,
            otRate: stageOtRate,
            prepDays: stagePrepDays,
            shootDays: stageShootDays,
            strikeDays: stageStrikeDays,
            darkDays: stageDarkDays,
            lighting: stageLighting,
            grip: stageGrip,
            truckParking: stageTruckParking,
            crewParking: stageCrewParking,
            notes: stageNotes,
          } : null,
        })
      });
      const data = await res.json();
      if (data.ok) setResult(data);
      else alert('Error: ' + data.error);
    } finally { setSubmitting(false); }
  };

  const contactReady =
    contact.mode === 'selected_existing'
      ? !!contact.email
      : contact.mode === 'creating_new'
        ? !!contact.name.trim() && !!contact.email.trim()
        : false;
  const canSubmit = jobName && startDate && contactReady && contractType && (selectedCompany || companyQuery.length > 1);

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-4 top-[5%] bottom-[5%] sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[560px] z-50 bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* The small white header is only shown for the form state. The
            success state replaces it with a full-bleed dark TSX hero. */}
        {!result && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
            <div>
              <div className="text-base font-bold text-gray-900">Create & Send Portal Link</div>
              <div className="text-[11px] text-gray-400">Client will complete their details and paperwork</div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-200 text-sm">✕</button>
          </div>
        )}

        {!result ? (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-5">

              {/* Rental Categories — multi-select. At least one required. */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 block">Rental Categories *</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: 'gear', label: '🔧 Gear', help: 'Grip, electric, comms, supplies' },
                    { key: 'stage', label: '🎬 Stage', help: 'Standing Sets, LED Volume, soundstages' },
                    { key: 'vehicles', label: '🚛 Vehicles', help: 'Trucks, vans, motorhomes' },
                  ] as const).map((c) => {
                    const on = categories.has(c.key);
                    return (
                      <button
                        key={c.key}
                        onClick={() => toggleCategory(c.key)}
                        className={`py-3 px-2 rounded-xl border text-sm font-semibold transition-all flex flex-col items-center gap-0.5 ${
                          on ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-400'
                        }`}
                      >
                        <span>{c.label}</span>
                        <span className={`text-[9px] font-normal ${on ? 'text-gray-300' : 'text-gray-400'}`}>{c.help}</span>
                      </button>
                    );
                  })}
                </div>
                {categories.size > 0 && (
                  <div className="mt-2 text-[10px] text-gray-500">
                    Generates:{' '}
                    {hasRentalSide && <span className="font-semibold text-gray-700">Rental Agreement</span>}
                    {hasRentalSide && hasStage && <span> + </span>}
                    {hasStage && <span className="font-semibold text-gray-700">Stage Contract</span>}
                  </div>
                )}
              </div>

              {/* Company */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 block">Production Company *</label>
                <div className="relative" ref={companyRef}>
                  <input value={companyQuery} onChange={e => { setCompanyQuery(e.target.value); setSelectedCompany(null); }}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-400" placeholder="Type company name..." />
                  {companySuggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 overflow-hidden">
                      {companySuggestions.map(c => (
                        <button key={c.id} onClick={() => selectCompany(c)} className="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0">
                          <div className="text-sm font-semibold text-gray-900">{c.name}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {selectedCompany && <div className="mt-1.5 text-[11px] text-emerald-600">✓ <span className="font-semibold">{selectedCompany.name}</span> — existing client</div>}
                {companyQuery && !selectedCompany && companyQuery.length > 1 && <div className="mt-1.5 text-[11px] text-blue-600">+ New company will be created</div>}
              </div>

              {/* Contact */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 block">Primary Contact *</label>
                <div className="text-[10px] text-gray-400 -mt-1 mb-2">
                  The client&rsquo;s representative — not a SirReel staff member.
                </div>
                <div className="mb-2">
                  <ContactPicker value={contact} onChange={setContact} />
                </div>
                {/* Phone + email — read-only when the contact was pulled from
                    CRM (mode='selected_existing'), editable otherwise. The
                    "Change" button on the picker pill returns the form to
                    searching mode so the rep can re-pick or create new. */}
                {contact.mode !== 'searching' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-400 mb-1 block">
                        Phone {contact.mode === 'selected_existing' && <span className="text-emerald-600">· from CRM</span>}
                      </label>
                      <input
                        value={contact.phone}
                        readOnly={contact.mode === 'selected_existing'}
                        onChange={(e) => setContact({ ...contact, phone: formatPhone(e.target.value) })}
                        className={`w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400 ${
                          contact.mode === 'selected_existing' ? 'bg-gray-50 text-gray-600 cursor-not-allowed' : ''
                        }`}
                        placeholder="(310) 555-1234"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400 mb-1 block">
                        Email * (portal link) {contact.mode === 'selected_existing' && <span className="text-emerald-600">· from CRM</span>}
                      </label>
                      <input
                        type="email"
                        value={contact.email}
                        readOnly={contact.mode === 'selected_existing'}
                        onChange={(e) => setContact({ ...contact, email: e.target.value })}
                        className={`w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400 ${
                          contact.mode === 'selected_existing' ? 'bg-gray-50 text-gray-600 cursor-not-allowed' : ''
                        }`}
                        placeholder="client@company.com"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Job Details */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 block">Job Details</label>
                <div className="space-y-2">
                  <input value={jobName} onChange={e => setJobName(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-400" placeholder="Production / Job name *" />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-400 mb-1 block">Start Date *</label>
                      <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400 mb-1 block">End Date (optional)</label>
                      <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Vehicle Section */}
              {showVehicles && (
                <div>
                  <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 block">Vehicles / Equipment</label>
                  <div className="grid grid-cols-3 gap-2">
                    {VEHICLE_TYPES.map(v => (
                      <button key={v} onClick={() => toggleVehicle(v)}
                        className={`px-3 py-2 rounded-xl border text-center text-[12px] font-semibold transition-all ${selectedVehicles.includes(v) ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Stage Section */}
              {showStage && (
                <div className="space-y-4 border border-gray-200 rounded-xl p-4 bg-gray-50">
                  <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">🎬 Stage Details</div>

                  {/* Sets */}
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-2 block">Standing Sets Needed</label>
                    <div className="space-y-2">
                      {STAGE_SETS.map(set => (
                        <div key={set.id} className="flex items-center justify-between p-2 bg-white rounded-lg border border-gray-200">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={stageSets.includes(set.id)} onChange={() => toggleSet(set.id)} className="accent-gray-900" />
                            <span className="text-sm text-gray-700">{set.label}</span>
                          </label>
                          {stageSets.includes(set.id) && (
                            <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
                              <input type="checkbox" checked={stagePrelitSets.includes(set.id)} onChange={() => togglePrelit(set.id)} className="accent-gray-900" />
                              Pre-lit
                            </label>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Rates */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-500 mb-1 block">Rate Per Day ($) *</label>
                      <input value={stageRatePerDay} onChange={e => setStageRatePerDay(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400 bg-white" placeholder="e.g. 3000" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 mb-1 block">OT Rate/hr ($)</label>
                      <input value={stageOtRate} onChange={e => setStageOtRate(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400 bg-white" placeholder="300" />
                    </div>
                  </div>

                  {/* Schedule */}
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-2 block">Schedule</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: 'Prep Days', val: stagePrepDays, set: setStagePrepDays },
                        { label: 'Shoot Days', val: stageShootDays, set: setStageShootDays },
                        { label: 'Strike Days', val: stageStrikeDays, set: setStageStrikeDays },
                        { label: 'Dark Days', val: stageDarkDays, set: setStageDarkDays },
                      ].map(item => (
                        <div key={item.label}>
                          <label className="text-[10px] text-gray-500 mb-1 block">{item.label}</label>
                          <input value={item.val} onChange={e => item.set(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400 bg-white" placeholder="0" />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Rentals */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-500 mb-1 block">Lighting Provided By</label>
                      <select value={stageLighting} onChange={e => setStageLighting(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400 bg-white">
                        <option value="">Select...</option>
                        <option value="studios">Studios</option>
                        <option value="buyout">Buyout</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 mb-1 block">Grip Provided By</label>
                      <select value={stageGrip} onChange={e => setStageGrip(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400 bg-white">
                        <option value="">Select...</option>
                        <option value="studios">Studios</option>
                        <option value="buyout">Buyout</option>
                      </select>
                    </div>
                  </div>

                  {/* Parking */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-500 mb-1 block">Truck Parking Spaces</label>
                      <input value={stageTruckParking} onChange={e => setStageTruckParking(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400 bg-white" placeholder="0" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 mb-1 block">Crew Parking Spaces</label>
                      <input value={stageCrewParking} onChange={e => setStageCrewParking(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400 bg-white" placeholder="0" />
                    </div>
                  </div>

                  {/* Stage Notes */}
                  <div>
                    <label className="text-[10px] text-gray-500 mb-1 block">Stage Notes</label>
                    <textarea value={stageNotes} onChange={e => setStageNotes(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400 bg-white resize-none" rows={2} placeholder="OT policy, special requirements..." />
                  </div>
                </div>
              )}

              {/* Internal Notes */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 block">Internal Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400 resize-none" rows={2} placeholder="Any notes for the team..." />
              </div>

            </div>

            <div className="flex-shrink-0 p-5 border-t border-gray-100">
              <button onClick={submit} disabled={!canSubmit || submitting}
                className="w-full py-3.5 bg-gray-900 text-white rounded-xl font-semibold text-sm hover:bg-gray-800 disabled:opacity-40 transition-colors">
                {submitting ? 'Creating...' : 'Create Booking & Generate Link →'}
              </button>
              <p className="text-center text-[10px] text-gray-400 mt-2">Client will receive a link to complete their paperwork</p>
            </div>
          </>
        ) : (
          /* TSX-branded success view. Visual language matches the portal
             invite email template (src/lib/email/templates/portalInvite.ts):
             same dark hero (#0a0a0a), white SirReel wordmark, gold accent
             (#D4A547), serif headline, gold CTA buttons. */
          <div className="flex-1 overflow-y-auto bg-white">
            {/* Dark hero */}
            <div className="bg-[#0a0a0a] px-6 py-8 text-center relative">
              <button
                onClick={onClose}
                aria-label="Close"
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white text-sm"
              >
                ✕
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/sirreel-logo-white.png"
                alt="SirReel Studio Services"
                width={180}
                style={{ display: 'inline-block', maxWidth: 180, height: 'auto' }}
              />
              <div className="mt-3 mx-auto" style={{ width: 48, height: 2, backgroundColor: '#D4A547' }} />
              <div className="mt-3 text-[10px] tracking-[2.5px] uppercase font-semibold" style={{ color: '#D4A547' }}>
                Presents
              </div>
              <div className="mt-1 text-3xl text-white font-light tracking-[6px]">TSX</div>
            </div>

            {/* Headline */}
            <div className="px-6 pt-7 pb-2 text-center">
              <h2
                className="text-[22px] leading-tight text-[#1a1a1a]"
                style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 400 }}
              >
                Booking Created
              </h2>
              <p className="mt-2 text-[13px] text-gray-600">
                <span className="font-semibold text-gray-900">{jobName}</span> is ready. Your client&rsquo;s portal awaits.
              </p>
            </div>

            {/* Action cards */}
            <div className="px-6 py-5 space-y-3">
              <div className="bg-[#0a0a0a] rounded-xl p-5">
                <div className="text-[10px] font-bold uppercase tracking-[2px] mb-2" style={{ color: '#D4A547' }}>
                  Paperwork Portal Link
                </div>
                <div className="text-[11px] text-white/60 font-mono truncate mb-3" title={result.portalUrl}>
                  {result.portalUrl}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => copy(result.portalUrl, 'portal')}
                    className={`flex-1 py-2.5 rounded-lg text-[12px] font-semibold transition-colors ${
                      copied === 'portal' ? 'bg-emerald-500 text-[#0a0a0a]' : 'text-[#0a0a0a] hover:opacity-90'
                    }`}
                    style={copied === 'portal' ? undefined : { backgroundColor: '#D4A547' }}
                  >
                    {copied === 'portal' ? '✓ Copied' : 'Copy Link'}
                  </button>
                  <a
                    href={`mailto:${contact.email}?subject=Let's Get Started — ${jobName} | SirReel Studio Services&body=Hi ${contact.name.split(' ')[0]},%0A%0AWe are excited to take care of your team on ${jobName}!%0A%0AYou'll find your rental details, schedule, and all required paperwork in one place — just click the link below to access your Job Portal:%0A%0A${result.clientUrl}%0A%0AYou can complete the paperwork at your own pace — your progress is saved automatically, so feel free to return to this link at any time.%0A%0AThe entire team will be ready to help, but I will be your point of contact from estimate, to shoot, to final invoice!%0A%0AIf you have any questions:%0A%0A📞 (888) 477-7335%0A✉️ rentals@sirreel.com%0A%0AI look forward to working with you!%0A%0AWarmly,%0A${agentName || 'Your SirReel Team'}%0ASirReel Studio Services`}
                    className="flex-1 py-2.5 rounded-lg text-[12px] font-semibold text-center border border-white/20 text-white hover:bg-white/5"
                  >
                    Send Email
                  </a>
                </div>
              </div>

              <div className="bg-white rounded-xl p-5 border border-gray-200">
                <div className="text-[10px] font-bold uppercase tracking-[2px] mb-2 text-gray-500">
                  Client Dashboard Link
                </div>
                <div className="text-[11px] text-gray-500 font-mono truncate mb-3" title={result.clientUrl}>
                  {result.clientUrl}
                </div>
                <button
                  onClick={() => copy(result.clientUrl, 'client')}
                  className={`w-full py-2.5 rounded-lg text-[12px] font-semibold transition-colors ${
                    copied === 'client' ? 'bg-emerald-500 text-white' : 'bg-[#0a0a0a] text-white hover:bg-[#1a1a1a]'
                  }`}
                >
                  {copied === 'client' ? '✓ Copied' : 'Copy Dashboard Link'}
                </button>
              </div>

              <p className="text-[11px] text-gray-400 text-center pt-1">
                Send the Portal Link to the client to complete paperwork.
              </p>
            </div>

            {/* Footer */}
            <div className="px-6 pb-6 pt-2 text-center border-t border-gray-100">
              <button onClick={onClose} className="text-[12px] text-gray-500 hover:text-gray-800 pt-3">
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
