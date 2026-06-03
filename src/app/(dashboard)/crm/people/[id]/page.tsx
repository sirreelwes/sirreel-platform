"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { isHighRiskEmailDomain } from "@/lib/email/emailDomain";

type Activity = {
  id: string; type: string; subject: string | null; body: string;
  dueDate: string | null; completed: boolean; createdAt: string;
  agent: { id: string; name: string };
  company: { id: string; name: string } | null;
};

type Affiliation = {
  id: string;
  productionName: string | null;
  roleOnShow: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  notes: string | null;
  company: { id: string; name: string; tier: string };
};

type PersonDetail = {
  id: string;
  firstName: string; lastName: string;
  email: string;
  phone: string | null; mobile: string | null;
  role: string; tier: string;
  totalSpend: string; totalBookings: number;
  notes: string | null;
  affiliations: Affiliation[];
  activities: Activity[];
};

const TIER_STYLES: Record<string, string> = {
  VIP: "bg-chip-warn-bg text-chip-warn-fg",
  PREFERRED: "bg-cadence-booked-bg text-cadence-booked-fg",
  STANDARD: "bg-chip-neutral-bg text-chip-neutral-fg",
  NEW: "bg-chip-good-bg text-chip-good-fg",
};

const fmt = (n: string | number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n));
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "--";

