"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { resizeImage, RESIZEABLE_MIME, ACCEPT_IMAGE } from "@/lib/inventory/resizeImage";

type Refs = { assets: number; orderLineItems: number; rateChangeLogs: number; total: number };
type Category = {
  id: string;
  name: string;
  slug: string;
  department: string;
  totalUnits: number;
  sortOrder: number;
  dailyRate: string;
  weeklyRate: string | null;
  isActive: boolean;
  archivedAt: string | null;
  hasImage: boolean;
  refs: Refs;
};

const money = (v: string | null) =>
  v == null || v === "" ? "—" : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Department pills reuse the shared light-theme pill/chip token palette
// (tailwind.config.ts — pill-*, chip-*) used across inventory & sales.
const DEPT_BADGE: Record<string, string> = {
  VEHICLES: "bg-pill-active-bg text-pill-active-fg",
  STAGES: "bg-pill-quoted-bg text-pill-quoted-fg",
  PRO_SUPPLIES: "bg-pill-hold-bg text-pill-hold-fg",
  COMMUNICATIONS: "bg-chip-neutral-bg text-chip-neutral-fg",
  GE: "bg-chip-neutral-bg text-chip-neutral-fg",
  EXPENDABLES: "bg-chip-good-bg text-chip-good-fg",
  ART: "bg-chip-neutral-bg text-chip-neutral-fg",
};
const DEPT_LABEL: Record<string, string> = {
  VEHICLES: "Vehicles", STAGES: "Stages", PRO_SUPPLIES: "Pro Supplies",
  COMMUNICATIONS: "Communications", GE: "Grip & Electric", EXPENDABLES: "Expendables", ART: "Art",
};
const DEPT_ORDER = ["VEHICLES", "STAGES", "PRO_SUPPLIES", "COMMUNICATIONS", "GE", "EXPENDABLES", "ART"];
const deptBadge = (d: string) => DEPT_BADGE[d] ?? "bg-chip-neutral-bg text-chip-neutral-fg";
const deptLabel = (d: string) => DEPT_LABEL[d] ?? d;
const isTest = (c: Category) => /^test\b/i.test(c.name) || c.slug.startsWith("test-");

