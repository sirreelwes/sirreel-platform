"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Plus,
  Trash2,
  RotateCcw,
  Sparkles,
  ImageIcon,
  AlertTriangle,
  ArrowLeft,
  Send,
} from "lucide-react";
import { CANONICAL_CLAUSES } from "@/lib/contracts/contractClauses";
import { diffClause } from "@/lib/contracts/clauseDiff";

/**
 * "The client sent a redline back" — the staff-side entry desk.
 *
 * The portal's upload path assumes an annotated PDF. Most redlines are not
 * that: they are an email that says "Section 5, strike the red and add the
 * green", or a screenshot of a marked-up page. So the first thing this asks
 * for is what the client actually sent — paste the text, paste the image, or
 * both — and it reads the clauses out of it.
 *
 * The operator still reviews and edits every clause before saving. What the
 * AI removes is the guessing: which numbered clauses were touched, and what
 * the full amended text of each one reads like.
 *
 * What gets saved is the WHOLE clause as it should finally read, never a
 * diff or a summary. The counter-PDF renderer falls back to the standard
 * clause when accepted text looks like a summary, so a diff would silently
 * undo the redline. The API enforces the same rule.
 */

export interface EnterRedlineResult {
  reviewId: string;
  clauses: Array<{ ref: string; title: string }>;
}

interface Row {
  clauseRef: string;
  proposed: string;
  /** What the AI says changed. Null for a clause added by hand. */
  summary: string | null;
}

interface Unmatched {
  text: string;
  why: string;
}