export default function PersonDetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const personId = params.id as string;
  const editIntent = searchParams?.get('edit') === '1';
  const { data: session } = useSession();

  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<PersonDetail>>({});

  // Activity form
  const [actType, setActType] = useState("NOTE");
  const [actSubject, setActSubject] = useState("");
  const [actBody, setActBody] = useState("");
  const [actDueDate, setActDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  // Link company modal
  const [showLinkCompany, setShowLinkCompany] = useState(false);
  const [companySearch, setCompanySearch] = useState("");
  const [companyResults, setCompanyResults] = useState<Array<{id: string; name: string}>>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [linkProduction, setLinkProduction] = useState("");
  const [linkRole, setLinkRole] = useState("");
  const [linkIsCurrent, setLinkIsCurrent] = useState(true);

  const fetchPerson = useCallback(async () => {
    const res = await fetch(`/api/crm/people/${personId}`);
    if (!res.ok) { router.push("/crm"); return; }
    const data = await res.json();
    setPerson(data);
    setForm(data);
    setLoading(false);
  }, [personId, router]);

  useEffect(() => { fetchPerson(); }, [fetchPerson]);

  // ?edit=1 from the /crm Contacts row click opens the edit form
  // immediately so the agent doesn't have to land then hunt for the
  // "Edit" button. Runs once when both the person + the query param
  // are ready; subsequent param changes don't re-toggle edit mode
  // (the agent may have cancelled deliberately).
  const [didApplyEditIntent, setDidApplyEditIntent] = useState(false);
  useEffect(() => {
    if (didApplyEditIntent) return;
    if (!person || !editIntent) return;
    setEditing(true);
    setDidApplyEditIntent(true);
  }, [person, editIntent, didApplyEditIntent]);

  const saveEdits = async () => {
    await fetch(`/api/crm/people/${personId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setEditing(false);
    fetchPerson();
  };

  const addActivity = async () => {
    if (!actBody) return;
    setSaving(true);
    const userId = (session?.user as { id?: string })?.id;
    await fetch("/api/crm/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personId,
        agentId: userId,
        type: actType,
        subject: actSubject || null,
        body: actBody,
        dueDate: actDueDate || null,
      }),
    });
    setActSubject(""); setActBody(""); setActDueDate(""); setSaving(false);
    fetchPerson();
  };

  const completeActivity = async (id: string) => {
    await fetch(`/api/crm/activities/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    fetchPerson();
  };

  const searchCompanies = async (q: string) => {
    setCompanySearch(q);
    if (!q || q.length < 2) { setCompanyResults([]); return; }
    const res = await fetch(`/api/crm/companies?search=${encodeURIComponent(q)}`);
    const data = await res.json();
    setCompanyResults((data.companies || []).slice(0, 8));
  };

  const linkCompany = async () => {
    if (!selectedCompanyId) return;
    await fetch("/api/crm/affiliations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personId,
        companyId: selectedCompanyId,
        productionName: linkProduction || null,
        roleOnShow: linkRole || null,
        isCurrent: linkIsCurrent,
      }),
    });
    setShowLinkCompany(false);
    setCompanySearch(""); setCompanyResults([]); setSelectedCompanyId("");
    setLinkProduction(""); setLinkRole(""); setLinkIsCurrent(true);
    fetchPerson();
  };

  const removeAffiliation = async (id: string) => {
    if (!confirm("Remove this company affiliation?")) return;
    await fetch(`/api/crm/affiliations/${id}`, { method: "DELETE" });
    fetchPerson();
  };

  const deleteContact = async () => {
    if (!confirm(`Delete ${person?.firstName} ${person?.lastName}? This cannot be undone.`)) return;
    await fetch(`/api/crm/people/${personId}`, { method: "DELETE" });
    router.push("/crm");
  };

  if (loading || !person) {
    return <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)] flex items-center justify-center"><p className="text-lt-fg3">Loading...</p></div>;
  }

  return (
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1200px] mx-auto">
      <button onClick={() => router.push("/crm")} className="text-sm text-lt-fg2 hover:text-lt-fg mb-4 inline-block">&larr; Back to Clients</button>

      {/* Header */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {editing ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-lt-fg3 mb-1">First Name</label>
                    <input type="text" value={form.firstName || ""} onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                      className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg" />
                  </div>
                  <div>
                    <label className="block text-xs text-lt-fg3 mb-1">Last Name</label>
                    <input type="text" value={form.lastName || ""} onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                      className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-lt-fg3 mb-1">Email</label>
                  <input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-lt-fg3 mb-1">Office Phone</label>
                    <input type="tel" value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg" />
                  </div>
                  <div>
                    <label className="block text-xs text-lt-fg3 mb-1">Mobile</label>
                    <input type="tel" value={form.mobile || ""} onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                      className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-lt-fg3 mb-1">Role</label>
                    <select value={form.role || "OTHER"} onChange={(e) => setForm({ ...form, role: e.target.value })}
                      className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg">
                      <option value="OTHER">Other</option>
                      <option value="UPM">UPM</option>
                      <option value="PRODUCER">Producer</option>
                      <option value="LINE_PRODUCER">Line Producer</option>
                      <option value="PRODUCTION_COORDINATOR">Production Coordinator</option>
                      <option value="PRODUCTION_SUPERVISOR">Production Supervisor</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-lt-fg3 mb-1">Tier</label>
                    <select value={form.tier || "STANDARD"} onChange={(e) => setForm({ ...form, tier: e.target.value })}
                      className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg">
                      <option value="NEW">New</option>
                      <option value="STANDARD">Standard</option>
                      <option value="PREFERRED">Preferred</option>
                      <option value="VIP">VIP</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-lt-fg3 mb-1">Notes</label>
                  <textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3}
                    className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg resize-none" />
                </div>
                <div className="flex gap-2">
                  <button onClick={saveEdits} className="px-4 py-2 bg-lt-fg hover:bg-black text-white text-sm font-medium rounded-lg">Save</button>
                  <button onClick={() => { setEditing(false); setForm(person); }} className="px-4 py-2 text-lt-fg2 hover:text-lt-fg text-sm">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-2xl font-semibold text-lt-fg">{person.firstName} {person.lastName}</h1>
                  <span className={`px-2.5 py-0.5 rounded text-xs font-medium ${TIER_STYLES[person.tier]}`}>{person.tier}</span>
                  <span className="px-2 py-0.5 rounded bg-lt-inner text-xs text-lt-fg2">{person.role.replace(/_/g, " ")}</span>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-lt-fg3 text-xs">Email</span>
                    <p className="text-lt-fg mt-0.5">
                      <a href={`mailto:${person.email}`} className="hover:text-lt-fg">{person.email}</a>
                      {isHighRiskEmailDomain(person.email) && (
                        <span
                          className="ml-2 inline-block text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-chip-neutral-bg text-chip-neutral-fg whitespace-nowrap align-middle"
                          title="Apple iCloud may silently filter mail to this address — confirm receipt or use another channel."
                        >
                          iCloud — may be filtered
                        </span>
                      )}
                    </p>
                  </div>
                  <div>
                    <span className="text-lt-fg3 text-xs">Office</span>
                    <p className="text-lt-fg mt-0.5">{person.phone || "--"}</p>
                  </div>
                  <div>
                    <span className="text-lt-fg3 text-xs">Mobile</span>
                    <p className="text-lt-fg mt-0.5">{person.mobile || "--"}</p>
                  </div>
                </div>
                {person.notes && (
                  <div className="mt-4 p-3 bg-lt-inner/50 border border-lt-hairline rounded-lg">
                    <p className="text-xs text-lt-fg3 mb-1">Notes</p>
                    <p className="text-sm text-lt-fg2 whitespace-pre-wrap">{person.notes}</p>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="text-right ml-6 flex flex-col items-end gap-2">
            {!editing && (
              <div className="flex gap-2">
                <button onClick={() => setEditing(true)} className="text-xs text-lt-fg hover:text-black">Edit</button>
                <button onClick={deleteContact} className="text-xs text-chip-bad-fg hover:opacity-70">Delete</button>
              </div>
            )}
            <p className="text-2xl font-semibold text-lt-fg font-mono">{fmt(person.totalSpend)}</p>
            <p className="text-sm text-lt-fg2">{person.totalBookings} bookings</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Company History + Affiliations */}
        <div className="col-span-2 space-y-6">
          <div className="bg-lt-card border border-lt-hairline rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-lt-fg">Company & Production History</h2>
              <button onClick={() => setShowLinkCompany(true)} className="text-xs text-lt-fg hover:text-black font-medium">+ Link to Company</button>
            </div>
            {person.affiliations.length === 0 ? (
              <p className="text-lt-fg3 text-sm">No company affiliations yet. Link this person to a production company they&apos;ve worked with.</p>
            ) : (
              <div className="space-y-2">
                {person.affiliations.map((a) => (
                  <div key={a.id} className="flex items-center justify-between py-2 border-b border-lt-hairline/50 last:border-0 group">
                    <div className="flex-1 cursor-pointer" onClick={() => router.push(`/crm/${a.company.id}`)}>
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-lt-fg font-medium hover:text-lt-fg">{a.company.name}</p>
                        {a.isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-chip-good-bg text-chip-good-fg">Current</span>}
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TIER_STYLES[a.company.tier]}`}>{a.company.tier}</span>
                      </div>
                      {a.productionName && <p className="text-xs text-lt-fg2 mt-0.5">{a.productionName}</p>}
                      {a.roleOnShow && <p className="text-xs text-lt-fg3">{a.roleOnShow.replace(/_/g, " ")}</p>}
                    </div>
                    <button onClick={() => removeAffiliation(a.id)}
                      className="opacity-0 group-hover:opacity-100 text-xs text-chip-bad-fg hover:opacity-70 transition-opacity">Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Activity Feed */}
        <div className="space-y-4">
          <div className="bg-lt-card border border-lt-hairline rounded-xl p-5">
            <h2 className="text-base font-semibold text-lt-fg mb-3">Log Activity</h2>
            <div className="space-y-2">
              <select value={actType} onChange={(e) => setActType(e.target.value)}
                className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg">
                <option value="NOTE">Note</option>
                <option value="CALL">Call</option>
                <option value="EMAIL">Email</option>
                <option value="MEETING">Meeting</option>
                <option value="FOLLOW_UP">Follow-Up</option>
              </select>
              <input type="text" value={actSubject} onChange={(e) => setActSubject(e.target.value)} placeholder="Subject (optional)"
                className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg placeholder:text-lt-fg3" />
              <textarea value={actBody} onChange={(e) => setActBody(e.target.value)} placeholder="What happened?" rows={3}
                className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg placeholder:text-lt-fg3 resize-none" />
              {(actType === "FOLLOW_UP" || actType === "CALL") && (
                <input type="date" value={actDueDate} onChange={(e) => setActDueDate(e.target.value)}
                  className="w-full px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg" />
              )}
              <button onClick={addActivity} disabled={!actBody || saving}
                className="w-full py-2 bg-lt-fg hover:bg-black disabled:bg-lt-inner text-white text-sm font-medium rounded-lg transition-colors">
                {saving ? "Saving..." : "Log"}
              </button>
            </div>
          </div>

          <div className="bg-lt-card border border-lt-hairline rounded-xl p-5">
            <h2 className="text-base font-semibold text-lt-fg mb-3">Activity History</h2>
            {person.activities.length === 0 ? (
              <p className="text-lt-fg3 text-sm">No activity logged yet</p>
            ) : (
              <div className="space-y-3">
                {person.activities.map((a) => (
                  <div key={a.id} className="border-b border-lt-hairline/50 pb-3 last:border-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        a.type === "CALL" ? "bg-chip-neutral-bg text-chip-neutral-fg" :
                        a.type === "EMAIL" ? "bg-chip-neutral-bg text-chip-neutral-fg" :
                        a.type === "MEETING" ? "bg-chip-neutral-bg text-chip-neutral-fg" :
                        a.type === "FOLLOW_UP" ? "bg-chip-bad-bg text-chip-bad-fg" :
                        "bg-lt-inner text-lt-fg2"
                      }`}>{a.type.replace("_", " ")}</span>
                      <span className="text-[10px] text-lt-fg3">{a.agent.name}</span>
                      <span className="text-[10px] text-lt-fg3">{fmtDate(a.createdAt)}</span>
                      {a.company && <span className="text-[10px] text-lt-fg2">| {a.company.name}</span>}
                      {a.dueDate && !a.completed && (
                        <button onClick={() => completeActivity(a.id)} className="text-[10px] text-chip-good-fg hover:opacity-70 ml-auto">Complete</button>
                      )}
                      {a.completed && <span className="text-[10px] text-chip-good-fg ml-auto">Done</span>}
                    </div>
                    {a.subject && <p className="text-xs text-lt-fg font-medium">{a.subject}</p>}
                    <p className="text-xs text-lt-fg2">{a.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Link Company Modal */}
      {showLinkCompany && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowLinkCompany(false)}>
          <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-lt-fg mb-4">Link {person.firstName} to a Company</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-lt-fg2 mb-1">Search Company</label>
                <input type="text" value={companySearch} onChange={(e) => searchCompanies(e.target.value)}
                  placeholder="Type company name..."
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg" />
                {companyResults.length > 0 && !selectedCompanyId && (
                  <div className="mt-2 bg-lt-inner border border-lt-hairline rounded-lg max-h-60 overflow-y-auto">
                    {companyResults.map((c) => (
                      <button key={c.id} onClick={() => {
                        setSelectedCompanyId(c.id);
                        setCompanySearch(c.name);
                        setCompanyResults([]);
                      }} className="w-full text-left px-3 py-2 hover:bg-lt-inner text-sm border-b border-lt-hairline last:border-0">
                        <p className="text-lt-fg">{c.name}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs text-lt-fg2 mb-1">Production / Show</label>
                <input type="text" value={linkProduction} onChange={(e) => setLinkProduction(e.target.value)}
                  placeholder="e.g. Stranger Things S5"
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg" />
              </div>
              <div>
                <label className="block text-xs text-lt-fg2 mb-1">Role on This Show</label>
                <select value={linkRole} onChange={(e) => setLinkRole(e.target.value)}
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg">
                  <option value="">(same as default)</option>
                  <option value="UPM">UPM</option>
                  <option value="PRODUCER">Producer</option>
                  <option value="LINE_PRODUCER">Line Producer</option>
                  <option value="PRODUCTION_COORDINATOR">Production Coordinator</option>
                  <option value="PRODUCTION_SUPERVISOR">Production Supervisor</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={linkIsCurrent} onChange={(e) => setLinkIsCurrent(e.target.checked)}
                  className="w-4 h-4 rounded" />
                <span className="text-sm text-lt-fg2">Currently active</span>
              </label>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={linkCompany} disabled={!selectedCompanyId}
                className="px-4 py-2 bg-lt-fg hover:bg-black disabled:bg-lt-inner text-white text-sm font-medium rounded-lg">
                Link Company
              </button>
              <button onClick={() => setShowLinkCompany(false)} className="px-4 py-2 text-lt-fg2 hover:text-lt-fg text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