export default function AdminAssetCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ name: string; dailyRate: string; weeklyRate: string }>({ name: "", dailyRate: "", weeklyRate: "" });
  const [saving, setSaving] = useState(false);

  const [hideTest, setHideTest] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  // Guarded delete/archive modal state
  const [target, setTarget] = useState<Category | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Representative-image state. imgV is a cache-bust token bumped on every
  // reload so a replaced thumbnail re-fetches through the no-store proxy.
  const [imgV, setImgV] = useState(0);
  const [imgBusy, setImgBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/asset-categories${showArchived ? "?includeArchived=1" : ""}`);
    if (res.status === 403) { setError("Admin access required."); setLoading(false); return; }
    if (res.status === 401) { setError("Sign in required."); setLoading(false); return; }
    const data = await res.json();
    setCategories(data.categories || []);
    setImgV((v) => v + 1);
    setError(null);
    setLoading(false);
  }, [showArchived]);

  // Upload a representative image via the shared private-Blob pipeline
  // (resize client-side for jpg/png/webp; HEIC passes through). Served back
  // only via the gated proxy GET — never a raw public Blob URL.
  const uploadImage = async (catId: string, file: File) => {
    setImgBusy(catId);
    try {
      let body: Blob = file;
      let name = file.name || "image.jpg";
      if (RESIZEABLE_MIME.has(file.type)) {
        try { body = await resizeImage(file); name = "image.jpg"; } catch { body = file; }
      }
      const fd = new FormData();
      fd.append("file", body, name);
      const res = await fetch(`/api/admin/asset-categories/${catId}/image`, { method: "POST", body: fd });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Upload failed"); return; }
      await load();
    } finally { setImgBusy(null); }
  };

  const removeImage = async (catId: string) => {
    if (!confirm("Remove this image?")) return;
    setImgBusy(catId);
    try {
      const res = await fetch(`/api/admin/asset-categories/${catId}/image`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Remove failed"); return; }
      await load();
    } finally { setImgBusy(null); }
  };

  useEffect(() => { load(); }, [load]);

  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditValues({ name: cat.name ?? "", dailyRate: cat.dailyRate ?? "", weeklyRate: cat.weeklyRate ?? "" });
  };

  const saveEdit = async (id: string) => {
    if (editValues.name.trim() === "") { alert("Name can't be empty."); return; }
    setSaving(true);
    const res = await fetch(`/api/admin/asset-categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editValues.name, dailyRate: editValues.dailyRate, weeklyRate: editValues.weeklyRate === "" ? null : editValues.weeklyRate }),
    });
    setSaving(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Failed to save"); return; }
    setEditingId(null);
    load();
  };

  const setActive = async (cat: Category, isActive: boolean) => {
    const res = await fetch(`/api/admin/asset-categories/${cat.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Failed"); return; }
    load();
  };

  const openGuard = (cat: Category) => { setTarget(cat); setConfirmText(""); setModalError(null); };
  const closeGuard = () => { setTarget(null); setConfirmText(""); setModalError(null); setBusy(false); };

  const doArchive = async () => {
    if (!target) return;
    setBusy(true); setModalError(null);
    const res = await fetch(`/api/admin/asset-categories/${target.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setModalError(d.error || "Archive failed"); return; }
    closeGuard(); load();
  };

  const doDelete = async () => {
    if (!target) return;
    setBusy(true); setModalError(null);
    const res = await fetch(`/api/admin/asset-categories/${target.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      // Race: became referenced since the list loaded → fall back to archive.
      if (res.status === 409 && d.references) {
        setTarget({ ...target, refs: d.references });
        setModalError("Became referenced — archive instead of deleting.");
        return;
      }
      setModalError(d.error || "Delete failed"); return;
    }
    closeGuard(); load();
  };

  // Filter (hide test) + group by department, preserving department order and
  // pushing test categories to the bottom of their group, de-emphasized.
  const groups = useMemo(() => {
    const visible = categories.filter((c) => (hideTest ? !isTest(c) : true));
    const byDept = new Map<string, Category[]>();
    for (const c of visible) {
      if (!byDept.has(c.department)) byDept.set(c.department, []);
      byDept.get(c.department)!.push(c);
    }
    const depts = [...byDept.keys()].sort((a, b) => {
      const ia = DEPT_ORDER.indexOf(a), ib = DEPT_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });
    return depts.map((d) => ({
      dept: d,
      rows: byDept.get(d)!.sort((a, b) => Number(isTest(a)) - Number(isTest(b)) || a.name.localeCompare(b.name)),
    }));
  }, [categories, hideTest]);

  const testCount = categories.filter(isTest).length;

  if (error) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-chip-bad-bg border border-chip-bad-fg/20 text-chip-bad-fg rounded-xl p-4 text-sm">{error}</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-lt-fg">Fleet Pricing</h1>
          <a href="/admin/vehicle-catalog" className="text-sm font-semibold text-lt-fg2 hover:text-lt-fg">
            Vehicle Catalog (public specs) →
          </a>
        </div>
        <p className="text-sm text-lt-fg2 mt-1 max-w-2xl font-medium">
          Edit the daily / weekly rate for each fleet category. Changing a rate sets the default for{" "}
          <span className="text-lt-fg font-semibold">future</span> quote lines only — existing orders keep the price they were booked at.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-4 mb-3 text-xs">
        <label className="flex items-center gap-2 text-lt-fg2 cursor-pointer select-none font-medium">
          <input type="checkbox" checked={hideTest} onChange={(e) => setHideTest(e.target.checked)} className="accent-amber-600" />
          Hide test categories{testCount > 0 ? ` (${testCount})` : ""}
        </label>
        <label className="flex items-center gap-2 text-lt-fg2 cursor-pointer select-none font-medium">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-amber-600" />
          Show archived
        </label>
      </div>

      <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-lt-card">
            <tr className="border-b border-lt-hairline text-lt-fg2 text-left text-xs uppercase tracking-wide">
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 font-semibold text-center w-20">Units</th>
              <th className="px-4 py-3 font-semibold text-right w-28">Daily</th>
              <th className="px-4 py-3 font-semibold text-right w-28">Weekly</th>
              <th className="px-4 py-3 font-semibold text-right w-[150px]"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-lt-fg3">Loading…</td></tr>
            ) : groups.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-lt-fg3">No categories</td></tr>
            ) : groups.map(({ dept, rows }) => (
              <DepartmentGroup key={dept} dept={dept} rows={rows}
                editingId={editingId} editValues={editValues} setEditValues={setEditValues}
                saving={saving} startEdit={startEdit} saveEdit={saveEdit} cancelEdit={() => setEditingId(null)}
                openGuard={openGuard} restore={(c) => setActive(c, true)}
                imgV={imgV} imgBusy={imgBusy} uploadImage={uploadImage} removeImage={removeImage} />
            ))}
          </tbody>
        </table>
      </div>

      {target && (
        <GuardModal target={target} confirmText={confirmText} setConfirmText={setConfirmText}
          busy={busy} error={modalError} onCancel={closeGuard} onArchive={doArchive} onDelete={doDelete} />
      )}
    </div>
  );
}

function DepartmentGroup(props: {
  dept: string; rows: Category[];
  editingId: string | null; editValues: { name: string; dailyRate: string; weeklyRate: string };
  setEditValues: (v: { name: string; dailyRate: string; weeklyRate: string }) => void;
  saving: boolean; startEdit: (c: Category) => void; saveEdit: (id: string) => void; cancelEdit: () => void;
  openGuard: (c: Category) => void; restore: (c: Category) => void;
  imgV: number; imgBusy: string | null;
  uploadImage: (catId: string, file: File) => void; removeImage: (catId: string) => void;
}) {
  const { dept, rows, editingId, editValues, setEditValues, saving, startEdit, saveEdit, cancelEdit, openGuard, restore, imgV, imgBusy, uploadImage, removeImage } = props;
  return (
    <>
      <tr className="bg-lt-inner border-b border-lt-hairline">
        <td colSpan={5} className="px-4 py-2">
          <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${deptBadge(dept)}`}>{deptLabel(dept)}</span>
          <span className="ml-2 text-[11px] text-lt-fg3 font-medium">{rows.length} categor{rows.length === 1 ? "y" : "ies"}</span>
        </td>
      </tr>
      {rows.map((cat) => {
        const editing = editingId === cat.id;
        const archived = !cat.isActive;
        return (
          <tr key={cat.id} className={`border-b border-lt-hairline hover:bg-lt-inner transition-colors ${archived ? "opacity-50" : isTest(cat) ? "opacity-60" : ""}`}>
            <td className="px-4 py-2">
              <div className="flex items-center gap-3">
                <CategoryThumb cat={cat} imgV={imgV} editing={editing} busy={imgBusy === cat.id}
                  onUpload={(f) => uploadImage(cat.id, f)} onRemove={() => removeImage(cat.id)} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {editing ? (
                      <input
                        type="text"
                        value={editValues.name}
                        onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                        placeholder="Category name"
                        className="w-56 px-2 py-1 bg-lt-card border border-lt-hairline rounded text-sm text-lt-fg focus:outline-none focus:border-amber-500"
                      />
                    ) : (
                      <span className="text-lt-fg font-medium">{cat.name}</span>
                    )}
                    {archived && <span className="text-[10px] uppercase tracking-wide bg-lt-inner text-lt-fg2 px-1.5 py-0.5 rounded">Archived</span>}
                    {isTest(cat) && !archived && <span className="text-[10px] uppercase tracking-wide bg-lt-inner text-lt-fg3 px-1.5 py-0.5 rounded">Test</span>}
                  </div>
                  {/* Slug is the stable key — display only, never edited on rename. */}
                  <span className="block text-lt-fg3 font-mono text-[11px]">{cat.slug}</span>
                </div>
              </div>
            </td>
            <td className="px-4 py-2 text-center">
              <span className="inline-block min-w-[1.5rem] text-[11px] font-semibold text-lt-fg2 bg-lt-inner rounded-full px-2 py-0.5 tabular-nums">{cat.refs.assets}</span>
            </td>
            <td className="px-4 py-2 text-right">
              {editing ? (
                <input type="number" min={0} step="0.01" value={editValues.dailyRate}
                  onChange={(e) => setEditValues({ ...editValues, dailyRate: e.target.value })}
                  className="w-24 px-2 py-1 bg-lt-card border border-lt-hairline rounded text-sm text-lt-fg text-right tabular-nums focus:outline-none focus:border-amber-500" />
              ) : (<span className="text-lt-fg font-semibold tabular-nums">{money(cat.dailyRate)}</span>)}
            </td>
            <td className="px-4 py-2 text-right">
              {editing ? (
                <input type="number" min={0} step="0.01" value={editValues.weeklyRate} placeholder="—"
                  onChange={(e) => setEditValues({ ...editValues, weeklyRate: e.target.value })}
                  className="w-24 px-2 py-1 bg-lt-card border border-lt-hairline rounded text-sm text-lt-fg text-right tabular-nums focus:outline-none focus:border-amber-500" />
              ) : (<span className="text-lt-fg2 tabular-nums">{money(cat.weeklyRate)}</span>)}
            </td>
            <td className="px-4 py-2 text-right whitespace-nowrap">
              {editing ? (
                <>
                  <button onClick={() => saveEdit(cat.id)} disabled={saving} className="text-chip-good-fg hover:opacity-80 disabled:text-lt-fg3 text-xs font-semibold mr-3">{saving ? "Saving…" : "Save"}</button>
                  <button onClick={cancelEdit} className="text-lt-fg3 hover:text-lt-fg2 text-xs">Cancel</button>
                </>
              ) : archived ? (
                <button onClick={() => restore(cat)} className="text-lt-fg2 hover:text-chip-good-fg text-xs font-medium">Restore</button>
              ) : (
                <>
                  <button onClick={() => startEdit(cat)} className="text-lt-fg2 hover:text-amber-600 text-xs font-medium mr-3">Edit</button>
                  <button onClick={() => openGuard(cat)} className="text-lt-fg3 hover:text-chip-bad-fg text-xs font-medium">Delete</button>
                </>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function CategoryThumb({ cat, imgV, editing, busy, onUpload, onRemove }: {
  cat: Category; imgV: number; editing: boolean; busy: boolean;
  onUpload: (f: File) => void; onRemove: () => void;
}) {
  const inputId = `catimg-${cat.id}`;
  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <div className="h-11 w-11 rounded-lg overflow-hidden bg-lt-inner border border-lt-hairline flex items-center justify-center">
        {cat.hasImage ? (
          // Loads ONLY through the gated proxy — the raw private blob URL is
          // never sent to the client. imgV cache-busts a replaced image.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/admin/asset-categories/${cat.id}/image?v=${imgV}`} alt={cat.name} className="h-full w-full object-cover" />
        ) : (
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-lt-fg3" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
          </svg>
        )}
      </div>
      {editing && (
        <div className="flex items-center gap-1.5 text-[10px]">
          <label htmlFor={inputId} className={`cursor-pointer font-semibold ${busy ? "text-lt-fg3" : "text-amber-600 hover:text-amber-700"}`}>
            {busy ? "…" : cat.hasImage ? "Replace" : "Upload"}
          </label>
          <input id={inputId} type="file" accept={ACCEPT_IMAGE} className="hidden" disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.currentTarget.value = ""; }} />
          {cat.hasImage && !busy && (
            <button onClick={onRemove} className="text-lt-fg3 hover:text-chip-bad-fg font-medium">Remove</button>
          )}
        </div>
      )}
    </div>
  );
}

function GuardModal(props: {
  target: Category; confirmText: string; setConfirmText: (v: string) => void;
  busy: boolean; error: string | null; onCancel: () => void; onArchive: () => void; onDelete: () => void;
}) {
  const { target, confirmText, setConfirmText, busy, error, onCancel, onArchive, onDelete } = props;
  const referenced = target.refs.total > 0;
  const armed = confirmText === "DELETE";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-5 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-lt-fg">Delete “{target.name}”?</h2>

        <div className="mt-3 rounded-lg bg-lt-inner border border-lt-hairline p-3 text-xs text-lt-fg2 space-y-1">
          <div className="flex justify-between"><span>Fleet units (assets)</span><span className="tabular-nums text-lt-fg font-semibold">{target.refs.assets}</span></div>
          <div className="flex justify-between"><span>Order line items</span><span className="tabular-nums text-lt-fg font-semibold">{target.refs.orderLineItems}</span></div>
          <div className="flex justify-between"><span>Rate-change history</span><span className="tabular-nums text-lt-fg font-semibold">{target.refs.rateChangeLogs}</span></div>
          <div className="flex justify-between border-t border-lt-hairline pt-1 mt-1 font-semibold"><span className="text-lt-fg">Total references</span><span className="tabular-nums text-lt-fg">{target.refs.total}</span></div>
        </div>

        {referenced ? (
          <p className="mt-3 text-xs text-chip-warn-fg bg-chip-warn-bg border border-chip-warn-fg/20 rounded-lg p-2.5">
            This category is referenced by {target.refs.total} record(s). It will be <strong>archived</strong> (hidden from the list)
            — never hard-deleted — so existing quotes and invoices stay intact. The price they were booked at is already snapshotted.
          </p>
        ) : (
          <p className="mt-3 text-xs text-lt-fg2">
            No references found. You can <strong className="text-lt-fg">archive</strong> (reversible) or <strong className="text-lt-fg">permanently delete</strong> this category.
          </p>
        )}

        <label className="block mt-4 text-xs text-lt-fg2 mb-1 font-medium">Type <span className="font-mono text-lt-fg">DELETE</span> to confirm</label>
        <input autoFocus value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE"
          className="w-full px-3 py-2 bg-lt-card border border-lt-hairline rounded-lg text-sm text-lt-fg placeholder-lt-fg3 focus:outline-none focus:border-amber-500" />

        {error && <p className="mt-2 text-xs text-chip-bad-fg">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="px-3 py-1.5 text-xs font-semibold text-lt-fg2 border border-lt-hairline rounded-lg hover:bg-lt-inner">Cancel</button>
          {referenced ? (
            <button onClick={onArchive} disabled={busy || !armed}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:bg-lt-inner disabled:text-lt-fg3 rounded-lg">
              {busy ? "Archiving…" : "Archive"}
            </button>
          ) : (
            <>
              <button onClick={onArchive} disabled={busy || !armed}
                className="px-3 py-1.5 text-xs font-semibold text-lt-fg border border-lt-hairline hover:bg-lt-inner disabled:opacity-40 rounded-lg">Archive</button>
              <button onClick={onDelete} disabled={busy || !armed}
                className="px-3 py-1.5 text-xs font-bold text-white bg-chip-bad-fg hover:opacity-90 disabled:bg-lt-inner disabled:text-lt-fg3 rounded-lg">
                {busy ? "Deleting…" : "Permanently delete"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
