"use client";

import { useEffect, useState, useCallback } from "react";

type Category = { id: string; name: string; _count: { items: number } };
type Item = {
  id: string;
  code: string;
  description: string | null;
  dailyRate: string;
  weeklyRate: string;
  qtyOwned: number;
  replacementCost: string | null;
  imageUrl: string | null;
  category: { id: string; name: string };
};

export default function InventoryPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  // Bulk update state
  const [showBulk, setShowBulk] = useState(false);
  const [bulkField, setBulkField] = useState("weeklyRate");
  const [bulkPct, setBulkPct] = useState("");
  const [bulkCatId, setBulkCatId] = useState("");
  const [bulkMsg, setBulkMsg] = useState("");

  const fmt = (n: string | number | null) =>
    n && Number(n) > 0 ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n)) : "--";

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (categoryId) params.set("categoryId", categoryId);
    params.set("page", String(page));
    params.set("limit", "50");

    const res = await fetch(`/api/inventory/items?${params}`);
    const data = await res.json();
    setItems(data.items || []);
    setTotal(data.total || 0);
    setCategories(data.categories || []);
    setLoading(false);
  }, [search, categoryId, page]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const startEdit = (item: Item) => {
    setEditingId(item.id);
    setEditValues({
      dailyRate: String(Number(item.dailyRate)),
      weeklyRate: String(Number(item.weeklyRate)),
      qtyOwned: String(item.qtyOwned),
      replacementCost: item.replacementCost ? String(Number(item.replacementCost)) : "",
      description: item.description || item.code,
    });
  };

  const saveEdit = async (id: string) => {
    await fetch(`/api/inventory/items/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editValues),
    });
    setEditingId(null);
    fetchItems();
  };

  const applyBulkUpdate = async () => {
    if (!bulkPct) return;
    const confirmed = confirm(
      `Apply ${Number(bulkPct) > 0 ? "+" : ""}${bulkPct}% to ${bulkField === "dailyRate" ? "daily rates" : bulkField === "weeklyRate" ? "weekly rates" : "replacement costs"} for ${bulkCatId ? categories.find(c => c.id === bulkCatId)?.name : "ALL categories"}?`
    );
    if (!confirmed) return;

    const res = await fetch("/api/inventory/bulk-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "percentage_change",
        field: bulkField,
        percentage: parseFloat(bulkPct),
        categoryId: bulkCatId || undefined,
      }),
    });
    const data = await res.json();
    setBulkMsg(data.message || "Updated");
    setBulkPct("");
    fetchItems();
    setTimeout(() => setBulkMsg(""), 3000);
  };

  const totalOwned = items.reduce((s, i) => s + i.qtyOwned, 0);
  const totalValue = items.reduce((s, i) => {
    const rc = i.replacementCost ? Number(i.replacementCost) : 0;
    return s + rc * i.qtyOwned;
  }, 0);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Inventory</h1>
          <p className="text-sm text-zinc-400 mt-1">
            {total} items | {totalOwned} units owned
            {totalValue > 0 && <span> | Est. value: {fmt(totalValue)}</span>}
          </p>
        </div>
        <button
          onClick={() => setShowBulk(!showBulk)}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${showBulk ? "bg-zinc-700 text-zinc-300" : "bg-blue-600 hover:bg-blue-500 text-white"}`}
        >
          {showBulk ? "Close" : "Bulk Pricing"}
        </button>
      </div>

      {/* Bulk Pricing Panel */}
      {showBulk && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-4">
          <h3 className="text-sm font-semibold text-white mb-3">Adjust Pricing by Percentage</h3>
          <div className="flex gap-3 items-end">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Rate Field</label>
              <select value={bulkField} onChange={(e) => setBulkField(e.target.value)}
                className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white">
                <option value="dailyRate">Daily Rate</option>
                <option value="weeklyRate">Weekly Rate</option>
                <option value="replacementCost">Replacement Cost</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Category</label>
              <select value={bulkCatId} onChange={(e) => setBulkCatId(e.target.value)}
                className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white">
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">% Change</label>
              <input
                type="number"
                step="0.1"
                value={bulkPct}
                onChange={(e) => setBulkPct(e.target.value)}
                placeholder="e.g. 10 or -5"
                className="w-32 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500"
              />
            </div>
            <button
              onClick={applyBulkUpdate}
              disabled={!bulkPct}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Apply
            </button>
          </div>
          {bulkMsg && <p className="text-sm text-emerald-400 mt-2">{bulkMsg}</p>}
          <p className="text-xs text-zinc-500 mt-2">
            Use positive numbers to increase (e.g. 10 = +10%) or negative to decrease (e.g. -5 = -5%). Only items with existing rates above $0 are affected.
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Search items..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 max-w-sm px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
        />
        <select
          value={categoryId}
          onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-500"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c._count.items})
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400 text-left text-xs uppercase tracking-wide">
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium text-center">Qty</th>
              <th className="px-4 py-3 font-medium text-right">Daily</th>
              <th className="px-4 py-3 font-medium text-right">Weekly</th>
              <th className="px-4 py-3 font-medium text-right">Replacement</th>
              <th className="px-4 py-3 font-medium text-right">Total Value</th>
              <th className="px-4 py-3 font-medium w-[100px]"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-zinc-500">Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-zinc-500">No items found</td></tr>
            ) : items.map((item) => (
              <tr key={item.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                <td className="px-4 py-2.5 text-xs">
                  {editingId === item.id ? (
                    <input type="text" value={editValues.description} onChange={(e) => setEditValues({...editValues, description: e.target.value})}
                      className="w-full px-1 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-xs text-white" />
                  ) : (
                    <span className="text-white">{item.description || item.code}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-zinc-400 text-xs">{item.category.name}</td>
                {editingId === item.id ? (
                  <>
                    <td className="px-4 py-1.5 text-center">
                      <input type="number" value={editValues.qtyOwned} onChange={(e) => setEditValues({...editValues, qtyOwned: e.target.value})}
                        className="w-16 px-1 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-xs text-white text-center" />
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <input type="number" step="0.01" value={editValues.dailyRate} onChange={(e) => setEditValues({...editValues, dailyRate: e.target.value})}
                        className="w-20 px-1 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-xs text-white text-right" />
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <input type="number" step="0.01" value={editValues.weeklyRate} onChange={(e) => setEditValues({...editValues, weeklyRate: e.target.value})}
                        className="w-20 px-1 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-xs text-white text-right" />
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <input type="number" step="0.01" value={editValues.replacementCost} onChange={(e) => setEditValues({...editValues, replacementCost: e.target.value})}
                        className="w-24 px-1 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-xs text-white text-right" />
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-500 text-xs">--</td>
                    <td className="px-4 py-1.5 text-right whitespace-nowrap">
                      <button onClick={() => saveEdit(item.id)} className="text-emerald-400 hover:text-emerald-300 text-xs mr-2">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-zinc-500 hover:text-zinc-300 text-xs">Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-2.5 text-center text-zinc-300">{item.qtyOwned}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300 font-mono text-xs">{fmt(item.dailyRate)}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300 font-mono text-xs">{fmt(item.weeklyRate)}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300 font-mono text-xs">{fmt(item.replacementCost)}</td>
                    <td className="px-4 py-2.5 text-right text-white font-mono text-xs">
                      {item.replacementCost && Number(item.replacementCost) > 0 ? fmt(Number(item.replacementCost) * item.qtyOwned) : "--"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => startEdit(item)} className="text-zinc-500 hover:text-blue-400 text-xs">Edit</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 50 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-zinc-400">Page {page} of {Math.ceil(total / 50)}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-300 disabled:opacity-40">Prev</button>
            <button onClick={() => setPage((p) => p + 1)} disabled={page >= Math.ceil(total / 50)}
              className="px-3 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-300 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
