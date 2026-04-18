"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type Company = {
  id: string; name: string; tier: string; totalSpend: string; totalBookings: number;
  billingEmail: string | null; coiOnFile: boolean; coiExpiry: string | null;
  updatedAt: string;
  _count: { orders: number };
  affiliations: { person: { id: string; firstName: string; lastName: string; role: string; email: string; phone: string | null } }[];
};

type PersonResult = {
  id: string; firstName: string; lastName: string; email: string; phone: string | null;
  role: string; tier: string; totalSpend: string; totalBookings: number;
  affiliations: { company: { id: string; name: string }; isCurrent: boolean }[];
};

type FollowUp = {
  id: string; type: string; subject: string | null; body: string; dueDate: string | null;
  completed: boolean; createdAt: string;
  agent: { id: string; name: string };
  company: { id: string; name: string } | null;
  person: { id: string; firstName: string; lastName: string } | null;
};

const TIER_STYLES: Record<string, string> = {
  VIP: "bg-amber-100 text-amber-800",
  PREFERRED: "bg-blue-100 text-blue-800",
  STANDARD: "bg-zinc-200 text-zinc-700",
  NEW: "bg-emerald-100 text-emerald-800",
};

const fmt = (n: string | number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n));

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

export default function CRMPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [tab, setTab] = useState<"companies" | "people" | "followups">("companies");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [people, setPeople] = useState<PersonResult[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [sort, setSort] = useState("spend");
  const [loading, setLoading] = useState(true);

  // Add company modal
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTier, setNewTier] = useState("NEW");
  const [newEmail, setNewEmail] = useState("");

  const fetchCompanies = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (tierFilter) params.set("tier", tierFilter);
    params.set("sort", sort);
    const res = await fetch(`/api/crm/companies?${params}`);
    const data = await res.json();
    setCompanies(data.companies || []);
  }, [search, tierFilter, sort]);

  const fetchPeople = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    const res = await fetch(`/api/crm/people?${params}`);
    const data = await res.json();
    setPeople(data.people || []);
  }, [search]);

  const fetchFollowUps = useCallback(async () => {
    const res = await fetch("/api/crm/activities?pending=true");
    const data = await res.json();
    setFollowUps(data.activities || []);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      tab === "companies" ? fetchCompanies() : tab === "people" ? fetchPeople() : fetchFollowUps(),
    ]).then(() => setLoading(false));
  }, [tab, fetchCompanies, fetchPeople, fetchFollowUps]);

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

  const pendingCount = followUps.filter(f => !f.completed).length;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-white">Clients</h1>
        <button onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">
          + Add Company
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-zinc-800 rounded-lg p-0.5 w-fit">
        {([["companies", "Companies"], ["people", "Contacts"], ["followups", `Follow-Ups${pendingCount > 0 ? ` (${pendingCount})` : ""}`]] as const).map(([key, label]) => (
          <button key={key} onClick={() => { setTab(key as typeof tab); setSearch(""); }}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === key ? "bg-white text-zinc-900" : "text-zinc-400 hover:text-white"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      {tab !== "followups" && (
        <div className="flex gap-3 mb-4">
          <input type="text" placeholder={tab === "companies" ? "Search companies..." : "Search contacts..."}
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="flex-1 max-w-sm px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500" />
          {tab === "companies" && (
            <>
              <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}
                className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white">
                <option value="">All Tiers</option>
                <option value="VIP">VIP</option>
                <option value="PREFERRED">Preferred</option>
                <option value="STANDARD">Standard</option>
                <option value="NEW">New</option>
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value)}
                className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white">
                <option value="spend">Top Spend</option>
                <option value="name">A-Z</option>
                <option value="recent">Recent</option>
              </select>
            </>
          )}
        </div>
      )}

      {/* Companies Tab */}
      {tab === "companies" && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400 text-left text-xs uppercase tracking-wide">
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
                <tr><td colSpan={7} className="px-4 py-12 text-center text-zinc-500">Loading...</td></tr>
              ) : companies.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-zinc-500">No companies found</td></tr>
              ) : companies.map((co) => (
                <tr key={co.id} onClick={() => router.push(`/crm/${co.id}`)}
                  className="border-b border-zinc-800/50 hover:bg-zinc-800/50 cursor-pointer transition-colors">
                  <td className="px-4 py-3 text-white font-medium">{co.name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${TIER_STYLES[co.tier] || "bg-zinc-700 text-zinc-300"}`}>
                      {co.tier}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">
                    {co.affiliations.length > 0
                      ? co.affiliations.map(a => `${a.person.firstName} ${a.person.lastName}`).join(", ")
                      : <span className="text-zinc-600">No contacts</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-white font-mono">{fmt(co.totalSpend)}</td>
                  <td className="px-4 py-3 text-center text-zinc-300">{co.totalBookings}</td>
                  <td className="px-4 py-3 text-center text-zinc-300">{co._count.orders}</td>
                  <td className="px-4 py-3 text-center">
                    {co.coiOnFile
                      ? <span className="text-emerald-400 text-xs">On File</span>
                      : <span className="text-zinc-600 text-xs">Missing</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* People Tab */}
      {tab === "people" && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400 text-left text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium text-right">Spend</th>
                <th className="px-4 py-3 font-medium text-center">Bookings</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-zinc-500">Loading...</td></tr>
              ) : people.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-zinc-500">No contacts found</td></tr>
              ) : people.map((p) => (
                <tr key={p.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-4 py-3 text-white font-medium">{p.firstName} {p.lastName}</td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">{p.role.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">
                    {p.affiliations.length > 0
                      ? p.affiliations.map(a => a.company.name).join(", ")
                      : "--"}
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">{p.email}</td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">{p.phone || "--"}</td>
                  <td className="px-4 py-3 text-right text-white font-mono">{fmt(p.totalSpend)}</td>
                  <td className="px-4 py-3 text-center text-zinc-300">{p.totalBookings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Follow-Ups Tab */}
      {tab === "followups" && (
        <div className="space-y-2">
          {loading ? (
            <p className="text-zinc-500 py-12 text-center">Loading...</p>
          ) : followUps.length === 0 ? (
            <p className="text-zinc-500 py-12 text-center">No pending follow-ups</p>
          ) : followUps.map((f) => {
            const overdue = f.dueDate && new Date(f.dueDate) < new Date() && !f.completed;
            return (
              <div key={f.id} className={`bg-zinc-900 border rounded-xl p-4 flex items-start gap-4 ${overdue ? "border-red-800" : "border-zinc-800"}`}>
                <button onClick={() => completeFollowUp(f.id)}
                  className="mt-0.5 w-5 h-5 rounded border-2 border-zinc-600 hover:border-emerald-400 flex-shrink-0 transition-colors" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                      f.type === "CALL" ? "bg-blue-900/40 text-blue-300" :
                      f.type === "EMAIL" ? "bg-purple-900/40 text-purple-300" :
                      f.type === "MEETING" ? "bg-amber-900/40 text-amber-300" :
                      "bg-zinc-700 text-zinc-300"
                    }`}>{f.type.replace("_", " ")}</span>
                    {f.company && <span className="text-xs text-zinc-400">{f.company.name}</span>}
                    {f.person && <span className="text-xs text-zinc-500">({f.person.firstName} {f.person.lastName})</span>}
                  </div>
                  {f.subject && <p className="text-sm text-white font-medium">{f.subject}</p>}
                  <p className="text-sm text-zinc-400">{f.body}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  {f.dueDate && (
                    <p className={`text-xs font-medium ${overdue ? "text-red-400" : "text-zinc-400"}`}>
                      {overdue ? "Overdue: " : "Due: "}{fmtDate(f.dueDate)}
                    </p>
                  )}
                  <p className="text-xs text-zinc-600">{f.agent.name}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Company Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAdd(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-4">Add Company</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Company Name *</label>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Tier</label>
                <select value={newTier} onChange={(e) => setNewTier(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white">
                  <option value="NEW">New</option><option value="STANDARD">Standard</option>
                  <option value="PREFERRED">Preferred</option><option value="VIP">VIP</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Billing Email</label>
                <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={addCompany} disabled={!newName}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white text-sm font-medium rounded-lg">
                Add Company
              </button>
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-zinc-400 hover:text-white text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
