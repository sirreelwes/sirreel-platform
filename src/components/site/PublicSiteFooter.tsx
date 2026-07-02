/**
 * Shared public-site footer — matches the order-form footer copy/brand.
 */
export function PublicSiteFooter() {
  return (
    <footer className="bg-[#0c0c0d] text-[#8b857a] border-t border-black">
      <div className="max-w-[1480px] mx-auto px-5 py-8 text-[13px] leading-relaxed">
        <div className="font-black text-lg text-white" style={{ fontFamily: 'Archivo, sans-serif' }}>
          Sir<span className="text-[#c39a3f]">Reel</span>
        </div>
        <p className="mt-2">
          SirReel Studio Services · 8500 Lankershim Blvd, Sun Valley, CA 91352 · 888.477.7335 ·
          info@sirreel.com
        </p>
      </div>
    </footer>
  )
}
