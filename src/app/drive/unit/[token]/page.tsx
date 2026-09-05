'use client'

/**
 * /drive/unit/[token] — a PARTNER's driver's page. Body in
 * components/drivers/DriverUnitPageView so HQ can preview it.
 */
import { DriverUnitPageView } from '@/components/drivers/DriverUnitPageView'

export default function DriverUnitPage({ params }: { params: { token: string } }) {
  return <DriverUnitPageView token={params.token} />
}
