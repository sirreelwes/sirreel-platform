"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

type DupGroup = {
  manual: { id: string; name: string; tier: string; totalSpend: string; totalBookings: number; createdAt: string };
  matches: { id: string; name: string; rentalworksCustomerId: string | null }[];
};

export default function DuplicatesPage() {
  const router = useRouter();
  const [dups, setDups] = useState<DupGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ manual: 0, imported: 0 });
  const [merging, setMerging] = useState<string | null>(null);

  const fetchDups = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/crm/find-duplicates");
    const data = await res.json();
    setDups(data.duplicates || []);
    setCounts({ manual: data.manualCount, imported: data.importedCount });
    setLoading(false);
  }, []);

  useEffect(() => { fetchDups(); }, [fetchDups]);

  const merge = async (manualId: string, rwId: string) => {
    if (!confirm("Merge this manual company into the RentalWorks record? The manual entry will be deleted.")) return;
    setMerging(manualId);
    await fetch("/api/crm/find-duplicates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manualId, rwId }),
    });
    setMerging(null);
    fetchDups();
  };

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <button onClick={() => router.push("/crm")} className="text-sm text-zinc-400 hover:text-white mb-4 inline-block">&larr; Back to Clients</button>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Duplicate Companies</h1>
        <p className="text-sm text-zinc-400 mt-1">
          {counts.manual} manually-added companies | {counts.imported} from RentalWorks | {dups.length} potential matches
        </p>
      </div>

      {loading ? (
        <p className="text-zinc-500 py-12 text-center">Scanning for duplicates...</p>
      ) : dups.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
          <p className="text-zinc-400">No duplicates found.</p>
          <p className="text-xs text-zinc-500 mt-2">All manually-added companies appear to be unique.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {dups.map((d) => (
            <div key={d.manual.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-white font-medium">{d.manual.name}</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Manual entry | {d.manual.tier} | ${Number(d.manual.totalSpend).toLocaleString()} | {d.manual.totalBookings} bookings
                  </p>
                </div>
                <span className="text-xs text-amber-400">{d.matches.length} match{d.matches.length > 1 ? "es" : ""} in RW</span>
              </div>

              <div className="space-y-2 ml-4 border-l-2 border-zinc-800 pl-4">
                {d.matches.map((m) => (
                  <div key={m.id} className="flex items-center justify-between py-2 border-b border-zinc-800/50 last:border-0">
                    <div>
                      <p className="text-sm text-white">{m.name}</p>
                      <p className="text-xs text-zinc-500">From RW: {m.rentalworksCustomerId}</p>
                    </div>
                    <button
                      onClick={() => merge(d.manual.id, m.id)}
                      disabled={merging === d.manual.id}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      {merging === d.manual.id ? "Merging..." : "Merge into this one"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {dups.length > 0 && (
        <p className="text-xs text-zinc-500 mt-6">
          Merging preserves all orders, affiliations, and activity history. Spend and booking totals are combined.
        </p>
      )}
    </div>
  );
}
