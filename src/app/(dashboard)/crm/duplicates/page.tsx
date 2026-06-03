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
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1200px] mx-auto">
      <button onClick={() => router.push("/crm")} className="text-sm text-lt-fg2 hover:text-lt-fg mb-4 inline-block">&larr; Back to Clients</button>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-lt-fg">Duplicate Companies</h1>
        <p className="text-sm text-lt-fg2 mt-1">
          {counts.manual} manually-added companies | {counts.imported} from RentalWorks | {dups.length} potential matches
        </p>
      </div>

      {loading ? (
        <p className="text-lt-fg3 py-12 text-center">Scanning for duplicates...</p>
      ) : dups.length === 0 ? (
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-8 text-center">
          <p className="text-lt-fg2">No duplicates found.</p>
          <p className="text-xs text-lt-fg3 mt-2">All manually-added companies appear to be unique.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {dups.map((d) => (
            <div key={d.manual.id} className="bg-lt-card border border-lt-hairline rounded-xl p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-lt-fg font-medium">{d.manual.name}</h3>
                  <p className="text-xs text-lt-fg3 mt-0.5">
                    Manual entry | {d.manual.tier} | ${Number(d.manual.totalSpend).toLocaleString()} | {d.manual.totalBookings} bookings
                  </p>
                </div>
                <span className="text-xs text-lt-fg">{d.matches.length} match{d.matches.length > 1 ? "es" : ""} in RW</span>
              </div>

              <div className="space-y-2 ml-4 border-l-2 border-lt-hairline pl-4">
                {d.matches.map((m) => (
                  <div key={m.id} className="flex items-center justify-between py-2 border-b border-lt-hairline/50 last:border-0">
                    <div>
                      <p className="text-sm text-lt-fg">{m.name}</p>
                      <p className="text-xs text-lt-fg3">From RW: {m.rentalworksCustomerId}</p>
                    </div>
                    <button
                      onClick={() => merge(d.manual.id, m.id)}
                      disabled={merging === d.manual.id}
                      className="px-3 py-1.5 bg-cadence-on-rental-bar hover:opacity-90 disabled:bg-lt-inner text-white text-xs font-medium rounded-lg transition-colors"
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
        <p className="text-xs text-lt-fg3 mt-6">
          Merging preserves all orders, affiliations, and activity history. Spend and booking totals are combined.
        </p>
      )}
      </div>
    </div>
  );
}
