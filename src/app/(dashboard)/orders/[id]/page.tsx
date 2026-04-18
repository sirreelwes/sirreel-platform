"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";

type LineItem = {
  id: string;
  sortOrder: number;
  type: string;
  description: string;
  rateType: string;
  rate: string;
  quantity: number;
  days: number | null;
  lineTotal: string;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  inventoryItem: { id: string; code: string; description: string } | null;
  assetCategory: { id: string; name: string } | null;
};

type Order = {
  id: string;
  orderNumber: string;
  status: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  subtotal: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  notes: string | null;
  createdAt: string;
  company: { id: string; name: string };
  agent: { id: string; name: string };
  booking: { id: string; bookingNumber: string; jobName: string; productionName: string | null } | null;
  lineItems: LineItem[];
  invoices: { id: string; invoiceNumber: string; status: string; total: string }[];
};

type AssetCat = { id: string; name: string; slug: string; dailyRate: string; weeklyRate: string | null };
type InvItem = { id: string; code: string; description: string; category: { id: string; name: string } };

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-zinc-700 text-zinc-300",
  QUOTE_SENT: "bg-amber-900/60 text-amber-300",
  CONFIRMED: "bg-blue-900/60 text-blue-300",
  ACTIVE: "bg-emerald-900/60 text-emerald-300",
  RETURNED: "bg-purple-900/60 text-purple-300",
  CLOSED: "bg-zinc-800 text-zinc-400",
  CANCELLED: "bg-red-900/60 text-red-300",
};

const LINE_TYPES = ["VEHICLE", "EQUIPMENT", "EXPENDABLE", "LABOR", "FEE", "DISCOUNT"] as const;

const STATUS_ACTIONS: Record<string, { label: string; next: string; color: string }[]> = {
  DRAFT: [{ label: "Send Quote", next: "QUOTE_SENT", color: "bg-amber-600 hover:bg-amber-500" }],
  QUOTE_SENT: [
    { label: "Confirm Order", next: "CONFIRMED", color: "bg-blue-600 hover:bg-blue-500" },
    { label: "Back to Draft", next: "DRAFT", color: "bg-zinc-600 hover:bg-zinc-500" },
  ],
  CONFIRMED: [{ label: "Mark Active", next: "ACTIVE", color: "bg-emerald-600 hover:bg-emerald-500" }],
  ACTIVE: [{ label: "Mark Returned", next: "RETURNED", color: "bg-purple-600 hover:bg-purple-500" }],
  RETURNED: [{ label: "Close Order", next: "CLOSED", color: "bg-zinc-600 hover:bg-zinc-500" }],
};

