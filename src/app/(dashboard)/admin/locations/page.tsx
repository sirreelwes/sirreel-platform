"use client";

import { useEffect, useState, useCallback } from "react";

type Location = {
  id: string;
  name: string;
  code: string;
  sortOrder: number;
  isActive: boolean;
  _count: { items: number };
};

export default function AdminLocationsPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ name: string; sortOrder: string }>({ name: "", sortOrder: "" });

  const [newName, setNewName] = useState("");
  const [newSortOrder, setNewSortOrder] = useState("100");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/locations");
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
    setLocations(data.locations || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (loc: Location) => {
    setEditingId(loc.id);
    setEditValues({ name: loc.name, sortOrder: String(loc.sortOrder) });
  };

  const saveEdit = async (id: string) => {
    const res = await fetch(`/api/admin/locations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editValues.name, sortOrder: Number(editValues.sortOrder) }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Failed to save");
      return;
    }
    setEditingId(null);
    load();
  };

  const toggleActive = async (loc: Location) => {
    const res = await fetch(`/api/admin/locations/${loc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !loc.isActive }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Failed to update");
      return;
    }
    load();
  };

  const removeLocation = async (loc: Location) => {
    if (loc._count.items > 0) {
      alert(`Cannot delete: ${loc._count.items} item(s) still use this location. Deactivate instead.`);
      return;
    }
    if (!confirm(`Delete "${loc.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/locations/${loc.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Failed to delete");
      return;
    }
    load();
  };

  const createLocation = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/admin/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), sortOrder: Number(newSortOrder) || 100 }),
    });
    setCreating(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Failed to create");
      return;
    }
    setNewName("");
    setNewSortOrder("100");
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
        <h1 className="text-2xl font-semibold text-white">Inventory Locations</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Manage the locations that appear in the inventory edit dropdown. Deactivate to hide from the dropdown without breaking existing items.
        </p>
      </div>

      {/* Create */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
        <h2 className="text-sm font-semibold text-white mb-3">Add Location</h2>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs text-zinc-500 mb-1">Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Burbank Annex"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Sort</label>
            <input
              type="number"
              value={newSortOrder}
              onChange={(e) => setNewSortOrder(e.target.value)}
              className="w-20 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white text-center"
            />
          </div>
          <button
            onClick={createLocation}
            disabled={!newName.trim() || creating}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {creating ? "Adding…" : "Add"}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400 text-left text-xs uppercase tracking-wide">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium text-center">Sort</th>
              <th className="px-4 py-3 font-medium text-center">Items</th>
              <th className="px-4 py-3 font-medium text-center">Active</th>
              <th className="px-4 py-3 font-medium text-right w-[180px]"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">Loading…</td></tr>
            ) : locations.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">No locations yet</td></tr>
            ) : locations.map((loc) => (
              <tr key={loc.id} className={`border-b border-zinc-800/50 ${!loc.isActive ? "opacity-50" : ""}`}>
                <td className="px-4 py-2">
                  {editingId === loc.id ? (
                    <input
                      type="text"
                      value={editValues.name}
                      onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                      className="w-full px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-sm text-white"
                    />
                  ) : (
                    <span className="text-white">{loc.name}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-zinc-500 font-mono text-xs">{loc.code}</td>
                <td className="px-4 py-2 text-center">
                  {editingId === loc.id ? (
                    <input
                      type="number"
                      value={editValues.sortOrder}
                      onChange={(e) => setEditValues({ ...editValues, sortOrder: e.target.value })}
                      className="w-16 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-sm text-white text-center"
                    />
                  ) : (
                    <span className="text-zinc-400">{loc.sortOrder}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-center text-zinc-400">{loc._count.items}</td>
                <td className="px-4 py-2 text-center">
                  <button
                    onClick={() => toggleActive(loc)}
                    className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${loc.isActive ? "bg-emerald-900/40 text-emerald-300" : "bg-zinc-800 text-zinc-500"}`}
                  >
                    {loc.isActive ? "Active" : "Inactive"}
                  </button>
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {editingId === loc.id ? (
                    <>
                      <button onClick={() => saveEdit(loc.id)} className="text-emerald-400 hover:text-emerald-300 text-xs mr-3">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-zinc-500 hover:text-zinc-300 text-xs">Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(loc)} className="text-zinc-400 hover:text-blue-400 text-xs mr-3">Edit</button>
                      <button
                        onClick={() => removeLocation(loc)}
                        disabled={loc._count.items > 0}
                        className="text-zinc-500 hover:text-red-400 disabled:hover:text-zinc-700 disabled:cursor-not-allowed text-xs"
                        title={loc._count.items > 0 ? "Deactivate first — items still reference this location" : "Delete"}
                      >
                        Delete
                      </button>
                    </>
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
