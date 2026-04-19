"use client";

import { useState, useEffect } from "react";

const JOB_ROLES = ["PRODUCER", "PM", "PC", "TRANSPO", "ACCOUNTING", "OTHER"] as const;
const PRODUCTION_TYPES = [
  "FILM",
  "TV",
  "COMMERCIAL",
  "MUSIC_VIDEO",
  "CORPORATE",
  "EVENT_PLANNER",
  "OTHER",
] as const;

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface ContactRow {
  person: Person | null;
  query: string;
  results: Person[];
  searching: boolean;
  role: string;
  isPrimary: boolean;
}

interface NewJobModalProps {
  open: boolean;
  onClose: () => void;
  companyId: string;
  companyName: string;
  currentUserId: string;
  onCreated: (job: { id: string; jobCode: string; name: string }) => void;
}

const emptyContactRow = (role = "OTHER", isPrimary = false): ContactRow => ({
  person: null,
  query: "",
  results: [],
  searching: false,
  role,
  isPrimary,
});

export function NewJobModal({
  open,
  onClose,
  companyId,
  companyName,
  currentUserId,
  onCreated,
}: NewJobModalProps) {
  const [name, setName] = useState("");
  const [productionType, setProductionType] = useState<string>("OTHER");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [notes, setNotes] = useState("");
  const [contacts, setContacts] = useState<ContactRow[]>([emptyContactRow("PM", true)]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setProductionType("OTHER");
      setStartDate("");
      setEndDate("");
      setEstimatedValue("");
      setNotes("");
      setContacts([emptyContactRow("PM", true)]);
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const updateRow = (i: number, patch: Partial<ContactRow>) => {
    setContacts((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  };

  const setPrimary = (i: number) => {
    setContacts((prev) => prev.map((c, idx) => ({ ...c, isPrimary: idx === i })));
  };

  const searchPersons = async (i: number, q: string) => {
    updateRow(i, { query: q });
    if (q.length < 1) {
      updateRow(i, { results: [], searching: false });
      return;
    }
    updateRow(i, { searching: true });
    try {
      const res = await fetch(`/api/persons?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      updateRow(i, { results: data.persons || [], searching: false });
    } catch {
      updateRow(i, { searching: false });
    }
  };

  const pickPerson = (i: number, p: Person) => {
    updateRow(i, { person: p, query: `${p.firstName} ${p.lastName}`, results: [] });
  };

  const clearPerson = (i: number) => {
    updateRow(i, { person: null, query: "", results: [] });
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      alert("Job name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          companyId,
          productionType,
          startDate: startDate || null,
          endDate: endDate || null,
          agentId: currentUserId,
          notes: notes || null,
          estimatedValue: estimatedValue.trim() === "" ? null : Number(estimatedValue),
          contacts: contacts
            .filter((c) => c.person)
            .map((c) => ({ personId: c.person!.id, role: c.role, isPrimary: c.isPrimary })),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create job");
      }
      const data = await res.json();
      onCreated(data.job);
      onClose();
    } catch (err: unknown) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Failed to create job");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-zinc-800">
          <h2 className="text-xl font-semibold text-white">New Job</h2>
          <p className="text-sm text-zinc-500 mt-1">Company: {companyName}</p>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Job Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Untitled Pilot Season 1"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1">Production Type</label>
              <select
                value={productionType}
                onChange={(e) => setProductionType(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-500"
              >
                {PRODUCTION_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace("_", " ")}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1">Status</label>
              <input type="text" value="QUOTED" disabled className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-800 rounded-lg text-sm text-zinc-500" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">
              Estimated Value <span className="text-zinc-600 font-normal">(optional, USD)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">$</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={estimatedValue}
                onChange={(e) => setEstimatedValue(e.target.value)}
                placeholder="e.g., 25000"
                className="w-full pl-7 pr-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-500"
              />
            </div>
            <p className="text-xs text-zinc-600 mt-1">Used on the pipeline board before any orders exist.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1">Start Date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1">End Date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-500" />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-zinc-400">Contacts</label>
              <button type="button" onClick={() => setContacts([...contacts, emptyContactRow()])} className="text-xs text-amber-500 hover:text-amber-400">
                + Add another
              </button>
            </div>
            <div className="space-y-2">
              {contacts.map((c, i) => (
                <div key={i} className="bg-zinc-800/50 border border-zinc-800 rounded-lg p-3 space-y-2">
                  <div className="relative">
                    {c.person ? (
                      <div className="flex items-center justify-between bg-zinc-800 border border-zinc-700 rounded px-3 py-2">
                        <div className="text-sm text-white">
                          {c.person.firstName} {c.person.lastName}{" "}
                          <span className="text-zinc-500 text-xs">({c.person.email})</span>
                        </div>
                        <button type="button" onClick={() => clearPerson(i)} className="text-xs text-zinc-500 hover:text-zinc-300">Change</button>
                      </div>
                    ) : (
                      <>
                        <input type="text" value={c.query} onChange={(e) => searchPersons(i, e.target.value)} placeholder="Search by name or email..." className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-white focus:outline-none focus:border-zinc-500" />
                        {c.query.length > 0 && (c.results.length > 0 || c.searching) && (
                          <div className="absolute z-10 left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                            {c.searching ? (
                              <div className="px-3 py-2 text-xs text-zinc-500">Searching...</div>
                            ) : (
                              c.results.map((p) => (
                                <button key={p.id} type="button" onClick={() => pickPerson(i, p)} className="w-full text-left px-3 py-2 text-sm text-white hover:bg-zinc-700">
                                  {p.firstName} {p.lastName}{" "}
                                  <span className="text-zinc-500 text-xs">({p.email})</span>
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <select value={c.role} onChange={(e) => updateRow(i, { role: e.target.value })} className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none focus:border-zinc-500">
                      {JOB_ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
                    </select>
                    <label className="flex items-center gap-1 text-xs text-zinc-400">
                      <input type="radio" checked={c.isPrimary} onChange={() => setPrimary(i)} />
                      Primary
                    </label>
                    {contacts.length > 1 && (
                      <button type="button" onClick={() => setContacts(contacts.filter((_, idx) => idx !== i))} className="ml-auto text-xs text-red-400 hover:text-red-300">
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-500" />
          </div>
        </div>

        <div className="p-6 border-t border-zinc-800 flex justify-end gap-3">
          <button onClick={onClose} disabled={submitting} className="px-4 py-2 text-sm text-zinc-300 border border-zinc-700 rounded-lg hover:bg-zinc-800">Cancel</button>
          <button onClick={handleSubmit} disabled={submitting} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg disabled:opacity-50">
            {submitting ? "Creating..." : "Create Job"}
          </button>
        </div>
      </div>
    </div>
  );
}
