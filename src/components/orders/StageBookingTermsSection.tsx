"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Sales-facing form for capturing negotiated stage-booking terms, plus a
 * "Generate Stage Contract" button that POSTs to the generator endpoint.
 *
 * Visibility: parent controls render — typically when the Order has a
 * STAGE line item or Order.contractType ∈ {'stage', 'both'}.
 *
 * Spaces & dates use simple text inputs for MVP (one date per line, one
 * space per line). A richer date-picker / space-picker can ship later
 * without breaking the API contract.
 */

interface StageContractSummary {
  id: string;
  contractType: string;
  status: string;
  documentToSignUrl: string | null;
  baselineVersion: string | null;
  updatedAt: string;
}

interface Terms {
  id?: string;
  rentalDates: string[];
  dailyRate: string;
  productionOfficeRental: boolean;
  specificSpaces: string[];
  securityGuardRequired: boolean;
  salesNotes: string | null;
  updatedAt?: string;
}

const EMPTY_TERMS: Terms = {
  rentalDates: [],
  dailyRate: "",
  productionOfficeRental: false,
  specificSpaces: [],
  securityGuardRequired: false,
  salesNotes: null,
};

export function StageBookingTermsSection({
  orderId,
  onContractGenerated,
}: {
  orderId: string;
  onContractGenerated?: (agreement: StageContractSummary) => void;
}) {
  const [terms, setTerms] = useState<Terms>(EMPTY_TERMS);
  const [datesText, setDatesText] = useState("");
  const [spacesText, setSpacesText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [contract, setContract] = useState<StageContractSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, cRes] = await Promise.all([
        fetch(`/api/orders/${orderId}/stage-booking-terms`),
        fetch(`/api/orders/${orderId}/agreement`).catch(() => null),
      ]);
      if (tRes.ok) {
        const d = await tRes.json();
        if (d.terms) {
          const t: Terms = {
            id: d.terms.id,
            rentalDates: d.terms.rentalDates ?? [],
            dailyRate: d.terms.dailyRate ?? "",
            productionOfficeRental: !!d.terms.productionOfficeRental,
            specificSpaces: d.terms.specificSpaces ?? [],
            securityGuardRequired: !!d.terms.securityGuardRequired,
            salesNotes: d.terms.salesNotes ?? null,
            updatedAt: d.terms.updatedAt,
          };
          setTerms(t);
          setDatesText(t.rentalDates.join("\n"));
          setSpacesText(t.specificSpaces.join("\n"));
        }
      }
      // The /agreement endpoint only returns the rental agreement; the
      // stage contract status comes back from the generate endpoint
      // response. After page load we don't know it yet — that's fine,
      // the UI shows "Not generated yet" until the rep clicks Generate.
      if (cRes && cRes.ok) {
        // no-op for now; reserved for if we add a list endpoint.
      }
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    const rentalDates = datesText
      .split(/[\n,]/g)
      .map((s) => s.trim())
      .filter(Boolean);
    const specificSpaces = spacesText
      .split(/\n/g)
      .map((s) => s.trim())
      .filter(Boolean);
    const payload = {
      rentalDates,
      dailyRate: terms.dailyRate,
      productionOfficeRental: terms.productionOfficeRental,
      specificSpaces,
      securityGuardRequired: terms.securityGuardRequired,
      salesNotes: terms.salesNotes,
    };
    try {
      const res = await fetch(`/api/orders/${orderId}/stage-booking-terms`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || `Save failed (HTTP ${res.status})`);
        return;
      }
      const d = await res.json();
      setTerms({
        id: d.terms.id,
        rentalDates: d.terms.rentalDates ?? [],
        dailyRate: d.terms.dailyRate ?? "",
        productionOfficeRental: !!d.terms.productionOfficeRental,
        specificSpaces: d.terms.specificSpaces ?? [],
        securityGuardRequired: !!d.terms.securityGuardRequired,
        salesNotes: d.terms.salesNotes ?? null,
        updatedAt: d.terms.updatedAt,
      });
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/generate-stage-contract`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || `Generate failed (HTTP ${res.status})`);
        return;
      }
      const d = await res.json();
      setContract(d.agreement);
      onContractGenerated?.(d.agreement);
    } finally {
      setGenerating(false);
    }
  };

  const canGenerate = terms.id !== undefined && !saving;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-white">Stage Booking Terms</h2>
          <div className="text-xs text-zinc-500 mt-0.5">
            Negotiated parameters for the stage rental. Save these before generating the
            pre-signed stage contract for the client to countersign.
          </div>
        </div>
        {terms.updatedAt && (
          <span className="text-[11px] text-zinc-500">
            Last saved {new Date(terms.updatedAt).toLocaleString()}
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-zinc-500 py-3">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Rental dates (one per line, yyyy-MM-dd)</label>
              <textarea
                value={datesText}
                onChange={(e) => setDatesText(e.target.value)}
                rows={4}
                placeholder={"2026-05-22\n2026-05-23\n2026-05-26"}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 font-mono"
              />
              <div className="text-[10px] text-zinc-500 mt-1">
                Non-contiguous days are fine — the PDF groups runs (e.g. May 22–23, May 26).
              </div>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Daily rate (USD)</label>
              <input
                type="number"
                min="0"
                step="100"
                value={terms.dailyRate}
                onChange={(e) => setTerms((t) => ({ ...t, dailyRate: e.target.value }))}
                placeholder="2500"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-zinc-400 mb-1">
                Specific spaces (one per line — e.g. "Standing Sets", "LED Volume Stage")
              </label>
              <textarea
                value={spacesText}
                onChange={(e) => setSpacesText(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500"
              />
            </div>
            <div className="flex items-start gap-3">
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={terms.productionOfficeRental}
                  onChange={(e) => setTerms((t) => ({ ...t, productionOfficeRental: e.target.checked }))}
                  className="rounded"
                />
                Production office rental
              </label>
            </div>
            <div className="flex items-start gap-3">
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={terms.securityGuardRequired}
                  onChange={(e) => setTerms((t) => ({ ...t, securityGuardRequired: e.target.checked }))}
                  className="rounded"
                />
                Security guard required (clause 4, Producer&rsquo;s expense)
              </label>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-zinc-400 mb-1">Sales notes (internal — not on PDF)</label>
              <textarea
                value={terms.salesNotes ?? ""}
                onChange={(e) => setTerms((t) => ({ ...t, salesNotes: e.target.value || null }))}
                rows={2}
                placeholder="e.g. negotiated down from $3000 — client mentioned competing studio quote"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500"
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-300 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{error}</div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {saving ? "Saving…" : "Save Terms"}
            </button>
            <button
              onClick={generate}
              disabled={!canGenerate || generating}
              title={!canGenerate ? "Save terms before generating the contract" : "Render the pre-signed stage contract PDF"}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {generating ? "Generating…" : contract ? "Re-generate Stage Contract" : "Generate Stage Contract"}
            </button>
            {contract?.documentToSignUrl && (
              <a
                href={contract.documentToSignUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-amber-300 hover:text-amber-200 underline"
              >
                View pre-signed PDF →
              </a>
            )}
            {contract && (
              <span className="text-[11px] text-zinc-500">
                Status: {contract.status.replace(/_/g, " ")}
                {contract.baselineVersion ? ` · v${contract.baselineVersion}` : ""}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
