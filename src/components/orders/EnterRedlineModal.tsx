"use client";

import { useMemo, useState } from "react";
import { X, Plus, Trash2, RotateCcw } from "lucide-react";
import { CANONICAL_CLAUSES } from "@/lib/contracts/contractClauses";

/**
 * "Client sent a redline back" — the staff-side entry desk.
 *
 * The portal's upload path only takes a marked-up PDF. Plenty of redlines
 * never exist as one: they come back as an email listing "Section 5, strike
 * the red and add the green". This modal is where that gets typed in — the
 * operator opens each amended clause with the STANDARD text already loaded
 * and edits it to read the way both sides agreed.
 *
 * What you paste is the whole clause as it should finally read, not the
 * diff. That is what gets printed into the client's agreement, and the
 * counter-PDF renderer deliberately falls back to the standard clause when
 * the accepted text looks like a summary — so a diff would silently undo
 * the redline. The API enforces the same rule.
 */

export interface EnterRedlineResult {
  reviewId: string;
  clauses: Array<{ ref: string; title: string }>;
}

interface Row {
  clauseRef: string;
  proposed: string;
}

export default function EnterRedlineModal({
  orderId,
  jobName,
  onClose,
  onSaved,
}: {
  orderId: string;
  jobName?: string | null;
  onClose: () => void;
  onSaved: (result: EnterRedlineResult) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [pendingRef, setPendingRef] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const clauseByRef = useMemo(
    () => new Map(CANONICAL_CLAUSES.map((c) => [c.ref, c])),
    [],
  );
  const used = new Set(rows.map((r) => r.clauseRef));
  const available = CANONICAL_CLAUSES.filter((c) => !used.has(c.ref));

  const addRow = (ref: string) => {
    const canonical = clauseByRef.get(ref);
    if (!canonical) return;
    setRows((prev) => [...prev, { clauseRef: ref, proposed: canonical.body }]);
    setPendingRef("");
  };

  const save = async () => {
    setError("");
    const unchanged = rows.filter(
      (r) => r.proposed.trim() === (clauseByRef.get(r.clauseRef)?.body ?? ""),
    );
    if (rows.length === 0) {
      setError("Add at least one clause the client changed.");
      return;
    }
    if (unchanged.length > 0) {
      setError(
        `Clause ${unchanged.map((r) => r.clauseRef).join(", ")} still reads exactly like the standard text — edit it or remove it.`,
      );
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/agreement/redline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amendments: rows.map((r) => ({ clauseRef: r.clauseRef, proposed: r.proposed })),
          sourceNote: sourceNote.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not save the redline.");
        return;
      }
      onSaved({ reviewId: data.reviewId, clauses: data.clauses ?? [] });
    } catch {
      setError("Could not save the redline.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-lt-card border border-lt-hairline rounded-2xl w-full max-w-3xl my-8">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-lt-hairline">
          <div>
            <h2 className="text-lg font-bold text-lt-fg">Client redline</h2>
            <p className="text-xs text-lt-fg3 mt-1 max-w-xl">
              Type the clauses the client changed{jobName ? ` on ${jobName}` : ""}. Each one opens
              with our standard text — edit it to read the way you agreed. This papers{" "}
              <span className="font-semibold text-lt-fg2">this job only</span>; it does not change
              the standard agreement or this client&rsquo;s other jobs.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-lt-inner text-lt-fg3"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {rows.map((row, i) => {
            const canonical = clauseByRef.get(row.clauseRef);
            const dirty = canonical && row.proposed.trim() !== canonical.body;
            return (
              <div key={row.clauseRef} className="border border-lt-hairline rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-lt-fg">
                    Clause {row.clauseRef} · {canonical?.title}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() =>
                        setRows((prev) =>
                          prev.map((r, j) =>
                            j === i ? { ...r, proposed: canonical?.body ?? "" } : r,
                          ),
                        )
                      }
                      title="Reset to the standard clause"
                      className="p-1.5 rounded-lg hover:bg-lt-inner text-lt-fg3"
                    >
                      <RotateCcw size={14} />
                    </button>
                    <button
                      onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                      title="Remove this clause"
                      className="p-1.5 rounded-lg hover:bg-lt-inner text-lt-fg3"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <textarea
                  value={row.proposed}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r, j) => (j === i ? { ...r, proposed: e.target.value } : r)),
                    )
                  }
                  rows={9}
                  className="w-full bg-lt-inner border border-lt-hairline rounded-lg p-3 text-xs text-lt-fg leading-relaxed font-mono"
                />
                {!dirty && (
                  <div className="text-[11px] text-chip-warn-fg">
                    Unchanged from the standard text.
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex items-center gap-2">
            <select
              value={pendingRef}
              onChange={(e) => {
                setPendingRef(e.target.value);
                if (e.target.value) addRow(e.target.value);
              }}
              className="flex-1 bg-lt-inner border border-lt-hairline rounded-lg px-3 py-2 text-sm text-lt-fg"
            >
              <option value="">Add a clause the client changed…</option>
              {available.map((c) => (
                <option key={c.ref} value={c.ref}>
                  {c.ref} · {c.title}
                </option>
              ))}
            </select>
            <span className="text-lt-fg3">
              <Plus size={16} />
            </span>
          </div>

          <div>
            <label className="block text-xs text-lt-fg3 mb-1">
              Where this came from (optional)
            </label>
            <input
              value={sourceNote}
              onChange={(e) => setSourceNote(e.target.value)}
              placeholder="e.g. Redline emailed by production 9/4 — approved for this job"
              className="w-full bg-lt-inner border border-lt-hairline rounded-lg px-3 py-2 text-sm text-lt-fg"
            />
          </div>

          {error && <div className="text-xs text-chip-bad-fg">{error}</div>}
        </div>

        <div className="flex items-center justify-between gap-3 p-5 border-t border-lt-hairline">
          <div className="text-[11px] text-lt-fg3">
            Saving records the redline as approved and opens the review, where you generate the
            document and send it for signature.
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm font-semibold text-lt-fg2 hover:text-lt-fg"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || rows.length === 0}
              className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-lt-inner disabled:text-lt-fg3 text-white text-sm font-bold rounded-lg"
            >
              {saving ? "Saving…" : "Save redline"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
