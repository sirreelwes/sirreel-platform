"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/**
 * HQ · Vehicle Catalog — edit the public-site fields of each VehicleCategory
 * (the cards clients see at /vehicles). Name / slug / price are managed in
 * Fleet Pricing; this page owns the marketing/spec copy, the photo gallery,
 * the feature bullets and the publish toggle. Edits reflect LIVE on the public
 * vehicle pages. Reuses the Fleet Pricing inline-edit pattern: one row open at
 * a time, PATCH then refetch (not optimistic). Photo actions (upload / primary
 * / reorder / delete) apply immediately, then refetch.
 *
 * Every row shows its real client-facing state: a vehicle is LIVE only when
 * published AND it has at least one image (gallery photo or legacy image).
 */

type Photo = {
  id: string;
  sortOrder: number;
  isPrimary: boolean;
};

type Vehicle = {
  id: string;
  name: string;
  slug: string;
  subtitle: string | null;
  active: boolean;
  published: boolean;
  clientVisible: boolean;
  hasLegacyImage: boolean;
  features: string | null;
  photos: Photo[];
  dailyRate: number | null;
  baseVehicle: string | null;
  model: string | null;
  fuelType: string | null;
  lengthFt: number | null;
  heightClearance: string | null;
  interiorBoxHeight: string | null;
  liftGateSpec: string | null;
  tagline: string | null;
  description: string | null;
};

type SpecForm = {
  baseVehicle: string;
  model: string;
  fuelType: string;
  lengthFt: string;
  heightClearance: string;
  interiorBoxHeight: string;
  liftGateSpec: string;
  tagline: string;
  description: string;
  features: string;
};

const emptyForm: SpecForm = {
  baseVehicle: "", model: "", fuelType: "", lengthFt: "", heightClearance: "",
  interiorBoxHeight: "", liftGateSpec: "", tagline: "", description: "", features: "",
};

const toForm = (v: Vehicle): SpecForm => ({
  baseVehicle: v.baseVehicle ?? "",
  model: v.model ?? "",
  fuelType: v.fuelType ?? "",
  lengthFt: v.lengthFt != null ? String(v.lengthFt) : "",
  heightClearance: v.heightClearance ?? "",
  interiorBoxHeight: v.interiorBoxHeight ?? "",
  liftGateSpec: v.liftGateSpec ?? "",
  tagline: v.tagline ?? "",
  description: v.description ?? "",
  features: v.features ?? "",
});