interface PastedImage {
  media_type: string;
  data: string;
  name: string;
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * One clause, marked up: what the client struck in red, what they added in
 * green, everything they left alone in plain text. This is the screen an
 * agreement gets approved from, so it shows the change rather than asking
 * anyone to spot it between two paragraphs.
 */
function MarkedUpClause({ original, amended }: { original: string; amended: string }) {
  const segments = useMemo(() => diffClause(original, amended), [original, amended]);
  return (
    <p className="text-xs leading-relaxed text-lt-fg2">
      {segments.map((seg, i) =>
        seg.op === "del" ? (
          <span key={i} className="line-through text-chip-bad-fg bg-chip-bad-bg/60 rounded-sm">
            {seg.text}
          </span>
        ) : seg.op === "ins" ? (
          <span key={i} className="text-chip-good-fg bg-chip-good-bg font-semibold rounded-sm">
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </p>
  );
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

  const [redlineText, setRedlineText] = useState("");
  const [images, setImages] = useState<PastedImage[]>([]);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [unmatched, setUnmatched] = useState<Unmatched[]>([]);
  const [hasRead, setHasRead] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Step 2: the finished changes, marked up, with the send at the end of it.
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [recipient, setRecipient] = useState<{ name: string | null; email: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendStage, setSendStage] = useState("");
  const [sent, setSent] = useState<{ email: string | null; portalUrl: string | null } | null>(null);

  // Who the send will reach. Fetched when the review opens so it is on screen
  // BEFORE the button, not in the receipt after it.
  useEffect(() => {
    if (step !== "review" || recipient) return;
    let cancelled = false;
    fetch(`/api/orders/${orderId}/agreement/redline`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.recipient) setRecipient(d.recipient);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [step, recipient, orderId]);

  const clauseByRef = useMemo(
    () => new Map(CANONICAL_CLAUSES.map((c) => [c.ref, c])),
    [],
  );
  const used = new Set(rows.map((r) => r.clauseRef));
  const available = CANONICAL_CLAUSES.filter((c) => !used.has(c.ref));

  const addRow = (ref: string) => {
    const canonical = clauseByRef.get(ref);
    if (!canonical) return;
    setRows((prev) => [...prev, { clauseRef: ref, proposed: canonical.body, summary: null }]);
    setPendingRef("");
  };

  const attachFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const picked = Array.from(files).filter((f) => IMAGE_TYPES.has(f.type));
    for (const file of picked.slice(0, 4)) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const data = result.slice(result.indexOf(",") + 1);
        setImages((prev) =>
          prev.length >= 4 ? prev : [...prev, { media_type: file.type, data, name: file.name || "pasted image" }],
        );
      };
      reader.readAsDataURL(file);
    }
  };

  const readRedline = async () => {
    setReadError("");
    if (!redlineText.trim() && images.length === 0) {
      setReadError("Paste the email, or the screenshot, or both.");
      return;
    }
    setReading(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/agreement/redline/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: redlineText,
          images: images.map((i) => ({ media_type: i.media_type, data: i.data })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReadError(data.error || "Could not read the redline.");
        return;
      }
      const found: Row[] = (data.amendments ?? []).map((a: any) => ({
        clauseRef: String(a.clauseRef),
        proposed: String(a.proposed),
        summary: a.summary ? String(a.summary) : null,
      }));
      // Replace rather than merge: re-reading means the operator changed what
      // they pasted, and silently keeping a clause from the previous read is
      // how a clause nobody meant to send ends up in the agreement.
      setRows(found);
      setUnmatched(data.unmatched ?? []);
      setHasRead(true);
      if (found.length === 0) {
        setReadError("No clause edits found in that. Add the clauses by hand below.");
      }
    } catch {
      setReadError("Could not read the redline.");
    } finally {
      setReading(false);
    }
  };

  const validate = (): string => {
    if (rows.length === 0) return "Add at least one clause the client changed.";
    const unchanged = rows.filter(
      (r) => r.proposed.trim() === (clauseByRef.get(r.clauseRef)?.body ?? ""),
    );
    if (unchanged.length > 0) {
      return `Clause ${unchanged
        .map((r) => r.clauseRef)
        .join(", ")} still reads exactly like the standard text — edit it or remove it.`;
    }
    return "";
  };

  /** Record the approved redline. Returns the review id, or null on failure. */
  const persist = async (): Promise<string | null> => {
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
      return null;
    }
    return String(data.reviewId);
  };

  const saveOnly = async () => {
    const problem = validate();
    if (problem) return setError(problem);
    setError("");
    setSaving(true);
    try {
      const reviewId = await persist();
      if (reviewId) onSaved({ reviewId, clauses: [] });
    } catch {
      setError("Could not save the redline.");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Approve and send, in the order the words imply: record the redline,
   * render the document from it, then release it to the client and email the
   * link. Three existing endpoints rather than one new orchestration route —
   * so a failure names the step it failed at instead of "something went
   * wrong", and a half-finished send leaves the redline recorded rather than
   * lost.
   */
  const approveAndSend = async () => {
    const problem = validate();
    if (problem) return setError(problem);
    setError("");
    setSending(true);
    try {
      setSendStage("Recording the approved redline…");
      const reviewId = await persist();
      if (!reviewId) return;

      setSendStage("Building the agreement…");
      const gen = await fetch(`/api/tools/contract-review/${reviewId}/generate-counter-pdf`, {
        method: "POST",
      });
      if (!gen.ok) {
        const d = await gen.json().catch(() => ({}));
        setError(
          (d.error || "Could not build the agreement.") +
            " The redline is saved — open the contract review to finish.",
        );
        return;
      }

      setSendStage("Sending for signature…");
      const acc = await fetch(`/api/orders/${orderId}/contract-review/accept`, { method: "POST" });
      const accData = await acc.json().catch(() => ({}));
      if (!acc.ok) {
        setError(
          (accData.error || "Could not send for signature.") +
            " The agreement is built — open the contract review to send it.",
        );
        return;
      }
      setSent({
        email: accData.recipientEmail ?? null,
        portalUrl: accData.portalUrl ?? null,
      });
    } catch {
      setError("Could not finish sending. Open the contract review to pick it up.");
    } finally {
      setSending(false);
      setSendStage("");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-lt-card border border-lt-hairline rounded-2xl w-full max-w-3xl my-8">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-lt-hairline">
          <div>
            <h2 className="text-lg font-bold text-lt-fg">
              {sent ? "Sent for signature" : step === "review" ? "The finished changes" : "Client redline"}
            </h2>
            <p className="text-xs text-lt-fg3 mt-1 max-w-xl">
              {sent ? (
                <>The client has the agreement and the portal is open for signing.</>
              ) : step === "review" ? (
                <>
                  Struck text is what the client removed, green is what they added, everything else
                  is our standard clause unchanged. Approve to build the agreement and send it.
                </>
              ) : (
                <>
                  Paste what the client sent{jobName ? ` on ${jobName}` : ""} — the email, a
                  screenshot of the marked-up page, or both — and it reads the clauses out. You
                  review every one before sending. This papers{" "}
                  <span className="font-semibold text-lt-fg2">this job only</span>; it does not
                  change the standard agreement or this client&rsquo;s other jobs.
                </>
              )}
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

        {step === "edit" && !sent && (
        <div className="p-5 space-y-4">
          {/* ── What the client sent ─────────────────────────────── */}
          <div className="border border-lt-hairline rounded-xl p-3 space-y-2">
            <div className="text-xs font-semibold text-lt-fg2">What the client sent</div>
            <textarea
              value={redlineText}
              onChange={(e) => setRedlineText(e.target.value)}
              onPaste={(e) => {
                const files = e.clipboardData?.files;
                if (files && files.length > 0) attachFiles(files);
              }}
              rows={5}
              placeholder={
                'Paste their email or list of changes here — e.g. "Section 5, strike the red and add the green…". You can paste a screenshot straight into this box too.'
              }
              className="w-full bg-lt-inner border border-lt-hairline rounded-lg p-3 text-xs text-lt-fg leading-relaxed"
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              className="hidden"
              onChange={(e) => attachFiles(e.target.files)}
            />
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-lt-inner hover:bg-lt-hairline text-lt-fg2 text-xs font-semibold rounded-lg"
                >
                  <ImageIcon size={13} /> Attach a screenshot
                </button>
                {images.map((img, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-lt-inner rounded-lg text-[11px] text-lt-fg2"
                  >
                    {img.name}
                    <button
                      onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                      className="text-lt-fg3 hover:text-lt-fg"
                      aria-label="Remove image"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
              <button
                onClick={readRedline}
                disabled={reading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-lt-fg hover:bg-black disabled:bg-lt-inner disabled:text-lt-fg3 text-white text-xs font-bold rounded-lg"
              >
                <Sparkles size={13} />
                {reading ? "Reading…" : hasRead ? "Read it again" : "Read the clauses"}
              </button>
            </div>
            {readError && <div className="text-[11px] text-chip-bad-fg">{readError}</div>}
          </div>

          {unmatched.length > 0 && (
            <div className="border border-chip-warn-fg/30 bg-chip-warn-bg rounded-xl p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-chip-warn-fg">
                <AlertTriangle size={13} /> Not turned into a clause edit
              </div>
              {unmatched.map((u, i) => (
                <div key={i} className="text-[11px] text-chip-warn-fg leading-relaxed">
                  <span className="italic">&ldquo;{u.text}&rdquo;</span> — {u.why}
                </div>
              ))}
            </div>
          )}

          {/* ── The clauses ──────────────────────────────────────── */}
          {rows.length > 0 && (
            <div className="text-xs font-semibold text-lt-fg2">
              {rows.length} clause{rows.length === 1 ? "" : "s"} to review
            </div>
          )}
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
                {row.summary && (
                  <div className="text-[11px] text-lt-fg3 leading-relaxed">
                    What changed: {row.summary}
                  </div>
                )}
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
              <option value="">Add a clause by hand…</option>
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

        )}

        {step === "review" && !sent && (
          <div className="p-5 space-y-4">
            {rows.map((row) => {
              const canonical = clauseByRef.get(row.clauseRef);
              if (!canonical) return null;
              return (
                <div key={row.clauseRef} className="border border-lt-hairline rounded-xl p-3 space-y-2">
                  <div className="text-sm font-semibold text-lt-fg">
                    Clause {row.clauseRef} · {canonical.title}
                  </div>
                  {row.summary && (
                    <div className="text-[11px] text-lt-fg3 leading-relaxed">{row.summary}</div>
                  )}
                  <MarkedUpClause original={canonical.body} amended={row.proposed} />
                </div>
              );
            })}

            <div className="border border-lt-hairline rounded-xl p-3 space-y-1">
              <div className="text-xs font-semibold text-lt-fg2">What happens when you approve</div>
              <ul className="text-[11px] text-lt-fg3 leading-relaxed list-disc pl-4 space-y-0.5">
                <li>
                  The full agreement is built with these clauses in place of ours — clean text, no
                  markup, the amended clauses marked so the client can see which ones moved.
                </li>
                <li>
                  {recipient ? (
                    <>
                      It is emailed to{" "}
                      <span className="font-semibold text-lt-fg2">
                        {recipient.name ? `${recipient.name} · ` : ""}
                        {recipient.email}
                      </span>{" "}
                      with a link to sign in their portal.
                    </>
                  ) : (
                    <>It is emailed to the job&rsquo;s primary contact with a link to sign.</>
                  )}
                </li>
                <li>The other clauses of the rental agreement are unchanged.</li>
              </ul>
            </div>

            {error && <div className="text-xs text-chip-bad-fg">{error}</div>}
          </div>
        )}

        {sent && (
          <div className="p-5 space-y-3">
            <div className="border border-chip-good-fg/30 bg-chip-good-bg rounded-xl p-3 space-y-1.5">
              <div className="text-xs font-semibold text-chip-good-fg">
                {sent.email
                  ? `The agreement went to ${sent.email}.`
                  : "The agreement is ready to sign, but no client email was on file to send it to."}
              </div>
              <div className="text-[11px] text-chip-good-fg leading-relaxed">
                {rows.length} amended clause{rows.length === 1 ? "" : "s"} (
                {rows.map((r) => r.clauseRef).join(", ")}) are in the document they signed for.
              </div>
              {sent.portalUrl && (
                <a
                  href={sent.portalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-[11px] font-semibold text-chip-good-fg underline break-all"
                >
                  Open the portal as the client &rarr;
                </a>
              )}
            </div>
            {!sent.email && (
              <div className="text-[11px] text-chip-warn-fg">
                Add a contact to the job, then use Resend portal link on the order.
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 p-5 border-t border-lt-hairline">
          <div className="text-[11px] text-lt-fg3">
            {sending
              ? sendStage
              : sent
                ? "Nothing further is needed unless the client comes back with more changes."
                : step === "review"
                  ? "Nothing has gone to the client yet."
                  : "You will see the finished changes before anything is sent."}
          </div>
          <div className="flex items-center gap-2">
            {sent ? (
              <button
                onClick={onClose}
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold rounded-lg"
              >
                Done
              </button>
            ) : step === "edit" ? (
              <>
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-sm font-semibold text-lt-fg2 hover:text-lt-fg"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const problem = validate();
                    if (problem) return setError(problem);
                    setError("");
                    setStep("review");
                  }}
                  disabled={rows.length === 0}
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-lt-inner disabled:text-lt-fg3 text-white text-sm font-bold rounded-lg"
                >
                  Review the changes
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setStep("edit")}
                  disabled={sending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-lt-fg2 hover:text-lt-fg disabled:opacity-40"
                >
                  <ArrowLeft size={14} /> Back to edit
                </button>
                <button
                  onClick={saveOnly}
                  disabled={saving || sending}
                  title="Record the redline without emailing the client"
                  className="px-3 py-1.5 bg-lt-inner hover:bg-lt-hairline disabled:opacity-40 text-lt-fg2 text-sm font-semibold rounded-lg"
                >
                  {saving ? "Saving…" : "Save without sending"}
                </button>
                <button
                  onClick={approveAndSend}
                  disabled={sending || saving}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-lt-inner disabled:text-lt-fg3 text-white text-sm font-bold rounded-lg"
                >
                  <Send size={14} />
                  {sending ? "Sending…" : "Approve & send for signature"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
