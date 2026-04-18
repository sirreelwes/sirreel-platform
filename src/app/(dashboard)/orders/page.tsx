"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

type Order = {
  id: string;
  orderNumber: string;
  status: string;
  description: string | null;
  subtotal: string;
  total: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  company: { id: string; name: string };
  agent: { id: string; name: string };
  booking: { id: string; bookingNumber: string; jobName: string } | null;
  _count: { lineItems: number; invoices: number };
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-zinc-700 text-zinc-300",
  QUOTE_SENT: "bg-amber-900/60 text-amber-300",
  CONFIRMED: "bg-blue-900/60 text-blue-300",
  ACTIVE: "bg-emerald-900/60 text-emerald-300",
  RETURNED: "bg-purple-900/60 text-purple-300",
  CLOSED: "bg-zinc-800 text-zinc-400",
  CANCELLED: "bg-red-900/60 text-red-300",
};

const ALL_STATUSES = ["DRAFT", "QUOTE_SENT", "CONFIRMED", "ACTIVE", "RETURNED", "CLOSED", "CANCELLED"];

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    params.set("page", String(page));
    params.set("limit", "25");

    const res = await fetch(`/api/orders?${params}`);
    const data = await res.json();
    setOrders(data.orders || []);
    setTotal(data.total || 0);
    setLoading(false);
  }, [search, statusFilter, page]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const fmt = (n: string | number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "--";

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Orders</h1>
          <p className="text-sm text-zinc-400 mt-1">
            {total} order{total !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => router.push("/orders/new-quote")}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            ✨ AI Quote
          </button>
          <button
            onClick={() => router.push("/orders/new")}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            + New Order
          </button>
        </div>
      </div>

      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Search orders, companies..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 max-w-sm px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-zinc-500"
        >
          <option value="">All Statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400 text-left">
              <th className="px-4 py-3 font-medium">Order #</th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Dates</th>
              <th className="px-4 py-3 font-medium text-right">Total</th>
              <th className="px-4 py-3 font-medium text-center">Items</th>
              <th className="px-4 py-3 font-medium">Agent</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-zinc-500">
                  Loading...
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-zinc-500">
                  No orders found
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr
                  key={order.id}
                  onClick={() => router.push(`/orders/${order.id}`)}
                  className="border-b border-zinc-800/50 hover:bg-zinc-800/50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="font-mono text-white">{order.orderNumber}</span>
                  </td>
                  <td className="px-4 py-3 text-white">{order.company.name}</td>
                  <td className="px-4 py-3 text-zinc-400 max-w-[200px] truncate">
                    {order.description || (order.booking ? order.booking.jobName : "--")}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[order.status] || "bg-zinc-700 text-zinc-300"}`}>
                      {order.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                    {fmtDate(order.startDate)} - {fmtDate(order.endDate)}
                  </td>
                  <td className="px-4 py-3 text-right text-white font-mono">
                    {fmt(order.total)}
                  </td>
                  <td className="px-4 py-3 text-center text-zinc-400">
                    {order._count.lineItems}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{order.agent.name}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > 25 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-zinc-400">
            Page {page} of {Math.ceil(total / 25)}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-300 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= Math.ceil(total / 25)}
              className="px-3 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-300 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
