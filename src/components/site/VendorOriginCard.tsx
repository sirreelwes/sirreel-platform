/**
 * Start location — where SirReel expects this unit to leave from.
 *
 * Wes 2026-09-07: "we cannot give them an option to change start location.
 * That is our choice — it should just say that we expect start location to
 * be here." So this is a statement. The partner's lot on file (set by HQ on
 * the vendor record) is the start point for hours and mileage; a booking-
 * level override is HQ's to set, never the partner's. Nothing here posts.
 * A partner who thinks it is wrong replies to the booking email.
 *
 * (Until 2026-09-07 this card let the partner edit their lot and set a
 * per-booking origin; the POST behind it now refuses.)
 */
export default function VendorOriginCard({
  lotAddress, originAddress, unitName,
}: { token?: string; lotAddress: string | null; originAddress: string | null; unitName: string; readOnly?: boolean }) {
  const effective = originAddress || lotAddress
  const eyebrow = 'text-[12px] font-semibold tracking-[0.16em] uppercase text-[#8b857a]'
  return (
    <div className="mt-6 rounded-[14px] border border-[#e4dfd4] bg-white p-5">
      <div className={`${eyebrow} mb-1`} style={{ fontFamily: 'Archivo, sans-serif' }}>Start location</div>
      {effective ? (
        <>
          <p className="text-[15px] font-semibold text-[#0c0c0d] whitespace-pre-line">{effective}</p>
          <p className="mt-1 text-[13px] text-[#5a554c]">
            We expect the {unitName} to leave from here{originAddress ? ' for this booking' : ''}. Hours and mileage start from this point.
            If that&rsquo;s not right, reply to your booking email.
          </p>
        </>
      ) : (
        <p className="text-[14px] text-[#5a554c]">
          We expect the {unitName} to leave from your lot. SirReel sets the address on your account; if you don&rsquo;t see it here, reply to your booking email.
        </p>
      )}
    </div>
  )
}