const money = (n: number | null) =>
  n == null || n === 0 ? "Price on quote" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}/day`;

const filledCount = (v: Vehicle) =>
  [v.baseVehicle, v.model, v.fuelType, v.lengthFt, v.heightClearance, v.interiorBoxHeight, v.liftGateSpec, v.tagline, v.description]
    .filter((x) => x != null && String(x).trim() !== "").length;

export default function AdminVehicleCatalogPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SpecForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/vehicle-categories");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load");
      const data = await res.json();
      setVehicles(data.categories ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (v: Vehicle) => { setEditingId(v.id); setForm(toForm(v)); };
  const cancel = () => { setEditingId(null); setForm(emptyForm); };

  const save = async (id: string) => {
    setSaving(true);
    const res = await fetch(`/api/admin/vehicle-categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Failed to save");
      return;
    }
    setEditingId(null);
    load();
  };

  const togglePublished = async (v: Vehicle) => {
    setSaving(true);
    const res = await fetch(`/api/admin/vehicle-categories/${v.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published: !v.published }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Failed to update publish state");
      return;
    }
    load();
  };

  // ---- Photo gallery actions (immediate, then refetch) ----

  const uploadPhoto = async (vehicleId: string, file: File) => {
    setPhotoBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/admin/vehicle-categories/${vehicleId}/photos`, { method: "POST", body: fd });
    setPhotoBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Upload failed");
      return;
    }
    load();
  };

  const patchPhoto = async (vehicleId: string, photoId: string, body: Record<string, unknown>) => {
    setPhotoBusy(true);
    const res = await fetch(`/api/admin/vehicle-categories/${vehicleId}/photos/${photoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setPhotoBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Failed to update photo");
      return;
    }
    load();
  };

  const movePhoto = async (vehicleId: string, photos: Photo[], index: number, dir: -1 | 1) => {
    const a = photos[index];
    const b = photos[index + dir];
    if (!a || !b) return;
    // Swap sortOrder with the neighbor (two PATCHes; refetch happens on the 2nd).
    setPhotoBusy(true);
    await fetch(`/api/admin/vehicle-categories/${vehicleId}/photos/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sortOrder: b.sortOrder }),
    });
    setPhotoBusy(false);
    await patchPhoto(vehicleId, b.id, { sortOrder: a.sortOrder });
  };

  const deletePhoto = async (vehicleId: string, photoId: string) => {
    if (!confirm("Delete this photo?")) return;
    setPhotoBusy(true);
    const res = await fetch(`/api/admin/vehicle-categories/${vehicleId}/photos/${photoId}`, { method: "DELETE" });
    setPhotoBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Failed to delete photo");
      return;
    }
    load();
  };

  const set = (k: keyof SpecForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const field = (label: string, k: keyof SpecForm, placeholder = "") => (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-sirreel-text-muted uppercase tracking-wide">{label}</span>
      <input
        type="text"
        value={form[k]}
        onChange={set(k)}
        placeholder={placeholder}
        className="border border-sirreel-border rounded-md px-2.5 py-1.5 text-sm bg-sirreel-surface focus:outline-none focus:border-sirreel-border-hover"
      />
    </label>
  );

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-sirreel-text">Vehicle Catalog</h1>
        <a href="/admin/asset-categories" className="text-sm font-semibold text-sirreel-text-muted hover:text-sirreel-text">
          Fleet Pricing →
        </a>
      </div>
      <p className="text-sm text-sirreel-text-muted mb-6">
        Public-site content for each vehicle (shown at <code>/vehicles</code>). Name, slug and price
        are set in Fleet Pricing. A vehicle is LIVE for clients only when it&rsquo;s published{" "}
        <b>and</b> has at least one photo. Edits go live on the public pages.
      </p>

      {loading && <p className="text-sirreel-text-muted">Loading…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!loading && !error && (
        <div className="flex flex-col gap-3">
          {vehicles.map((v) => {
            const editing = editingId === v.id;
            return (
              <div key={v.id} className="border border-sirreel-border rounded-lg bg-sirreel-surface">
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sirreel-text">{v.name}</span>
                      {!v.active && (
                        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-chip-neutral-bg text-chip-neutral-fg">
                          Archived
                        </span>
                      )}
                      {v.clientVisible ? (
                        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                          Live
                        </span>
                      ) : (
                        <span
                          className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800"
                          title={
                            v.published
                              ? "Published but has no photo — hidden from clients until a photo is added"
                              : "Not published — hidden from clients"
                          }
                        >
                          {v.published ? "Hidden · no photo" : "Hidden"}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-sirreel-text-dim mt-0.5">
                      <code>/{v.slug}</code> · {money(v.dailyRate)} · {filledCount(v)}/9 specs filled ·{" "}
                      {v.photos.length} photo{v.photos.length === 1 ? "" : "s"}
                      {v.photos.length === 0 && v.hasLegacyImage ? " (legacy image)" : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => togglePublished(v)}
                      disabled={saving}
                      className={`text-sm font-semibold rounded-md px-3 py-1.5 border transition-colors disabled:opacity-50 ${
                        v.published
                          ? "border-sirreel-border text-sirreel-text-muted hover:text-sirreel-text"
                          : "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-500"
                      }`}
                    >
                      {v.published ? "Unpublish" : "Publish"}
                    </button>
                    <a
                      href={`/vehicles/${v.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-semibold text-sirreel-text-muted hover:text-sirreel-text"
                    >
                      View →
                    </a>
                    {!editing && (
                      <button
                        onClick={() => startEdit(v)}
                        className="text-sm font-semibold bg-black text-white rounded-md px-3 py-1.5 hover:bg-gray-800"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>

                {editing && (
                  <div className="border-t border-sirreel-border px-4 py-4">
                    {/* Photo gallery — actions apply immediately (no Save needed). */}
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-sirreel-text-muted uppercase tracking-wide">
                          Photos
                        </span>
                        <label className={`text-sm font-semibold rounded-md px-3 py-1.5 border border-sirreel-border cursor-pointer hover:border-sirreel-border-hover ${photoBusy ? "opacity-50 pointer-events-none" : ""}`}>
                          {photoBusy ? "Working…" : "+ Add photo"}
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) uploadPhoto(v.id, f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                      {v.photos.length === 0 ? (
                        <p className="text-sm text-sirreel-text-dim">
                          No gallery photos yet.
                          {v.hasLegacyImage
                            ? " The public site is using the legacy single image; uploaded photos will replace it."
                            : " This vehicle stays hidden from clients until a photo is added."}
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-3">
                          {v.photos.map((p, i) => (
                            <div key={p.id} className="w-[140px] border border-sirreel-border rounded-md overflow-hidden">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`/api/admin/vehicle-categories/${v.id}/photos/${p.id}`}
                                alt=""
                                className="w-full h-[92px] object-cover bg-sirreel-surface"
                              />
                              <div className="px-1.5 py-1.5 flex flex-col gap-1">
                                {p.isPrimary ? (
                                  <span className="text-[11px] font-semibold text-emerald-700">★ Primary</span>
                                ) : (
                                  <button
                                    onClick={() => patchPhoto(v.id, p.id, { isPrimary: true })}
                                    disabled={photoBusy}
                                    className="text-[11px] font-semibold text-sirreel-text-muted hover:text-sirreel-text text-left disabled:opacity-50"
                                  >
                                    Set primary
                                  </button>
                                )}
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => movePhoto(v.id, v.photos, i, -1)}
                                    disabled={photoBusy || i === 0}
                                    className="text-[12px] px-1 border border-sirreel-border rounded disabled:opacity-30"
                                    title="Move earlier"
                                  >
                                    ←
                                  </button>
                                  <button
                                    onClick={() => movePhoto(v.id, v.photos, i, 1)}
                                    disabled={photoBusy || i === v.photos.length - 1}
                                    className="text-[12px] px-1 border border-sirreel-border rounded disabled:opacity-30"
                                    title="Move later"
                                  >
                                    →
                                  </button>
                                  <button
                                    onClick={() => deletePhoto(v.id, p.id)}
                                    disabled={photoBusy}
                                    className="text-[12px] px-1 border border-sirreel-border rounded text-red-600 ml-auto disabled:opacity-30"
                                    title="Delete photo"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {field("Base vehicle", "baseVehicle", "Ford Transit Cargo")}
                      {field("Model", "model", "350 HD")}
                      {field("Fuel", "fuelType", "Gas / Diesel")}
                      {field("Length (ft)", "lengthFt", "10")}
                      {field("Height clearance", "heightClearance", `9' 6"`)}
                      {field("Interior box height", "interiorBoxHeight", `6' 2"`)}
                      {field("Lift gate", "liftGateSpec", "3,000 lb hydraulic")}
                      {field("Tagline", "tagline", "Short hero line")}
                    </div>
                    <label className="flex flex-col gap-1 mt-3">
                      <span className="text-xs font-semibold text-sirreel-text-muted uppercase tracking-wide">Description</span>
                      <textarea
                        value={form.description}
                        onChange={set("description")}
                        rows={4}
                        placeholder="Longer marketing paragraph…"
                        className="border border-sirreel-border rounded-md px-2.5 py-1.5 text-sm bg-sirreel-surface focus:outline-none focus:border-sirreel-border-hover"
                      />
                    </label>
                    <label className="flex flex-col gap-1 mt-3">
                      <span className="text-xs font-semibold text-sirreel-text-muted uppercase tracking-wide">
                        Features (one per line)
                      </span>
                      <textarea
                        value={form.features}
                        onChange={set("features")}
                        rows={5}
                        placeholder={"Dual sliding doors\nRoof rack\nShore power hookup"}
                        className="border border-sirreel-border rounded-md px-2.5 py-1.5 text-sm bg-sirreel-surface focus:outline-none focus:border-sirreel-border-hover font-mono"
                      />
                    </label>
                    <div className="flex items-center gap-2 mt-4">
                      <button
                        onClick={() => save(v.id)}
                        disabled={saving}
                        className="text-sm font-semibold bg-black text-white rounded-md px-4 py-1.5 hover:bg-gray-800 disabled:opacity-50"
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button
                        onClick={cancel}
                        disabled={saving}
                        className="text-sm font-semibold text-sirreel-text-muted hover:text-sirreel-text px-3 py-1.5"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
