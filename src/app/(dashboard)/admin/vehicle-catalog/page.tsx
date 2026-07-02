"use client";

import { useEffect, useState, useCallback } from "react";

/**
 * HQ · Vehicle Catalog — edit the public-site SPEC fields of each
 * VehicleCategory (the cards clients see at /vehicles). Name / slug / price are
 * managed in Fleet Pricing; this page owns the marketing/spec copy. Edits
 * reflect LIVE on the public vehicle pages. Reuses the Fleet Pricing inline-edit
 * pattern: one row open at a time, PATCH then refetch (not optimistic).
 */

type Vehicle = {
  id: string;
  name: string;
  slug: string;
  subtitle: string | null;
  active: boolean;
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
};

const emptyForm: SpecForm = {
  baseVehicle: "", model: "", fuelType: "", lengthFt: "", heightClearance: "",
  interiorBoxHeight: "", liftGateSpec: "", tagline: "", description: "",
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

  const load = useCallback(async () => {
    setLoading(true);
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
        Public-site spec copy for each vehicle (shown at <code>/vehicles</code>). Name, slug and price
        are set in Fleet Pricing. Edits go live on the public pages.
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
                    </div>
                    <div className="text-xs text-sirreel-text-dim mt-0.5">
                      <code>/{v.slug}</code> · {money(v.dailyRate)} · {filledCount(v)}/9 specs filled
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
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
                        Edit specs
                      </button>
                    )}
                  </div>
                </div>

                {editing && (
                  <div className="border-t border-sirreel-border px-4 py-4">
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
                    <div className="flex items-center gap-2 mt-4">
                      <button
                        onClick={() => save(v.id)}
                        disabled={saving}
                        className="text-sm font-semibold bg-black text-white rounded-md px-4 py-1.5 hover:bg-gray-800 disabled:opacity-50"
                      >
                        {saving ? "Saving…" : "Save specs"}
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
