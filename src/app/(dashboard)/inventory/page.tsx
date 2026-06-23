"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { AddItemModal } from "@/components/inventory/AddItemModal";
import { InventoryItemDrawer, type DrawerItem } from "@/components/inventory/InventoryItemDrawer";

type Category = { id: string; name: string; _count: { items: number } };
type LocationOption = { id: string; name: string; code: string };
type Item = {
  id: string;
  code: string;
  description: string | null;
  dailyRate: string;
  weeklyRate: string;
  qtyOwned: number;
  replacementCost: string | null;
  imageUrl: string | null;
  preferredVendorId: string | null;
  preferredVendor: { id: string; name: string; website: string | null; isActive: boolean } | null;
  vendorItemUrl: string | null;
  location: string; // legacy enum value, kept for fallback display
  locationRef: { id: string; name: string; code: string } | null;
  category: { id: string; name: string } | null;
  isActive: boolean;
  archivedAt: string | null;
};

// Category color-coding — stable per-category palette built only from
// existing design tokens (no ad-hoc hexes). A hash of the category id
// picks a {bar, pill} pair so the same category always reads the same.
const CAT_PALETTE = [
  { bar: "bg-cadence-booked-bar", pill: "bg-pill-quoted-bg text-pill-quoted-fg" },
  { bar: "bg-cadence-on-rental-bar", pill: "bg-pill-active-bg text-pill-active-fg" },
  { bar: "bg-cadence-returning-today-bar", pill: "bg-pill-hold-bg text-pill-hold-fg" },
  { bar: "bg-cadence-returned-bar", pill: "bg-cadence-returned-bg text-cadence-returned-fg" },
  { bar: "bg-cadence-invoiced-bar", pill: "bg-cadence-invoiced-bg text-cadence-invoiced-fg" },
  { bar: "bg-cadence-picking-today-bar", pill: "bg-cadence-picking-today-bg text-cadence-picking-today-fg" },
  { bar: "bg-chip-bad-fg", pill: "bg-pill-lost-bg text-pill-lost-fg" },
];
function catColor(id: string | null) {
  if (!id) return { bar: "bg-lt-fg3", pill: "bg-chip-neutral-bg text-chip-neutral-fg" };
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CAT_PALETTE[h % CAT_PALETTE.length];
}

