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

  const fmt = (n: string | number | null) =>
    n ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n)) : "--";

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

  const totalValue = items.reduce((sum, i) => {
    const rc = i.replacementCost ? Number(i.replacementCost) : 0;
    return sum + rc * i.qtyOwned;
  }, 0);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Inventory</h1>
          <p className="text-sm text-zinc-400 mt-1">
            {total} items across {categories.length} categories
            {totalValue > 0 && <span className="ml-2">| Est. value: {fmt(totalValue)}</span>}
          </p>
        </div>
      </div>

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

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400 text-left text-xs uppercase tracking-wide">
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium text-center">Qty Owned</th>
              <th className="px-4 py-3 font-medium text-right">Daily Rate</th>
              <th className="px-4 py-3 font-medium text-right">Weekly Rate</th>
              <th className="px-4 py-3 font-medium text-right">Replacement</th>
              <th className="px-4 py-3 font-medium text-right">Total Value</th>
              <th className="px-4 py-3 font-medium w-[80px]"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-zinc-500">Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-zinc-500">No items found</td></tr>
            ) : items.map((item) => (
              <tr key={item.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                <td className="px-4 py-2.5 text-white text-xs">{item.code}</td>
                <td className="px-4 py-2.5 text-zinc-400 text-xs">{item.category.name}</td>
                {editingId === item.id ? (
                  <>
                    <td className="px-4 py-1.5 text-center">
                      <input type="number" value={editValues.qtyOwned} onChange={(e) => setEditValues({...editValues, qtyOwned: e.target.value})}
                        className="w-16 px-1 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-sm text-white text-center" />
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <input type="number" step="0.01" value={editValues.dailyRate} onChange={(e) => setEditValues({...editValues, dailyRate: e.target.value})}
                        className="w-20 px-1 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-sm text-white text-right" />
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <input type="number" step="0.01" value={editValues.weeklyRate} onChange={(e) => setEditValues({...editValues, weeklyRate: e.target.value})}
                        className="w-20 px-1 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-sm text-white text-right" />
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <input type="number" step="0.01" value={editValues.replacementCost} onChange={(e) => setEditValues({...editValues, replacementCost: e.target.value})}
                        className="w-24 px-1 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-sm text-white text-right" />
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-500 text-xs">--</td>
                    <td className="px-4 py-1.5 text-right">
                      <button onClick={() => saveEdit(item.id)} className="text-emerald-400 hover:text-emerald-300 text-xs mr-2">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-zinc-500 hover:text-zinc-300 text-xs">X</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-2.5 text-center text-zinc-300">{item.qtyOwned}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300 font-mono text-xs">{Number(item.dailyRate) > 0 ? fmt(item.dailyRate) : "--"}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300 font-mono text-xs">{fmt(item.weeklyRate)}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300 font-mono text-xs">{fmt(item.replacementCost)}</td>
                    <td className="px-4 py-2.5 text-right text-white font-mono text-xs">
                      {item.replacementCost ? fmt(Number(item.replacementCost) * item.qtyOwned) : "--"}
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
