import { UserPlus } from 'lucide-react';

// Placeholder only — nav entry + stub page. No data model / persistence
// yet; that's a separate task. Lives under Fleet in the sidebar.
export default function GuestDriversPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1a1a1a] text-[#c9a24b]">
          <UserPlus size={26} strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Guest Drivers</h1>
          <p className="mt-1 text-sm text-gray-500">Coming soon.</p>
        </div>
      </div>
    </div>
  );
}