export default function InventoryPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const [showArchived, setShowArchived] = useState(false);

  // Single editor drawer + add-item modal.
  const [drawerItem, setDrawerItem] = useState<Item | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // Bulk operations
  const [showBulk, setShowBulk] = useState(false);
  const [bulkField, setBulkField] = useState("weeklyRate");
  const [bulkPct, setBulkPct] = useState("");
  const [bulkCatId, setBulkCatId] = useState("");
  const [bulkMsg, setBulkMsg] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reassignCatId, setReassignCatId] = useState("");

  const fmt = (n: string | number | null) =>
    n && Number(n) > 0 ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n)) : "--";

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (categoryId) params.set("categoryId", categoryId);
    if (showArchived) params.set("archived", "1");
    params.set("page", String(page));
    params.set("limit", "50");

    const res = await fetch(`/api/inventory/items?${params}`);
    const data = await res.json();
    setItems(data.items || []);
    setTotal(data.total || 0);
    setCategories(data.categories || []);
    setLocations(data.locations || []);
    setLoading(false);
  }, [search, categoryId, page, showArchived]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const applyBulkUpdate = async () => {
    if (!bulkPct) return;
    const catName = bulkCatId ? categories.find(c => c.id === bulkCatId)?.name : "ALL categories";
    const fieldLabel = bulkField === "dailyRate" ? "daily rates" : bulkField === "weeklyRate" ? "weekly rates" : "replacement costs";
    if (!confirm(`Apply ${Number(bulkPct) > 0 ? "+" : ""}${bulkPct}% to ${fieldLabel} for ${catName}?`)) return;
    const res = await fetch("/api/inventory/bulk-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "percentage_change", field: bulkField, percentage: parseFloat(bulkPct), categoryId: bulkCatId || undefined }),
    });
    const data = await res.json();
    setBulkMsg(data.message || "Updated");
    setBulkPct("");
    fetchItems();
    setTimeout(() => setBulkMsg(""), 3000);
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const toggleAll = () => setSelected(selected.size === items.length ? new Set() : new Set(items.map(i => i.id)));

  const bulkReassign = async () => {
    if (!reassignCatId || selected.size === 0) return;
    const catName = categories.find(c => c.id === reassignCatId)?.name;
    if (!confirm(`Move ${selected.size} item(s) to ${catName}?`)) return;
    await fetch("/api/inventory/bulk-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reassign_category", itemIds: Array.from(selected), categoryId: reassignCatId }),
    });
    setSelected(new Set());
    setReassignCatId("");
    fetchItems();
  };

  // Header stats — recompute live from the loaded rows (refetch on every
  // save/archive/delete keeps them current without a full reload).
  const totalOwned = items.reduce((s, i) => s + i.qtyOwned, 0);
  const totalValue = items.reduce((s, i) => s + (i.replacementCost ? Number(i.replacementCost) : 0) * i.qtyOwned, 0);

  return (
    <div className="p-6 max-w-[1600px] mx-auto bg-lt-page min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-lt-fg">Inventory{showArchived && <span className="text-chip-bad-fg"> · Archived</span>}</h1>
          <p className="text-sm text-lt-fg2 mt-1 font-medium">
            {total} items · {totalOwned} units owned
            {totalValue > 0 && <span> · Est. value: <span className="text-lt-fg font-bold">{fmt(totalValue)}</span></span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowArchived(v => !v); setPage(1); setSelected(new Set()); }}
            className={`px-4 py-2 text-sm font-semibold rounded-lg border transition-colors ${showArchived ? "bg-chip-bad-bg text-chip-bad-fg border-chip-bad-fg/30" : "bg-lt-card text-lt-fg2 border-lt-hairline hover:bg-lt-inner"}`}
          >
            {showArchived ? "← Active items" : "Archived"}
          </button>
          <Link href="/inventory/wizard" className="px-4 py-2 text-sm font-semibold rounded-lg bg-lt-card hover:bg-lt-inner border border-lt-hairline text-lt-fg transition-colors">
            Values &amp; Photos Wizard
          </Link>
          <button onClick={() => setShowAdd(true)} className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors">
            + Add Item
          </button>
          <button onClick={() => setShowBulk(!showBulk)} className={`px-4 py-2 text-sm font-semibold rounded-lg border transition-colors ${showBulk ? "bg-lt-inner text-lt-fg border-lt-hairline" : "bg-lt-fg hover:bg-black text-white border-lt-fg"}`}>
            {showBulk ? "Close Tools" : "Bulk Tools"}
          </button>
        </div>
      </div>

      {/* Bulk Tools Panel */}
      {showBulk && (
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-5 mb-4 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-lt-fg mb-3">Adjust Pricing by Percentage</h3>
            <div className="flex gap-3 items-end flex-wrap">
              <div>
                <label className="block text-xs text-lt-fg2 mb-1 font-semibold">Rate Field</label>
                <select value={bulkField} onChange={(e) => setBulkField(e.target.value)} className="px-3 py-2 bg-lt-card border border-lt-hairline rounded-lg text-sm text-lt-fg">
                  <option value="dailyRate">Daily Rate</option>
                  <option value="weeklyRate">Weekly Rate</option>
                  <option value="replacementCost">Replacement Cost</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-lt-fg2 mb-1 font-semibold">Category</label>
                <select value={bulkCatId} onChange={(e) => setBulkCatId(e.target.value)} className="px-3 py-2 bg-lt-card border border-lt-hairline rounded-lg text-sm text-lt-fg">
                  <option value="">All Categories</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-lt-fg2 mb-1 font-semibold">% Change</label>
                <input type="number" step="0.1" value={bulkPct} onChange={(e) => setBulkPct(e.target.value)} placeholder="e.g. 10 or -5" className="w-32 px-3 py-2 bg-lt-card border border-lt-hairline rounded-lg text-sm text-lt-fg placeholder-lt-fg3" />
              </div>
              <button onClick={applyBulkUpdate} disabled={!bulkPct} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-lt-inner disabled:text-lt-fg3 text-white text-sm font-bold rounded-lg transition-colors">Apply</button>
            </div>
            {bulkMsg && <p className="text-sm text-chip-good-fg mt-2 font-semibold">{bulkMsg}</p>}
          </div>
          {selected.size > 0 && (
            <div className="border-t border-lt-hairline pt-4">
              <h3 className="text-sm font-bold text-lt-fg mb-3">Reassign {selected.size} Selected Item{selected.size > 1 ? "s" : ""}</h3>
              <div className="flex gap-3 items-end">
                <div>
                  <label className="block text-xs text-lt-fg2 mb-1 font-semibold">Move to Category</label>
                  <select value={reassignCatId} onChange={(e) => setReassignCatId(e.target.value)} className="px-3 py-2 bg-lt-card border border-lt-hairline rounded-lg text-sm text-lt-fg">
                    <option value="">Select category...</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <button onClick={bulkReassign} disabled={!reassignCatId} className="px-4 py-2 bg-lt-fg hover:bg-black disabled:bg-lt-inner disabled:text-lt-fg3 text-white text-sm font-bold rounded-lg transition-colors">Move Items</button>
                <button onClick={() => setSelected(new Set())} className="px-3 py-2 text-lt-fg2 hover:text-lt-fg text-sm">Clear Selection</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input type="text" placeholder="Search items..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 max-w-sm px-3 py-2 bg-lt-card border border-lt-hairline rounded-lg text-sm text-lt-fg placeholder-lt-fg3 focus:outline-none focus:border-amber-500" />
        <select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-lt-card border border-lt-hairline rounded-lg text-sm text-lt-fg focus:outline-none focus:border-amber-500">
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({c._count.items})</option>)}
        </select>
        {selected.size > 0 && !showBulk && <span className="text-sm text-amber-700 self-center font-semibold">{selected.size} selected</span>}
      </div>

      {/* Table */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-lt-hairline text-lt-fg2 text-left text-xs uppercase tracking-wide bg-lt-inner/50">
              <th className="px-3 py-3 w-[40px]">
                <input type="checkbox" checked={items.length > 0 && selected.size === items.length} onChange={toggleAll} className="w-4 h-4 rounded border-lt-hairline" />
              </th>
              <th className="px-3 py-3 font-bold">Item</th>
              <th className="px-3 py-3 font-bold">Category</th>
              <th className="px-3 py-3 font-bold text-center">Qty</th>
              <th className="px-3 py-3 font-bold text-right">Daily</th>
              <th className="px-3 py-3 font-bold text-right">Weekly</th>
              <th className="px-3 py-3 font-bold text-right">Replacement</th>
              <th className="px-3 py-3 font-bold">Location</th>
              <th className="px-3 py-3 font-bold text-right">Total Value</th>
              <th className="px-3 py-3 font-bold w-[70px]"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-lt-fg3">Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-lt-fg3">{showArchived ? "No archived items" : "No items found"}</td></tr>
            ) : items.map((item) => {
              const cc = catColor(item.category?.id ?? null);
              const lineTotal = item.replacementCost && Number(item.replacementCost) > 0 ? Number(item.replacementCost) * item.qtyOwned : 0;
              return (
                <tr
                  key={item.id}
                  onClick={() => setDrawerItem(item)}
                  className={`border-b border-lt-hairline/70 hover:bg-lt-inner/60 cursor-pointer ${selected.has(item.id) ? "bg-amber-50" : ""}`}
                >
                  <td className="px-3 py-2.5 relative" onClick={(e) => e.stopPropagation()}>
                    <span className={`absolute left-0 top-0 bottom-0 w-1 ${cc.bar}`} aria-hidden />
                    <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} className="w-4 h-4 rounded border-lt-hairline ml-1" />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex-none w-10 h-10 rounded bg-lt-inner border border-lt-hairline overflow-hidden flex items-center justify-center text-lt-fg3 text-[10px]">
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/inventory/items/${item.id}/image?v=${encodeURIComponent(item.imageUrl)}`} alt="" className="w-full h-full object-cover" />
                        ) : <span>—</span>}
                      </div>
                      <div className="min-w-0">
                        <div className="text-lt-fg font-semibold truncate">{item.description || item.code}</div>
                        <div className="text-[11px] text-lt-fg3 font-mono">{item.code}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${cc.pill}`}>{item.category?.name || "Uncategorized"}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center text-lt-fg font-semibold tabular-nums">{item.qtyOwned}</td>
                  <td className="px-3 py-2.5 text-right text-lt-fg font-mono tabular-nums">{fmt(item.dailyRate)}</td>
                  <td className="px-3 py-2.5 text-right text-lt-fg font-mono tabular-nums">{fmt(item.weeklyRate)}</td>
                  <td className="px-3 py-2.5 text-right text-lt-fg2 font-mono tabular-nums">{fmt(item.replacementCost)}</td>
                  <td className="px-3 py-2.5 text-lt-fg2">{item.locationRef?.name || item.location.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums font-bold text-chip-good-fg">{lineTotal > 0 ? fmt(lineTotal) : <span className="text-lt-fg3 font-normal">--</span>}</td>
                  <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setDrawerItem(item)} className="text-amber-700 hover:text-amber-600 text-sm font-semibold">{showArchived ? "View" : "Edit"}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > 50 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-lt-fg2">Page {page} of {Math.ceil(total / 50)}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 bg-lt-card border border-lt-hairline rounded text-sm text-lt-fg disabled:opacity-40">Prev</button>
            <button onClick={() => setPage((p) => p + 1)} disabled={page >= Math.ceil(total / 50)} className="px-3 py-1 bg-lt-card border border-lt-hairline rounded text-sm text-lt-fg disabled:opacity-40">Next</button>
          </div>
        </div>
      )}

      <AddItemModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={() => fetchItems()}
        categories={categories}
        locations={locations}
        defaultCategoryId={categoryId || undefined}
      />

      <InventoryItemDrawer
        open={drawerItem !== null}
        item={drawerItem as DrawerItem | null}
        categories={categories}
        locations={locations}
        onClose={() => setDrawerItem(null)}
        onSaved={() => fetchItems()}
        onArchived={() => fetchItems()}
        onDeleted={() => fetchItems()}
      />
    </div>
  );
}
