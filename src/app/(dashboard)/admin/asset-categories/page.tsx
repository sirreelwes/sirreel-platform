"use client";

import { useEffect, useState, useCallback } from "react";

type Category = {
  id: string;
  name: string;
  slug: string;
  department: string;
  totalUnits: number;
  sortOrder: number;
  dailyRate: string;
  weeklyRate: string | null;
};

const money = (v: string | null) =>
  v == null || v === "" ? "—" : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AdminAssetCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ dailyRate: string; weeklyRate: string }>({ dailyRate: "", weeklyRate: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/asset-categories");
    if (res.status === 403) {
      setError("Admin access required.");
      setLoading(false);
      return;
    }
    if (res.status === 401) {
      setError("Sign in required.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setCategories(data.categories || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditValues({ dailyRate: cat.dailyRate ?? "", weeklyRate: cat.weeklyRate ?? "" });
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    const res = await fetch(`/api/admin/asset-categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dailyRate: editValues.dailyRate,
        weeklyRate: editValues.weeklyRate === "" ? null : editValues.weeklyRate,
      }),
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

  if (error) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="bg-red-900/20 border border-red-800 text-red-200 rounded-xl p-4 text-sm">{error}</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Fleet Pricing</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Edit the daily / weekly rate for each fleet category (Cube Truck, PopVan, Studios…). Changing a rate sets the
          default for <span className="text-zinc-300">future</span> quote lines only — existing orders keep the price they were
          booked at. Every change is logged.
        </p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400 text-left text-xs uppercase tracking-wide">
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Dept</th>
              <th className="px-4 py-3 font-medium text-center">Units</th>
              <th className="px-4 py-3 font-medium text-right">Daily</th>
              <th className="px-4 py-3 font-medium text-right">Weekly</th>
              <th className="px-4 py-3 font-medium text-right w-[160px]"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">Loading…</td></tr>
            ) : categories.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">No categories</td></tr>
            ) : categories.map((cat) => (
              <tr key={cat.id} className="border-b border-zinc-800/50">
                <td className="px-4 py-2">
                  <span className="text-white">{cat.name}</span>
                  <span className="block text-zinc-600 font-mono text-[11px]">{cat.slug}</span>
                </td>
                <td className="px-4 py-2 text-zinc-400 text-xs">{cat.department}</td>
                <td className="px-4 py-2 text-center text-zinc-400">{cat.totalUnits}</td>
                <td className="px-4 py-2 text-right">
                  {editingId === cat.id ? (
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={editValues.dailyRate}
                      onChange={(e) => setEditValues({ ...editValues, dailyRate: e.target.value })}
                      className="w-24 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-sm text-white text-right tabular-nums"
                    />
                  ) : (
                    <span className="text-white tabular-nums">{money(cat.dailyRate)}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {editingId === cat.id ? (
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={editValues.weeklyRate}
                      onChange={(e) => setEditValues({ ...editValues, weeklyRate: e.target.value })}
                      placeholder="—"
                      className="w-24 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-sm text-white text-right tabular-nums"
                    />
                  ) : (
                    <span className="text-zinc-400 tabular-nums">{money(cat.weeklyRate)}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {editingId === cat.id ? (
                    <>
                      <button
                        onClick={() => saveEdit(cat.id)}
                        disabled={saving}
                        className="text-emerald-400 hover:text-emerald-300 disabled:text-zinc-600 text-xs mr-3"
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button onClick={() => setEditingId(null)} className="text-zinc-500 hover:text-zinc-300 text-xs">Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => startEdit(cat)} className="text-zinc-400 hover:text-blue-400 text-xs">Edit</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
