'use client';

export function ProspectsSection() {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-bold text-white">Prospects</h2>
        <p className="text-[11px] text-zinc-500 mt-0.5">
          Reach-out targets surfaced from your CRM and rental history.
        </p>
      </div>
      <div className="bg-zinc-900 border border-dashed border-zinc-800 rounded-xl p-6 text-center space-y-1">
        <div className="text-xl">✨</div>
        <div className="text-xs font-semibold text-zinc-400">Coming soon</div>
        <div className="text-[11px] text-zinc-600 max-w-md mx-auto leading-relaxed">
          AI-suggested clients to reach out to based on your CRM and rental history.
          Reserved for Phase 5.
        </div>
      </div>
    </section>
  );
}
