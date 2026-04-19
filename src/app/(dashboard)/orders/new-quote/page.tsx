"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type Match = { id: string; code: string; description: string; dailyRate: string | number; weeklyRate: string | number; category: string; type: string };
type ParsedItem = {
  description: string;
  quantity: number;
  type: string;
  specs?: string;
  matches: { inventory: Match[]; assets: Match[] };
};
type Parsed = {
  clientName?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  productionName?: string;
  startDate?: string;
  endDate?: string;
  pickupLocation?: string;
  dropoffLocation?: string;
  rateType?: "DAILY" | "WEEKLY";
  notes?: string;
  items?: { description: string; quantity: number; type: string; specs?: string }[];
};
type ClientCandidate = { id: string; name: string; tier: string; coiOnFile: boolean; defaultAgentId: string | null };

export default function NewQuotePage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [mode, setMode] = useState<"paste" | "pdf" | "manual">("paste");
  const [emailText, setEmailText] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [clientCandidates, setClientCandidates] = useState<ClientCandidate[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedMatches, setSelectedMatches] = useState<Record<number, { id: string; type: string; description: string; rate: number } | null>>({});
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountLabel, setDiscountLabel] = useState("");
  const [editing, setEditing] = useState<Parsed>({});

  const parseEmail = async () => {
    if (!emailText.trim()) return;
    setParsing(true);
    try {
      const res = await fetch("/api/orders/parse-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: emailText }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Parse failed"); return; }
      setParsed(data.parsed);
      setItems(data.itemsWithMatches);
      setClientCandidates(data.clientMatch || []);
      setEditing(data.parsed);
      // Auto-select first match where available
      const autoMatches: typeof selectedMatches = {};
      (data.itemsWithMatches || []).forEach((item: ParsedItem, idx: number) => {
        const best = item.matches.assets[0] || item.matches.inventory[0];
        if (best) {
          const rateType = data.parsed.rateType || "WEEKLY";
          autoMatches[idx] = {
            id: best.id,
            type: best.type,
            description: best.description,
            rate: Number(rateType === "WEEKLY" ? best.weeklyRate : best.dailyRate),
          };
        }
      });
      setSelectedMatches(autoMatches);
      if (data.clientMatch && data.clientMatch.length === 1) {
        setSelectedClientId(data.clientMatch[0].id);
      }
    } finally {
      setParsing(false);
    }
  };

  const parsePDF = async () => {
    if (!pdfFile) return;
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", pdfFile);
      const pdfRes = await fetch("/api/orders/parse-pdf", { method: "POST", body: fd });
      const pdfData = await pdfRes.json();
      if (!pdfRes.ok) { alert(pdfData.error || "PDF parse failed"); return; }
      setEmailText(pdfData.text);
      // Now parse the extracted text
      const parseRes = await fetch("/api/orders/parse-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pdfData.text }),
      });
      const parseData = await parseRes.json();
      if (!parseRes.ok) { alert(parseData.error || "Parse failed"); return; }
      setParsed(parseData.parsed);
      setItems(parseData.itemsWithMatches);
      setClientCandidates(parseData.clientMatch || []);
      setEditing(parseData.parsed);
    } finally {
      setParsing(false);
    }
  };

  const createQuote = async () => {
    if (!selectedClientId) { alert("Select a client first"); return; }
    setCreating(true);
    try {
      let finalClientId = selectedClientId;

      // Auto-create company if user chose "__new__"
      if (selectedClientId === "__new__" && parsed?.clientName) {
        const coRes = await fetch("/api/crm/companies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: parsed.clientName,
            tier: "NEW",
            billingEmail: parsed.contactEmail || null,
          }),
        });
        if (!coRes.ok) {
          alert("Failed to create new company");
          setCreating(false);
          return;
        }
        const newCo = await coRes.json();
        finalClientId = newCo.id;
      }

      // AUTO-CREATE JOB FALLBACK — temporary until proper job selection UX in new-quote flow.
      // Creates an "Untitled" job tied to the client. Wes can rename/manage in the jobs view.
      let jobId: string;
      try {
        const jobName =
          editing.productionName ||
          parsed?.productionName ||
          `Quote — ${parsed?.clientName || "Untitled"} — ${new Date().toLocaleDateString()}`;
        const jobRes = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: jobName,
            companyId: finalClientId,
            agentId: (session?.user as { id?: string })?.id,
            startDate: editing.startDate || null,
            endDate: editing.endDate || null,
            notes: "Auto-created from quote parser",
          }),
        });
        if (!jobRes.ok) {
          const err = await jobRes.json();
          alert("Failed to create job for quote: " + (err.error || "unknown"));
          setCreating(false);
          return;
        }
        const jobData = await jobRes.json();
        jobId = jobData.job.id;
      } catch (e) {
        console.error("Auto-create job failed:", e);
        alert("Failed to create job for quote");
        setCreating(false);
        return;
      }

      // Create order
      const orderRes = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: finalClientId,
          jobId,
          description: editing.productionName || editing.notes || "Quote from AI extraction",
          startDate: editing.startDate || null,
          endDate: editing.endDate || null,
          status: "QUOTE_SENT",
          rateType: editing.rateType || "WEEKLY",
          notes: editing.notes || null,
          taxRate: 0,
          agentId: (session?.user as { id?: string })?.id,
        }),
      });

      if (!orderRes.ok) {
        const err = await orderRes.json();
        alert(err.error || "Failed to create order");
        setCreating(false);
        return;
      }
      const order = await orderRes.json();

      // Add line items
      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const match = selectedMatches[idx];
        if (!match) continue;

        const rateType = editing.rateType || "WEEKLY";
        await fetch(`/api/orders/${order.id}/line-items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: item.type === "EQUIPMENT" ? "EQUIPMENT" : item.type === "LABOR" ? "LABOR" : "VEHICLE",
            description: match.description,
            quantity: item.quantity,
            rate: match.rate,
            rateType,
            [match.type === "ASSET" ? "assetId" : "inventoryItemId"]: match.id,
          }),
        });
      }

      // Add discount line item if set
      if (discountAmount && parseFloat(discountAmount) !== 0) {
        await fetch(`/api/orders/${order.id}/line-items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "DISCOUNT",
            description: discountLabel || "Discount",
            quantity: 1,
            rate: parseFloat(discountAmount),
            rateType: "FLAT",
          }),
        });
      }

      router.push(`/orders/${order.id}`);
    } finally {
      setCreating(false);
    }
  };

  const updateSelectedMatch = (idx: number, match: Match | null) => {
    if (!match) { setSelectedMatches({ ...selectedMatches, [idx]: null }); return; }
    const rateType = editing.rateType || "WEEKLY";
    setSelectedMatches({
      ...selectedMatches,
      [idx]: {
        id: match.id,
        type: match.type,
        description: match.description,
        rate: Number(rateType === "WEEKLY" ? match.weeklyRate : match.dailyRate),
      },
    });
  };

  const fmt = (n: string | number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n));

  // Step 1: Input
  if (!parsed) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <button onClick={() => router.push("/orders")} className="text-sm text-zinc-400 hover:text-white mb-4 inline-block">&larr; Back to Orders</button>
        <h1 className="text-2xl font-semibold text-white mb-2">New Quote (AI-Assisted)</h1>
        <p className="text-sm text-zinc-400 mb-6">Paste an email, upload a PDF, or fill in manually. AI will extract client info, dates, and line items.</p>

        <div className="flex gap-1 mb-4 bg-zinc-800 rounded-lg p-0.5 w-fit">
          {(["paste", "pdf", "manual"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium ${mode === m ? "bg-white text-zinc-900" : "text-zinc-400 hover:text-white"}`}>
              {m === "paste" ? "Paste Email" : m === "pdf" ? "Upload PDF" : "Manual Entry"}
            </button>
          ))}
        </div>

        {mode === "paste" && (
          <div className="space-y-3">
            <textarea value={emailText} onChange={(e) => setEmailText(e.target.value)}
              placeholder="Paste the client's email or quote request here..."
              rows={14}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600 resize-none" />
            <button onClick={parseEmail} disabled={!emailText.trim() || parsing}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white font-medium rounded-lg transition-colors">
              {parsing ? "AI is parsing..." : "Parse with AI"}
            </button>
          </div>
        )}

        {mode === "pdf" && (
          <div className="space-y-3">
            <label className="block">
              <input type="file" accept="application/pdf" onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-zinc-400 file:mr-4 file:py-3 file:px-4 file:rounded-lg file:border-0 file:bg-zinc-800 file:text-white file:cursor-pointer hover:file:bg-zinc-700" />
            </label>
            {pdfFile && <p className="text-sm text-zinc-400">{pdfFile.name} ({(pdfFile.size / 1024).toFixed(0)} KB)</p>}
            <button onClick={parsePDF} disabled={!pdfFile || parsing}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white font-medium rounded-lg transition-colors">
              {parsing ? "AI is processing PDF..." : "Upload & Parse"}
            </button>
          </div>
        )}

        {mode === "manual" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-sm text-zinc-400">
            <p className="mb-2">Manual entry coming in a moment — for now, use <a href="/orders/new" className="text-blue-400 hover:text-blue-300">/orders/new</a>.</p>
          </div>
        )}
      </div>
    );
  }

  // Step 2: Review & Edit
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => { setParsed(null); setItems([]); }} className="text-sm text-zinc-400 hover:text-white mb-4 inline-block">&larr; Start Over</button>
      <h1 className="text-2xl font-semibold text-white mb-1">Review Extracted Quote</h1>
      <p className="text-sm text-zinc-400 mb-6">Review what AI extracted. Adjust anything, then create the quote.</p>

      {/* Client & Dates */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-4 space-y-4">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Client Company</label>
          {clientCandidates.length > 0 ? (
            <select value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white">
              <option value="">-- Select a match --</option>
              {clientCandidates.map(c => (
                <option key={c.id} value={c.id}>{c.name} {c.tier !== "STANDARD" ? `(${c.tier})` : ""} {c.coiOnFile ? "| COI" : ""}</option>
              ))}
              <option value="__new__">+ Create new company: {parsed.clientName}</option>
            </select>
          ) : (
            <div className="text-sm text-amber-400 bg-amber-900/20 border border-amber-900/40 rounded-lg p-3">
              No match for &quot;{parsed.clientName}&quot;. <a href="/crm" className="underline">Create company first</a>.
            </div>
          )}
          <p className="text-xs text-zinc-500 mt-1">AI extracted: <span className="text-zinc-300">{parsed.clientName || "unknown"}</span> {parsed.contactName ? `| Contact: ${parsed.contactName}` : ""}</p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Production Name</label>
            <input type="text" value={editing.productionName || ""} onChange={(e) => setEditing({ ...editing, productionName: e.target.value })}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Start Date</label>
            <input type="date" value={editing.startDate || ""} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">End Date</label>
            <input type="date" value={editing.endDate || ""} onChange={(e) => setEditing({ ...editing, endDate: e.target.value })}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Rate Type</label>
            <select value={editing.rateType || "WEEKLY"} onChange={(e) => setEditing({ ...editing, rateType: e.target.value as "DAILY" | "WEEKLY" })}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white">
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Pickup Location</label>
            <input type="text" value={editing.pickupLocation || ""} onChange={(e) => setEditing({ ...editing, pickupLocation: e.target.value })}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white" />
          </div>
        </div>

        {editing.notes && (
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Notes</label>
            <textarea value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} rows={2}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white resize-none" />
          </div>
        )}
      </div>

      {/* Line Items */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-4">
        <h2 className="text-base font-semibold text-white mb-3">Line Items ({items.length})</h2>
        <div className="space-y-3">
          {items.map((item, idx) => {
            const selected = selectedMatches[idx];
            const allMatches = [...item.matches.assets, ...item.matches.inventory];
            return (
              <div key={idx} className="border border-zinc-800 rounded-lg p-3">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm text-white font-medium">{item.quantity}x {item.description}</p>
                    {item.specs && <p className="text-xs text-zinc-500">{item.specs}</p>}
                  </div>
                  <span className="text-xs text-zinc-500">{item.type}</span>
                </div>

                {allMatches.length === 0 ? (
                  <p className="text-xs text-amber-400 mt-2">No match in catalog. Will need to add manually after creation.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">Match to:</label>
                      <select
                        value={selected?.id || ""}
                        onChange={(e) => {
                          const match = allMatches.find(m => m.id === e.target.value);
                          updateSelectedMatch(idx, match || null);
                        }}
                        className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-white"
                      >
                        <option value="">-- Skip this item --</option>
                        {allMatches.map(m => {
                          const rateType = editing.rateType || "WEEKLY";
                          const rate = Number(rateType === "WEEKLY" ? m.weeklyRate : m.dailyRate);
                          return (
                            <option key={m.id} value={m.id}>
                              [{m.type === "ASSET" ? "Fleet" : "Inv"}] {m.description} | {fmt(rate)}/{rateType === "WEEKLY" ? "wk" : "day"} | {m.category}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                    {selected && (
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <label className="block text-xs text-zinc-500 mb-1">Rate ({editing.rateType === "WEEKLY" ? "per week" : "per day"}) — adjust for discount</label>
                          <input
                            type="number"
                            step="0.01"
                            value={selected.rate}
                            onChange={(e) => {
                              const rate = parseFloat(e.target.value) || 0;
                              setSelectedMatches({
                                ...selectedMatches,
                                [idx]: { ...selected, rate },
                              });
                            }}
                            className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-white font-mono"
                          />
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-zinc-500">Subtotal</p>
                          <p className="text-sm text-emerald-400 font-mono">{fmt(selected.rate * item.quantity)}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Discount */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-4">
        <h2 className="text-base font-semibold text-white mb-3">Discount (Optional)</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Discount Label</label>
            <input type="text" value={discountLabel} onChange={(e) => setDiscountLabel(e.target.value)}
              placeholder="e.g. Loyalty Discount, 10% Repeat Client"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Discount Amount (negative $)</label>
            <input type="number" step="0.01" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)}
              placeholder="e.g. -500"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white font-mono" />
          </div>
        </div>
        <p className="text-xs text-zinc-500 mt-2">Enter discount as a negative number (e.g. -500 for $500 off, or -1000 for $1,000 off)</p>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button onClick={createQuote} disabled={!selectedClientId || creating}
          className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white font-medium rounded-lg transition-colors">
          {creating ? "Creating Quote..." : "Create Quote"}
        </button>
        <button onClick={() => { setParsed(null); setItems([]); }} className="px-6 py-3 text-zinc-400 hover:text-white transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}
