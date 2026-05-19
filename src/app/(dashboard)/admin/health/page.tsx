"use client";

import { useEffect, useState, useCallback } from "react";

type ServiceStatus = "healthy" | "degraded" | "down";

interface ServiceHealth {
  status: ServiceStatus;
  latencyMs?: number;
  error?: string;
  lastChecked: string;
  [k: string]: unknown;
}

interface HealthReport {
  timestamp: string;
  overall: ServiceStatus;
  services: {
    anthropic: ServiceHealth & { model?: string; errorKind?: string };
    resend: ServiceHealth & { sirreelDomainStatus?: string };
    neon: ServiceHealth;
    rentalworks: ServiceHealth & { httpStatus?: number };
    cloudflare_dns: ServiceHealth & { hqCname?: string; sirreelA?: string[]; hqResolves?: boolean };
  };
}

interface HistoryRow {
  id: string;
  checkedAt: string;
  overall: ServiceStatus;
  alertedAt: string | null;
  alertDetail: string | null;
  services: HealthReport["services"];
}

const SERVICE_LABELS: Record<keyof HealthReport["services"], string> = {
  anthropic: "Anthropic (Claude API)",
  resend: "Resend (Email)",
  neon: "Neon (Postgres)",
  rentalworks: "RentalWorks API",
  cloudflare_dns: "DNS (hq.sirreel.com)",
};

function StatusBadge({ status }: { status: ServiceStatus }) {
  const styles =
    status === "healthy"
      ? "bg-emerald-900/40 text-emerald-300 border-emerald-800/60"
      : status === "degraded"
        ? "bg-amber-900/40 text-amber-300 border-amber-800/60"
        : "bg-red-900/40 text-red-300 border-red-800/60";
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${styles}`}>
      {status.toUpperCase()}
    </span>
  );
}

function ServiceCard({
  label,
  service,
  extras,
}: {
  label: string;
  service: ServiceHealth;
  extras?: { label: string; value: string }[];
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-sm font-semibold text-white">{label}</h3>
        <StatusBadge status={service.status} />
      </div>
      <div className="text-xs text-zinc-400 space-y-1">
        {typeof service.latencyMs === "number" && (
          <div>
            <span className="text-zinc-500">Latency:</span> {service.latencyMs}ms
          </div>
        )}
        {extras?.map(e => (
          <div key={e.label}>
            <span className="text-zinc-500">{e.label}:</span> {e.value}
          </div>
        ))}
        <div>
          <span className="text-zinc-500">Checked:</span>{" "}
          {new Date(service.lastChecked).toLocaleTimeString()}
        </div>
        {service.error && (
          <div className="mt-2 text-amber-300/90 bg-amber-900/10 border border-amber-900/40 rounded px-2 py-1 break-words">
            {service.error}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminHealthPage() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (runFresh: boolean) => {
    if (runFresh) setRunning(true);
    else setLoading(true);
    try {
      const res = await fetch(runFresh ? "/api/admin/health" : "/api/admin/health?history=24");
      if (res.status === 403) {
        setError("Admin access required.");
        return;
      }
      if (res.status === 401) {
        setError("Sign in required.");
        return;
      }
      const data = await res.json();
      if (runFresh) {
        setReport(data);
        // After a fresh probe, refresh history so the new row appears at top.
        const h = await fetch("/api/admin/health?history=24").then(r => r.json());
        setHistory(h.history || []);
      } else {
        setHistory(data.history || []);
      }
    } finally {
      setRunning(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial load: pull most recent history row to show current state,
    // then immediately run a fresh probe.
    (async () => {
      await load(false);
      await load(true);
    })();
  }, [load]);

  if (error) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="bg-red-900/20 border border-red-800 text-red-200 rounded-xl p-4 text-sm">{error}</div>
      </div>
    );
  }

  const current =
    report ??
    (history[0]
      ? ({
          timestamp: history[0].checkedAt,
          overall: history[0].overall,
          services: history[0].services,
        } as HealthReport)
      : null);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">System Health</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Live probes of the external services SirReel HQ depends on. Cron runs hourly; Slack
            alerts fire when something flips to degraded or down (suppressed for 4h after).
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={running}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {running ? "Running…" : "Run check now"}
        </button>
      </div>

      {loading && !current ? (
        <div className="text-zinc-500 text-sm">Loading…</div>
      ) : !current ? (
        <div className="text-zinc-500 text-sm">No data yet — click "Run check now".</div>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3 text-sm text-zinc-400">
            <span className="text-zinc-500">Overall:</span>
            <StatusBadge status={current.overall} />
            <span className="text-zinc-500">
              · last checked {new Date(current.timestamp).toLocaleString()}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <ServiceCard
              label={SERVICE_LABELS.anthropic}
              service={current.services.anthropic}
              extras={[
                current.services.anthropic.model
                  ? { label: "Model", value: current.services.anthropic.model }
                  : null,
                current.services.anthropic.errorKind
                  ? { label: "Failure kind", value: current.services.anthropic.errorKind }
                  : null,
              ].filter(Boolean) as { label: string; value: string }[]}
            />
            <ServiceCard
              label={SERVICE_LABELS.resend}
              service={current.services.resend}
              extras={
                current.services.resend.sirreelDomainStatus
                  ? [{ label: "sirreel.com", value: current.services.resend.sirreelDomainStatus }]
                  : []
              }
            />
            <ServiceCard label={SERVICE_LABELS.neon} service={current.services.neon} />
            <ServiceCard
              label={SERVICE_LABELS.rentalworks}
              service={current.services.rentalworks}
              extras={
                typeof current.services.rentalworks.httpStatus === "number"
                  ? [{ label: "HTTP", value: String(current.services.rentalworks.httpStatus) }]
                  : []
              }
            />
            <ServiceCard
              label={SERVICE_LABELS.cloudflare_dns}
              service={current.services.cloudflare_dns}
              extras={[
                current.services.cloudflare_dns.hqCname
                  ? { label: "hq CNAME", value: current.services.cloudflare_dns.hqCname }
                  : null,
                current.services.cloudflare_dns.sirreelA?.length
                  ? {
                      label: "sirreel.com A",
                      value: current.services.cloudflare_dns.sirreelA.join(", "),
                    }
                  : null,
              ].filter(Boolean) as { label: string; value: string }[]}
            />
          </div>

          <h2 className="text-sm font-semibold text-white mb-2">Last 24 hours</h2>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400 text-left text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Overall</th>
                  <th className="px-4 py-3 font-medium">Anthropic</th>
                  <th className="px-4 py-3 font-medium">Resend</th>
                  <th className="px-4 py-3 font-medium">Neon</th>
                  <th className="px-4 py-3 font-medium">RW</th>
                  <th className="px-4 py-3 font-medium">DNS</th>
                  <th className="px-4 py-3 font-medium text-center">Alerted</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
                      No history yet
                    </td>
                  </tr>
                ) : (
                  history.map(row => (
                    <tr key={row.id} className="border-b border-zinc-800/50">
                      <td className="px-4 py-2 text-zinc-400 text-xs whitespace-nowrap">
                        {new Date(row.checkedAt).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={row.overall} />
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={row.services.anthropic.status} />
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={row.services.resend.status} />
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={row.services.neon.status} />
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={row.services.rentalworks.status} />
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={row.services.cloudflare_dns.status} />
                      </td>
                      <td className="px-4 py-2 text-center">
                        {row.alertedAt ? (
                          <span
                            title={row.alertDetail || undefined}
                            className="text-amber-300 text-xs"
                          >
                            sent
                          </span>
                        ) : (
                          <span className="text-zinc-600 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
