'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarDays, ClipboardList, Home, Settings, Truck, Users } from 'lucide-react'

const ITEMS = [
  { seg: '', label: 'Today', Icon: Home },
  { seg: 'calendar', label: 'Calendar', Icon: CalendarDays },
  { seg: 'bookings', label: 'Bookings', Icon: ClipboardList },
  { seg: 'fleet', label: 'Fleet', Icon: Truck },
  { seg: 'clients', label: 'Clients', Icon: Users },
  { seg: 'settings', label: 'Settings', Icon: Settings },
]

export function HqNav({ base }: { base: string }) {
  const pathname = usePathname()
  return (
    <nav className="flex gap-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0" aria-label="Workspace">
      {ITEMS.map(({ seg, label, Icon }) => {
        const href = seg ? `${base}/${seg}` : base
        const active = seg ? pathname === href || pathname.startsWith(`${href}/`) : pathname === base
        return (
          <Link
            key={label}
            href={href}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[14px] font-semibold transition-colors ${
              active ? 'bg-[var(--hq-accent)] text-white' : 'text-[#4b5563] hover:bg-[#eef0f3] hover:text-[#111827]'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
