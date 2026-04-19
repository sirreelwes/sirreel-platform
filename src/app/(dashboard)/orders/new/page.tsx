"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { JobPicker } from "@/components/orders/JobPicker";
import { NewJobModal } from "@/components/orders/NewJobModal";

type Company = { id: string; name: string; tier: string };
type Agent = { id: string; name: string; email: string };

export default function NewOrderPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [companyId, setCompanyId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [taxRate, setTaxRate] = useState("0");
  const [addTax, setAddTax] = useState(false);

  // Job feature
  const [jobId, setJobId] = useState<string | null>(null);
  const [showNewJobModal, setShowNewJobModal] = useState(false);
  const [jobsRefreshKey, setJobsRefreshKey] = useState(0);

  // Reset jobId when company changes — previously selected job no longer applies
  useEffect(() => { setJobId(null); }, [companyId]);

  useEffect(() => {
    fetch("/api/orders/lookups")
      .then((r) => r.json())
      .then((data) => {
        setCompanies(data.companies || []);
        setAgents(data.agents || []);
        setLoading(false);
      });
  }, []);

  const handleCreate = async () => {
    if (!companyId || !agentId || !jobId) return;
    setCreating(true);

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        agentId,
        jobId,
        description: description || null,
        startDate: startDate || null,
        endDate: endDate || null,
        taxRate: parseFloat(taxRate) || 0,
      }),
    });

    if (res.ok) {
      const order = await res.json();
      router.push(`/orders/${order.id}`);
    } else {
      const err = await res.json();
      alert(err.error || "Failed to create order");
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <p className="text-zinc-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <button
        onClick={() => router.push("/orders")}
        className="text-sm text-zinc-400 hover:text-white mb-4 inline-block"
      >
        &larr; Back to Orders
      </button>

      <h1 className="text-2xl font-semibold text-white mb-6">New Order</h1>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-1">Company *</label>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-500"
          >
            <option value="">Select company...</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-1">Job *</label>
          <JobPicker
            companyId={companyId || null}
            value={jobId}
            onChange={setJobId}
            onCreateNew={() => setShowNewJobModal(true)}
            refreshKey={jobsRefreshKey}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-1">Agent *</label>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-500"
          >
            <option value="">Select agent...</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-1">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Stranger Things S5 -- Lighting package"
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={addTax}
              onChange={(e) => {
                setAddTax(e.target.checked);
                setTaxRate(e.target.checked ? "0.095" : "0");
              }}
              className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-zinc-300">Charge sales tax</span>
          </label>
          {addTax && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.001"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                className="w-24 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white focus:outline-none focus:border-zinc-500"
              />
              <span className="text-xs text-zinc-500">({(parseFloat(taxRate || "0") * 100).toFixed(1)}%)</span>
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={handleCreate}
            disabled={!companyId || !agentId || !jobId || creating}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {creating ? "Creating..." : "Create Draft Order"}
          </button>
          <button
            onClick={() => router.push("/orders")}
            className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    
      {showNewJobModal && companyId && (
        <NewJobModal
          open={showNewJobModal}
          onClose={() => setShowNewJobModal(false)}
          companyId={companyId}
          companyName={companies.find((c) => c.id === companyId)?.name || ""}
          onCreated={(job) => {
            setJobId(job.id);
            setJobsRefreshKey((k) => k + 1);
          }}
        />
      )}
</div>
  );
}
