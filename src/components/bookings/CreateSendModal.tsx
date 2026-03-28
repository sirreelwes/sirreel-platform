'use client';
import { useState, useEffect, useRef } from 'react';

const VEHICLE_TYPES = [
  'Cube Truck',
  'Cargo Van',
  'Passenger Van',
  'PopVan',
  'Restroom Trailer',
  'Walkies',
  'Production Supplies',
  'Grip',
  'Electric',
];

type Props = {
  onClose: () => void;
  agentId?: string;
};

export default function CreateSendModal({ onClose, agentId }: Props) {
  // Company search
  const [companyQuery, setCompanyQuery] = useState('');
  const [companySuggestions, setCompanySuggestions] = useState<any[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<any>(null);

  // Contact search — independent of company
  const [contactQuery, setContactQuery] = useState('');
  const [contactSuggestions, setContactSuggestions] = useState<any[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<any>(null);
  const [personName, setPersonName] = useState('');
  const [personEmail, setPersonEmail] = useState('');
  const [personPhone, setPersonPhone] = useState('');

  // Contact autocomplete
  useEffect(() => {
    if (contactQuery.length < 1) { setContactSuggestions([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/persons?q=${encodeURIComponent(contactQuery)}`);
      const data = await res.json();
      setContactSuggestions(data.persons || []);
    }, 200);
    return () => clearTimeout(t);
  }, [contactQuery]);

  // Job details
  const [jobName, setJobName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedVehicles, setSelectedVehicles] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  // Result
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const companyRef = useRef<HTMLDivElement>(null);

  // Company autocomplete
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
    setSelectedCompany(company);
    setCompanyQuery(company.name);
    setCompanySuggestions([]);
  };

  const toggleVehicle = (v: string) => {
    setSelectedVehicles(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  };

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const submit = async () => {
    if (!jobName || !startDate || !endDate || !personEmail) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/bookings/create-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: selectedCompany?.id,
          companyName: selectedCompany ? undefined : companyQuery,
          personId: selectedPerson?.id,
          personEmail,
          personName,
          personPhone,
          agentId,
          jobName,
          startDate,
          endDate,
          vehicleTypes: selectedVehicles,
          notes,
        })
      });
      const data = await res.json();
      if (data.ok) setResult(data);
      else alert('Error: ' + data.error);
    } finally { setSubmitting(false); }
  };

  const canSubmit = jobName && startDate && endDate && personEmail && (selectedCompany || companyQuery.length > 1);

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-4 top-[5%] bottom-[5%] sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[520px] z-50 bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <div className="text-base font-bold text-gray-900">Create & Send Portal Link</div>
            <div className="text-[11px] text-gray-400">Client will complete their details and paperwork</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-200 transition-colors text-sm">✕</button>
        </div>

        {!result ? (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-5">

              {/* Company */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 block">Production Company *</label>
                <div className="relative" ref={companyRef}>
                  <input
                    value={companyQuery}
                    onChange={e => { setCompanyQuery(e.target.value); setSelectedCompany(null); }}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-400"
                    placeholder="Type company name..."
                  />
                  {companySuggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 overflow-hidden">
                      {companySuggestions.map(c => (
                        <button key={c.id} onClick={() => selectCompany(c)}
                          className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
                          <div className="text-sm font-semibold text-gray-900">{c.name}</div>
                          {c.persons?.length > 0 && <div className="text-[10px] text-gray-400">{c.persons.length} contact{c.persons.length !== 1 ? 's' : ''} on file</div>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {selectedCompany && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-600">
                    <span>✓</span> <span className="font-semibold">{selectedCompany.name}</span> <span className="text-gray-400">— existing client</span>
                  </div>
                )}
                {companyQuery && !selectedCompany && companyQuery.length > 1 && (
                  <div className="mt-1.5 text-[11px] text-blue-600">+ New company will be created</div>
                )}
              </div>

              {/* Contact */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 block">Primary Contact *</label>
                <div className="relative mb-2">
                  <input
                    value={contactQuery}
                    onChange={e => { setContactQuery(e.target.value); setSelectedPerson(null); setPersonName(e.target.value); }}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-400"
                    placeholder="Search by name or email..."
                  />
                  {contactSuggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 overflow-hidden">
                      {contactSuggestions.map(p => (
                        <button key={p.id} onClick={() => {
                          setSelectedPerson(p);
                          setContactQuery(`${p.firstName} ${p.lastName}`);
                          setPersonName(`${p.firstName} ${p.lastName}`);
                          setPersonEmail(p.email || '');
                          setPersonPhone(p.phone || '');
                          setContactSuggestions([]);
                          // Auto-fill company if not already set
                          if (!selectedCompany && p.company) {
                            setSelectedCompany(p.company);
                            setCompanyQuery(p.company.name);
                          }
                        }} className="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0">
                          <div className="text-sm font-semibold text-gray-900">{p.firstName} {p.lastName}</div>
                          <div className="text-[10px] text-gray-400">{p.email}{p.company ? ` · ${p.company.name}` : ''}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-400 mb-1 block">Phone</label>
                    <input value={personPhone} onChange={e => setPersonPhone(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400" placeholder="(310) 555-1234" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 mb-1 block">Email * (portal link)</label>
                    <input type="email" value={personEmail} onChange={e => setPersonEmail(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400" placeholder="client@company.com" />
                  </div>
                </div>
                {selectedPerson && (
                  <div className="mt-1.5 text-[11px] text-emerald-600">✓ <span className="font-semibold">{selectedPerson.firstName} {selectedPerson.lastName}</span> — existing contact</div>
                )}
              </div>

              {/* Job details */}
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
                      <label className="text-[10px] text-gray-400 mb-1 block">End Date *</label>
                      <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Vehicles */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 block">Vehicles / Equipment</label>
                <div className="grid grid-cols-3 gap-2">
                  {VEHICLE_TYPES.map(v => (
                    <button key={v} onClick={() => toggleVehicle(v)}
                      className={`px-3 py-2 rounded-xl border text-center transition-all text-[12px] font-semibold ${selectedVehicles.includes(v) ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
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
              <p className="text-center text-[10px] text-gray-400 mt-2">Client will receive a link to complete their details and paperwork</p>
            </div>
          </>
        ) : (
          /* Success state */
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="text-4xl mb-4">🎉</div>
            <div className="text-lg font-bold text-gray-900 mb-1">Booking Created!</div>
            <div className="text-sm text-gray-500 mb-2">{result.booking?.bookingNumber} · {jobName}</div>

            <div className="w-full space-y-3 mt-4">
              {/* Portal link */}
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">📋 Paperwork Portal Link</div>
                <div className="text-[11px] text-gray-600 font-mono truncate mb-2">{result.portalUrl}</div>
                <div className="flex gap-2">
                  <button onClick={() => copy(result.portalUrl, 'portal')}
                    className={`flex-1 py-2 rounded-lg text-[12px] font-semibold transition-colors ${copied === 'portal' ? 'bg-emerald-600 text-white' : 'bg-gray-900 text-white hover:bg-gray-700'}`}>
                    {copied === 'portal' ? '✓ Copied!' : 'Copy Link'}
                  </button>
                  <a href={`mailto:${personEmail}?subject=SirReel Rental Paperwork - ${jobName}&body=Hi ${personName.split(' ')[0]},%0A%0APlease complete your rental paperwork here:%0A%0A${result.portalUrl}%0A%0AThanks,%0ASirReel Studio Services`}
                    className="flex-1 py-2 rounded-lg text-[12px] font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors text-center">
                    Send Email
                  </a>
                </div>
              </div>

              {/* Client dashboard link */}
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">🏠 Client Dashboard Link</div>
                <div className="text-[11px] text-gray-600 font-mono truncate mb-2">{result.clientUrl}</div>
                <button onClick={() => copy(result.clientUrl, 'client')}
                  className={`w-full py-2 rounded-lg text-[12px] font-semibold transition-colors ${copied === 'client' ? 'bg-emerald-600 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                  {copied === 'client' ? '✓ Copied!' : 'Copy Dashboard Link'}
                </button>
              </div>

              <p className="text-[11px] text-gray-400">Send the Portal Link to the client to complete paperwork. Share the Dashboard Link for them to track everything.</p>
            </div>

            <button onClick={onClose} className="mt-4 text-sm text-gray-500 hover:text-gray-700">Close</button>
          </div>
        )}
      </div>
    </>
  );
}
