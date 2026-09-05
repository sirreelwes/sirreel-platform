'use client'

/** /drive/profile/[token] — a partner's driver completes their own profile. */
import { DriverProfilePageView } from '@/components/drivers/DriverProfilePageView'

export default function DriverProfilePage({ params }: { params: { token: string } }) {
  return <DriverProfilePageView token={params.token} />
}
