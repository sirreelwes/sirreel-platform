"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useSession } from "next-auth/react";

type Activity = {
  id: string; type: string; subject: string | null; body: string;
  dueDate: string | null; completed: boolean; createdAt: string;
  agent: { id: string; name: string };
};

type CompanyDetail = {
  id: string; name: string; tier: string; totalSpend: string; totalBookings: number;
  website: string | null; billingEmail: string | null; industry: string;
  coiOnFile: boolean; coiExpiry: string | null; notes: string | null;
  affiliations: { id: string; productionName: string | null; isCurrent: boolean; roleOnShow: string | null;
    person: { id: string; firstName: string; lastName: string; email: string; phone: string | null; role: string } }[];
  orders: { id: string; orderNumber: string; status: string; total: string; description: string | null; startDate: string | null; createdAt: string }[];
  activities: Activity[];
};

const TIER_STYLES: Record<string, string> = {
  VIP: "bg-amber-100 text-amber-800", PREFERRED: "bg-blue-100 text-blue-800",
  STANDARD: "bg-zinc-200 text-zinc-700", NEW: "bg-emerald-100 text-emerald-800",
};

const fmt = (n: string | number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n));
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "--";

export default function CompanyDetailPage() {
  const router = useRouter();
  const params = useParams();
  const companyId = params.id as string;
  const { data: session } = useSession();

  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Activity form
  const [actType, setActType] = useState("NOTE");
  const [actSubject, setActSubject] = useState("");
  const [actBody, setActBody] = useState("");
  const [actDueDate, setActDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  // Link contact modal
  const [showLinkContact, setShowLinkContact] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [contactResults, setContactResults] = useState<Array<{id: string; firstName: string; lastName: string; email: string; role: string}>>([]);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [linkProduction, setLinkProduction] = useState("");
  const [linkRole, setLinkRole] = useState("");
  const [linkIsCurrent, setLinkIsCurrent] = useState(true);

  const fetchCompany = useCallback(async () => {
    const res = await fetch(`/api/crm/companies/${companyId}`);
    if (!res.ok) { router.push("/crm"); return; }
    setCompany(await res.json());
    setLoading(false);
  }, [companyId, router]);

  useEffect(() => { fetchCompany(); }, [fetchCompany]);

  const addActivity = async () => {
    if (!actBody) return;
    setSaving(true);
    const userId = (session?.user as any)?.id;
    await fetch("/api/crm/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        agentId: userId,
        type: actType,
        subject: actSubject || null,
        body: actBody,
        dueDate: actDueDate || null,
      }),
    });
    setActSubject(""); setActBody(""); setActDueDate(""); setSaving(false);
    fetchCompany();
  };

  const searchContacts = async (q: string) => {
    setContactSearch(q);
    if (!q || q.length < 2) { setContactResults([]); return; }
    const res = await fetch(`/api/crm/people?search=${encodeURIComponent(q)}`);
    const data = await res.json();
    setContactResults(data.people?.slice(0, 8) || []);
  };

  const linkContact = async () => {
    if (!selectedContactId) return;
    await fetch("/api/crm/affiliations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personId: selectedContactId,
        companyId,
        productionName: linkProduction || null,
        roleOnShow: linkRole || null,
        isCurrent: linkIsCurrent,
      }),
    });
    setShowLinkContact(false);
    setContactSearch(""); setContactResults([]); setSelectedContactId("");
    setLinkProduction(""); setLinkRole(""); setLinkIsCurrent(true);
    fetchCompany();
  };

  const removeAffiliation = async (id: string) => {
    if (!confirm("Remove this contact from the company?")) return;
    await fetch(`/api/crm/affiliations/${id}`, { method: "DELETE" });
    fetchCompany();
  };

  const completeActivity = async (id: string) => {
    await fetch(`/api/crm/activities/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    fetchCompany();
  };

  if (loading || !company) {
    return <div className="p-6 flex items-center justify-center min-h-[400px]"><p className="text-zinc-500">Loading...</p></div>;
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <button onClick={() => router.push("/crm")} className="text-sm text-zinc-400 hover:text-white mb-4 inline-block">&larr; Back to Clients</button>

      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-semibold text-white">{company.name}</h1>
              <span className={`px-2.5 py-0.5 rounded text-xs font-medium ${TIER_STYLES[company.tier]}`}>{company.tier}</span>
            </div>
            <p className="text-zinc-400 text-sm">{company.industry.replace(/_/g, " ")}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold text-white font-mono">{fmt(company.totalSpend)}</p>
            <p className="text-sm text-zinc-400">{company.totalBookings} bookings | {company.orders.length} orders</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4 mt-4 text-sm">
          <div><span className="text-zinc-500">Website</span><p className="text-white mt-0.5">{company.website || "--"}</p></div>
          <div><span className="text-zinc-500">Billing Email</span><p className="text-white mt-0.5">{company.billingEmail || "--"}</p></div>
          <div><span className="text-zinc-500">COI</span><p className="text-white mt-0.5">{company.coiOnFile ? `On file (exp ${fmtDate(company.coiExpiry)})` : "Missing"}</p></div>
          <div><span className="text-zinc-500">Notes</span><p className="text-zinc-300 mt-0.5 text-xs">{company.notes || "--"}</p></div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Contacts + Orders */}
        <div className="col-span-2 space-y-6">
          {/* Contacts + Affiliations */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-white">Contacts on Shows</h2>
              <button onClick={() => setShowLinkContact(true)}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium">+ Link Contact</button>
            </div>
            {company.affiliations.length === 0 ? (
              <p className="text-zinc-500 text-sm">No contacts linked. Add a freelancer who worked on a production with this company.</p>
            ) : (
              <div className="space-y-2">
                {company.affiliations.map((a) => (
                  <div key={a.id} className="flex items-center justify-between py-2 border-b border-zinc-800/50 last:border-0 group">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-white font-medium">{a.person.firstName} {a.person.lastName}</p>
                        {a.isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300">Current</span>}
                      </div>
                      <p className="text-xs text-zinc-400">
                        {a.productionName ? <span className="text-zinc-300">{a.productionName}</span> : ""}
                        {a.productionName && a.roleOnShow ? " | " : ""}
                        {a.roleOnShow ? a.roleOnShow.replace(/_/g, " ") : (a.productionName ? "" : a.person.role.replace(/_/g, " "))}
                      </p>
                    </div>
                    <div className="text-right text-xs text-zinc-400 mr-3">
                      <p>{a.person.email}</p>
                      <p>{a.person.phone || ""}</p>
                    </div>
                    <button onClick={() => removeAffiliation(a.id)}
                      className="opacity-0 group-hover:opacity-100 text-xs text-red-400 hover:text-red-300 transition-opacity">Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Orders */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h2 className="text-base font-semibold text-white mb-3">Orders</h2>
            {company.orders.length === 0 ? (
              <p className="text-zinc-500 text-sm">No orders yet</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-zinc-500 text-xs uppercase border-b border-zinc-800">
                  <th className="py-2 text-left font-medium">Order #</th>
                  <th className="py-2 text-left font-medium">Description</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 text-right font-medium">Total</th>
                  <th className="py-2 text-right font-medium">Date</th>
                </tr></thead>
                <tbody>
                  {company.orders.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`/orders/${o.id}`)}
                      className="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer">
                      <td className="py-2 text-white font-mono text-xs">{o.orderNumber}</td>
                      <td className="py-2 text-zinc-400 text-xs">{o.description || "--"}</td>
                      <td className="py-2 text-center"><span className="text-xs text-zinc-300">{o.status.replace("_", " ")}</span></td>
                      <td className="py-2 text-right text-white font-mono text-xs">{fmt(o.total)}</td>
                      <td className="py-2 text-right text-zinc-400 text-xs">{fmtDate(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: Activity Feed */}
        <div className="space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h2 className="text-base font-semibold text-white mb-3">Log Activity</h2>
            <div className="space-y-2">
              <select value={actType} onChange={(e) => setActType(e.target.value)}
                className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white">
                <option value="NOTE">Note</option><option value="CALL">Call</option>
                <option value="EMAIL">Email</option><option value="MEETING">Meeting</option>
                <option value="FOLLOW_UP">Follow-Up</option>
              </select>
              <input type="text" value={actSubject} onChange={(e) => setActSubject(e.target.value)} placeholder="Subject (optional)"
                className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white placeholder-zinc-500" />
              <textarea value={actBody} onChange={(e) => setActBody(e.target.value)} placeholder="What happened?" rows={3}
                className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white placeholder-zinc-500 resize-none" />
              {(actType === "FOLLOW_UP" || actType === "CALL") && (
                <input type="date" value={actDueDate} onChange={(e) => setActDueDate(e.target.value)}
                  className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white" />
              )}
              <button onClick={addActivity} disabled={!actBody || saving}
                className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white text-sm font-medium rounded-lg transition-colors">
                {saving ? "Saving..." : "Log"}
              </button>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h2 className="text-base font-semibold text-white mb-3">Activity History</h2>
            {company.activities.length === 0 ? (
              <p className="text-zinc-500 text-sm">No activity logged yet</p>
            ) : (
              <div className="space-y-3">
                {company.activities.map((a) => (
                  <div key={a.id} className="border-b border-zinc-800/50 pb-3 last:border-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        a.type === "CALL" ? "bg-blue-900/40 text-blue-300" :
                        a.type === "EMAIL" ? "bg-purple-900/40 text-purple-300" :
                        a.type === "MEETING" ? "bg-amber-900/40 text-amber-300" :
                        a.type === "FOLLOW_UP" ? "bg-red-900/40 text-red-300" :
                        "bg-zinc-700 text-zinc-300"
                      }`}>{a.type.replace("_", " ")}</span>
                      <span className="text-[10px] text-zinc-500">{a.agent.name}</span>
                      <span className="text-[10px] text-zinc-600">{fmtDate(a.createdAt)}</span>
                      {a.dueDate && !a.completed && (
                        <button onClick={() => completeActivity(a.id)} className="text-[10px] text-emerald-400 hover:text-emerald-300 ml-auto">Complete</button>
                      )}
                      {a.completed && <span className="text-[10px] text-emerald-600 ml-auto">Done</span>}
                    </div>
                    {a.subject && <p className="text-xs text-white font-medium">{a.subject}</p>}
                    <p className="text-xs text-zinc-400">{a.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Link Contact Modal */}
      {showLinkContact && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowLinkContact(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-4">Link Contact to {company.name}</h2>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Search Contact</label>
                <input type="text" value={contactSearch} onChange={(e) => searchContacts(e.target.value)}
                  placeholder="Type name or email..."
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white" />
                {contactResults.length > 0 && !selectedContactId && (
                  <div className="mt-2 bg-zinc-800 border border-zinc-700 rounded-lg max-h-60 overflow-y-auto">
                    {contactResults.map((c) => (
                      <button key={c.id} onClick={() => {
                        setSelectedContactId(c.id);
                        setContactSearch(`${c.firstName} ${c.lastName} (${c.email})`);
                        setContactResults([]);
                      }} className="w-full text-left px-3 py-2 hover:bg-zinc-700 text-sm border-b border-zinc-700 last:border-0">
                        <p className="text-white">{c.firstName} {c.lastName}</p>
                        <p className="text-xs text-zinc-400">{c.email} | {c.role.replace(/_/g, " ")}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Production / Show Name</label>
                <input type="text" value={linkProduction} onChange={(e) => setLinkProduction(e.target.value)}
                  placeholder="e.g. Stranger Things S5"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white" />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Role on This Show</label>
                <select value={linkRole} onChange={(e) => setLinkRole(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white">
                  <option value="">(same as contact default)</option>
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
                <span className="text-sm text-zinc-300">Currently active on this show</span>
              </label>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={linkContact} disabled={!selectedContactId}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white text-sm font-medium rounded-lg">
                Link Contact
              </button>
              <button onClick={() => setShowLinkContact(false)} className="px-4 py-2 text-zinc-400 hover:text-white text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
