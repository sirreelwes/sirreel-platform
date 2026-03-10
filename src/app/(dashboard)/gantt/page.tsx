export default function GanttPage() {
  const info: Record<string, { icon: string; title: string; desc: string }> = {
    gantt: { icon: '📊', title: 'Gantt Timeline', desc: 'Category-based booking timeline with drag-and-drop assignments' },
    bookings: { icon: '📋', title: 'Bookings', desc: 'All rental bookings with status tracking and smart booking' },
    maintenance: { icon: '🔧', title: 'Maintenance', desc: 'Active repairs, scheduled service, and cost tracking' },
    dispatch: { icon: '📦', title: 'Dispatch', desc: 'Delivery and pickup task board — managed by Hugo' },
    crm: { icon: '👥', title: 'Clients', desc: 'Client profiles, booking history, follow-up tracking, and email campaigns' },
    claims: { icon: '🛡️', title: 'Insurance Claims', desc: 'AI-generated demand letters, loss-of-revenue calculations, and claim lifecycle tracking' },
    reporting: { icon: '📈', title: 'Reporting', desc: 'Fleet utilization, revenue analytics, and agent performance' },
  };

  const data = info['gantt'];

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <div className="text-5xl mb-4">{data.icon}</div>
        <h1 className="text-xl font-bold text-white mb-2">{data.title}</h1>
        <p className="text-sm text-[#666] max-w-md">{data.desc}</p>
        <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#111] border border-[#1a1a1a] text-sm text-[#555]">
          Building next...
        </div>
      </div>
    </div>
  );
}