export default function OrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = params.id as string;

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [assetCats, setAssetCats] = useState<AssetCat[]>([]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [liType, setLiType] = useState<string>("EQUIPMENT");
  const [liDesc, setLiDesc] = useState("");
  const [liAssetCatId, setLiAssetCatId] = useState("");
  const [liInvItemId, setLiInvItemId] = useState("");
  const [liStartDate, setLiStartDate] = useState("");
  const [liEndDate, setLiEndDate] = useState("");
  const [liRateType, setLiRateType] = useState("DAILY");
  const [liRate, setLiRate] = useState("");
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState("");
  const [editQty, setEditQty] = useState("");
  const [editDays, setEditDays] = useState("");
  const [liQty, setLiQty] = useState("1");
  const [adding, setAdding] = useState(false);

  const [invSearch, setInvSearch] = useState("");
  const [invResults, setInvResults] = useState<InvItem[]>([]);
  const [showInvDropdown, setShowInvDropdown] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  const fmt = (n: string | number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));

  const fmtDate = (d: string | null) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "--";

  const fetchOrder = useCallback(async () => {
    const res = await fetch(`/api/orders/${orderId}`);
    if (!res.ok) { router.push("/orders"); return; }
    const data = await res.json();
    setOrder(data);
    setLoading(false);
  }, [orderId, router]);

  useEffect(() => {
    fetchOrder();
    fetch("/api/orders/lookups").then((r) => r.json()).then((data) => {
      setAssetCats(data.assetCategories || []);
    });
  }, [fetchOrder]);

  useEffect(() => {
    if (invSearch.length < 2) { setInvResults([]); return; }
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      const res = await fetch(`/api/inventory/search?q=${encodeURIComponent(invSearch)}&limit=10`);
      const data = await res.json();
      setInvResults(data.items || []);
      setShowInvDropdown(true);
    }, 250);
  }, [invSearch]);

  useEffect(() => {
    if (showAddForm && order) {
      if (order.startDate && !liStartDate) setLiStartDate(order.startDate.split("T")[0]);
      if (order.endDate && !liEndDate) setLiEndDate(order.endDate.split("T")[0]);
    }
  }, [showAddForm, order]);

  const updateStatus = async (newStatus: string) => {
    await fetch(`/api/orders/${orderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    fetchOrder();
  };

  const cancelOrder = async () => {
    if (!confirm("Cancel this order? This cannot be undone.")) return;
    await updateStatus("CANCELLED");
  };

  const deleteOrder = async () => {
    if (!confirm("Delete this draft order?")) return;
    await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
    router.push("/orders");
  };

  const selectAssetCategory = (cat: AssetCat) => {
    setLiAssetCatId(cat.id);
    setLiDesc(cat.name);
    setLiRate(String(Number(cat.dailyRate)));
    setLiRateType("DAILY");
  };

  const selectInventoryItem = (item: InvItem) => {
    setLiInvItemId(item.id);
    setLiDesc(item.description || item.code);
    setInvSearch(item.code);
    setShowInvDropdown(false);
  };

  const resetForm = () => {
    setLiType("EQUIPMENT"); setLiDesc(""); setLiAssetCatId(""); setLiInvItemId("");
    setLiStartDate(order?.startDate?.split("T")[0] || "");
    setLiEndDate(order?.endDate?.split("T")[0] || "");
    setLiRateType("DAILY"); setLiRate(""); setLiQty("1");
    setInvSearch(""); setInvResults([]);
  };

  const addLineItem = async () => {
    if (!liDesc || !liRate) return;
    setAdding(true);
    await fetch(`/api/orders/${orderId}/line-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: liType, description: liDesc,
        inventoryItemId: liInvItemId || null,
        assetCategoryId: liAssetCatId || null,
        startDate: liStartDate || null, endDate: liEndDate || null,
        rateType: liRateType, rate: parseFloat(liRate),
        quantity: parseInt(liQty) || 1,
      }),
    });
    resetForm(); setAdding(false); fetchOrder();
  };

  const startEditLine = (li: LineItem) => {
    setEditingLineId(li.id);
    setEditRate(String(Number(li.rate)));
    setEditQty(String(li.quantity));
    setEditDays(li.days !== null && li.days !== undefined ? String(li.days) : "");
  };

  const saveEditLine = async (lineId: string) => {
    const body: Record<string, unknown> = {
      rate: parseFloat(editRate) || 0,
      quantity: parseInt(editQty) || 1,
    };
    if (editDays !== "") body.days = parseFloat(editDays);
    await fetch(`/api/orders/${order?.id}/line-items/${lineId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setEditingLineId(null);
    fetchOrder();
  };

  const deleteLineItem = async (lineId: string) => {
    await fetch(`/api/orders/${orderId}/line-items/${lineId}`, { method: "DELETE" });
    fetchOrder();
  };

  if (loading || !order) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <p className="text-zinc-500">Loading order...</p>
      </div>
    );
  }

  const actions = STATUS_ACTIONS[order.status] || [];
  const isEditable = ["DRAFT", "QUOTE_SENT"].includes(order.status);

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <button onClick={() => router.push("/orders")} className="text-sm text-zinc-400 hover:text-white mb-4 inline-block">
        &larr; Back to Orders
      </button>

      {/* Order Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-semibold text-white font-mono">{order.orderNumber}</h1>
              <span className={`px-2.5 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[order.status]}`}>
                {order.status.replace("_", " ")}
              </span>
            </div>
            <p className="text-zinc-400">{order.description || "No description"}</p>
          </div>
          <div className="flex gap-2">
            {actions.map((action) => (
              <button key={action.next} onClick={() => updateStatus(action.next)}
                className={`px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors ${action.color}`}>
                {action.label}
              </button>
            ))}
            {order.status !== "CANCELLED" && order.status !== "CLOSED" && (
              <button onClick={cancelOrder} className="px-3 py-2 text-red-400 hover:text-red-300 text-sm">Cancel</button>
            )}
            {order.status === "DRAFT" && (
              <button onClick={deleteOrder} className="px-3 py-2 text-zinc-500 hover:text-red-400 text-sm">Delete</button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-6 text-sm">
          <div><span className="text-zinc-500">Company</span><p className="text-white mt-0.5">{order.company.name}</p></div>
          <div><span className="text-zinc-500">Agent</span><p className="text-white mt-0.5">{order.agent.name}</p></div>
          <div><span className="text-zinc-500">Dates</span><p className="text-white mt-0.5">{fmtDate(order.startDate)} - {fmtDate(order.endDate)}</p></div>
          <div><span className="text-zinc-500">Linked Booking</span><p className="text-white mt-0.5">
            {order.booking ? <a href={`/jobs/${order.booking.id}`} className="text-blue-400 hover:text-blue-300">{order.booking.bookingNumber}</a> : <span className="text-zinc-500">None</span>}
          </p></div>
        </div>
      </div>

      {/* Line Items */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-6">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-white">Line Items</h2>
          {isEditable && (
            <button onClick={() => { setShowAddForm(!showAddForm); if (!showAddForm) resetForm(); }}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">
              {showAddForm ? "Cancel" : "+ Add Item"}
            </button>
          )}
        </div>

        {showAddForm && isEditable && (
          <div className="px-6 py-4 bg-zinc-800/50 border-b border-zinc-800 space-y-4">
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-zinc-500 mb-1">Type</label>
                <select value={liType} onChange={(e) => { setLiType(e.target.value); setLiDesc(""); setLiAssetCatId(""); setLiInvItemId(""); setInvSearch(""); }}
                  className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white focus:outline-none focus:border-zinc-500">
                  {LINE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="col-span-5">
                <label className="block text-xs text-zinc-500 mb-1">
                  {liType === "VEHICLE" ? "Vehicle" : liType === "EQUIPMENT" || liType === "EXPENDABLE" ? "Search Inventory" : "Description"}
                </label>
                {liType === "VEHICLE" ? (
                  <select value={liAssetCatId} onChange={(e) => { const cat = assetCats.find((c) => c.id === e.target.value); if (cat) selectAssetCategory(cat); }}
                    className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white focus:outline-none focus:border-zinc-500">
                    <option value="">Select vehicle...</option>
                    {assetCats.map((c) => <option key={c.id} value={c.id}>{c.name} ({fmt(c.dailyRate)}/day)</option>)}
                  </select>
                ) : liType === "EQUIPMENT" || liType === "EXPENDABLE" ? (
                  <div className="relative">
                    <input type="text" value={invSearch} onChange={(e) => setInvSearch(e.target.value)}
                      onFocus={() => invResults.length > 0 && setShowInvDropdown(true)}
                      placeholder="Type to search inventory..."
                      className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500" />
                    {showInvDropdown && invResults.length > 0 && (
                      <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-[200px] overflow-y-auto">
                        {invResults.map((item) => (
                          <button key={item.id} onClick={() => selectInventoryItem(item)}
                            className="w-full px-3 py-2 text-left hover:bg-zinc-700 text-sm text-white flex justify-between">
                            <span className="font-mono">{item.code}</span>
                            <span className="text-zinc-400 text-xs">{item.category.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <input type="text" value={liDesc} onChange={(e) => setLiDesc(e.target.value)} placeholder="e.g. Day Player Grip, Delivery Fee..."
                    className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500" />
                )}
              </div>
              <div className="col-span-5">
                <label className="block text-xs text-zinc-500 mb-1">Description (on invoice)</label>
                <input type="text" value={liDesc} onChange={(e) => setLiDesc(e.target.value)}
                  className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white focus:outline-none focus:border-zinc-500" />
              </div>
            </div>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-zinc-500 mb-1">Start</label>
                <input type="date" value={liStartDate} onChange={(e) => setLiStartDate(e.target.value)}
                  className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white focus:outline-none focus:border-zinc-500" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-zinc-500 mb-1">End</label>
                <input type="date" value={liEndDate} onChange={(e) => setLiEndDate(e.target.value)}
                  className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white focus:outline-none focus:border-zinc-500" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-zinc-500 mb-1">Rate Type</label>
                <select value={liRateType} onChange={(e) => setLiRateType(e.target.value)}
                  className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white focus:outline-none focus:border-zinc-500">
                  <option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="FLAT">Flat</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-zinc-500 mb-1">Rate ($)</label>
                <input type="number" step="0.01" value={liRate} onChange={(e) => setLiRate(e.target.value)}
                  className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white focus:outline-none focus:border-zinc-500" />
              </div>
              <div className="col-span-1">
                <label className="block text-xs text-zinc-500 mb-1">Qty</label>
                <input type="number" min="1" value={liQty} onChange={(e) => setLiQty(e.target.value)}
                  className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-white focus:outline-none focus:border-zinc-500" />
              </div>
              <div className="col-span-3 flex items-end gap-2">
                <button onClick={addLineItem} disabled={!liDesc || !liRate || adding}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded transition-colors">
                  {adding ? "Adding..." : "Add"}
                </button>
                <button onClick={() => setShowAddForm(false)} className="px-3 py-1.5 text-zinc-400 hover:text-white text-sm transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500 text-left text-xs uppercase tracking-wide">
              <th className="px-6 py-2.5 font-medium w-[80px]">Type</th>
              <th className="px-4 py-2.5 font-medium">Description</th>
              <th className="px-4 py-2.5 font-medium">Dates</th>
              <th className="px-4 py-2.5 font-medium">Rate</th>
              <th className="px-4 py-2.5 font-medium text-center">Qty</th>
              <th className="px-4 py-2.5 font-medium text-center">Days</th>
              <th className="px-4 py-2.5 font-medium text-right">Total</th>
              {isEditable && <th className="px-4 py-2.5 font-medium w-[40px]"></th>}
            </tr>
          </thead>
          <tbody>
            {order.lineItems.length === 0 ? (
              <tr><td colSpan={isEditable ? 8 : 7} className="px-6 py-8 text-center text-zinc-500">
                No line items yet. Click \"+ Add Item\" to start building this order.
              </td></tr>
            ) : (
              order.lineItems.map((li) => (
                <tr key={li.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-6 py-3">
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                      li.type === "VEHICLE" ? "bg-blue-900/40 text-blue-300" :
                      li.type === "DISCOUNT" ? "bg-red-900/40 text-red-300" :
                      li.type === "FEE" ? "bg-amber-900/40 text-amber-300" :
                      "bg-zinc-700 text-zinc-300"
                    }`}>{li.type}</span>
                  </td>
                  <td className="px-4 py-3 text-white">{li.description}</td>
                  <td className="px-4 py-3 text-zinc-400 whitespace-nowrap text-xs">
                    {li.startDate ? `${fmtDate(li.startDate)} - ${fmtDate(li.endDate)}` : "--"}
                  </td>
                  {editingLineId === li.id ? (
                    <>
                      <td className="px-4 py-2">
                        <input type="number" step="0.01" value={editRate} onChange={(e) => setEditRate(e.target.value)}
                          className="w-24 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-xs text-white text-right font-mono" />
                        <span className="text-zinc-500 text-xs ml-1">/{li.rateType === "FLAT" ? "flat" : li.rateType === "WEEKLY" ? "wk" : "day"}</span>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <input type="number" value={editQty} onChange={(e) => setEditQty(e.target.value)}
                          className="w-14 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-xs text-white text-center" />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <input type="number" step="0.5" value={editDays} onChange={(e) => setEditDays(e.target.value)}
                          placeholder="auto"
                          className="w-14 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-xs text-white text-center" />
                      </td>
                      <td className="px-4 py-3 text-right text-white font-mono">{fmt(li.lineTotal)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <button onClick={() => saveEditLine(li.id)} className="text-emerald-400 hover:text-emerald-300 text-xs mr-2">Save</button>
                        <button onClick={() => setEditingLineId(null)} className="text-zinc-500 hover:text-zinc-300 text-xs">X</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-zinc-300 whitespace-nowrap">
                        {fmt(li.rate)}<span className="text-zinc-500 text-xs">/{li.rateType === "FLAT" ? "flat" : li.rateType === "WEEKLY" ? "wk" : "day"}</span>
                      </td>
                      <td className="px-4 py-3 text-center text-zinc-300">{li.quantity}</td>
                      <td className="px-4 py-3 text-center text-zinc-400">{li.days ?? "--"}</td>
                      <td className="px-4 py-3 text-right text-white font-mono">{fmt(li.lineTotal)}</td>
                      {isEditable && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button onClick={() => startEditLine(li)} className="text-zinc-500 hover:text-blue-400 text-xs mr-2">Edit</button>
                          <button onClick={() => deleteLineItem(li.id)} className="text-zinc-500 hover:text-red-400 transition-colors" title="Remove">&times;</button>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>

        {order.lineItems.length > 0 && (
          <div className="px-6 py-4 border-t border-zinc-800 flex justify-end">
            <div className="w-[280px] space-y-1.5 text-sm">
              <div className="flex justify-between text-zinc-400">
                <span>Subtotal</span><span className="font-mono text-zinc-300">{fmt(order.subtotal)}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Tax ({(Number(order.taxRate) * 100).toFixed(1)}%)</span><span className="font-mono text-zinc-300">{fmt(order.taxAmount)}</span>
              </div>
              <div className="flex justify-between text-white font-semibold pt-1.5 border-t border-zinc-700">
                <span>Total</span><span className="font-mono">{fmt(order.total)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-3">Notes</h2>
        <p className="text-zinc-400 text-sm whitespace-pre-wrap">{order.notes || "No notes."}</p>
        <p className="text-xs text-zinc-600 mt-4">
          Created {new Date(order.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </p>
      </div>
    </div>
  );
}
