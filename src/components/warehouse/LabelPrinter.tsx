'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Tag, Printer, AlertTriangle, Search } from 'lucide-react'
import { DEFAULT_STOCK, LABEL_STOCKS, MAX_MINT_PER_BATCH, type LabelStockId } from '@/lib/warehouse/unitLabels'

type CatalogHit = { id: string; code: string; description: string }
type Minted = { id: string; barcode: string; serialNumber: string | null }
type Check = { units: Array<{ barcode: string; itemCode: string; name: string }>; missing: string[] }

const STOCK_IDS = Object.keys(LABEL_STOCKS) as LabelStockId[]

function sheetUrl(codes: string[], stock: LabelStockId, skip: number): string {
  const q = new URLSearchParams({ codes: codes.join(','), stock, skip: String(skip) })
  return `/api/warehouse/units/labels?${q.toString()}`
}

const inputCls =
  'w-full bg-lt-card border border-lt-hairline rounded-lg px-3 py-2.5 text-[16px] text-lt-fg placeholder:text-lt-fg3 focus:border-amber-500 focus:outline-none'
const labelCls = 'block text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold mb-1'
const primaryBtn =
  'inline-flex items-center gap-1.5 text-[14px] font-semibold rounded-lg px-3 py-2.5 bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50'
const secondaryBtn =
  'inline-flex items-center gap-1.5 text-[14px] font-semibold rounded-lg px-3 py-2.5 bg-lt-inner border border-lt-hairline text-lt-fg hover:border-amber-500 disabled:opacity-50'

function StockPicker({
  stock, setStock, skip, setSkip,
}: { stock: LabelStockId; setStock: (s: LabelStockId) => void; skip: number; setSkip: (n: number) => void }) {
  const perPage = LABEL_STOCKS[stock].cols * LABEL_STOCKS[stock].rows
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
      <div>
        <label className={labelCls} htmlFor={`stock-${stock}`}>Label stock</label>
        <select
          id={`stock-${stock}`}
          value={stock}
          onChange={(e) => { setStock(e.target.value as LabelStockId); setSkip(0) }}
          className={inputCls}
        >
          {STOCK_IDS.map((id) => (
            <option key={id} value={id}>{LABEL_STOCKS[id].name} — {LABEL_STOCKS[id].compatible}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelCls} htmlFor="skip">Skip used cells</label>
        <input
          id="skip"
          type="number"
          min={0}
          max={perPage - 1}
          value={skip}
          onChange={(e) => setSkip(Math.max(0, Math.min(perPage - 1, Number(e.target.value) || 0)))}
          className={`${inputCls} w-28`}
        />
      </div>
    </div>
  )
}

export function LabelPrinter({ initialItem = null }: { initialItem?: CatalogHit | null }) {
  // ── New labels ──────────────────────────────────────────────────
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<CatalogHit[]>([])
  const [item, setItem] = useState<CatalogHit | null>(initialItem)
  const [count, setCount] = useState(1)
  const [serials, setSerials] = useState('')
  const [stock, setStock] = useState<LabelStockId>(DEFAULT_STOCK)
  const [skip, setSkip] = useState(0)
  const [minting, setMinting] = useState(false)
  const [mintError, setMintError] = useState<string | null>(null)
  const [minted, setMinted] = useState<{ item: CatalogHit; units: Minted[] } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (!initialItem) searchRef.current?.focus() }, [initialItem])

  useEffect(() => {
    if (item || q.trim().length < 2) { setHits([]); return }
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/inventory/search?q=${encodeURIComponent(q.trim())}&limit=8`, { signal: ctl.signal })
        const data = await res.json().catch(() => ({ items: [] }))
        setHits((data.items ?? []) as CatalogHit[])
      } catch { /* aborted */ }
    }, 150)
    return () => { clearTimeout(t); ctl.abort() }
  }, [q, item])

  const serialLines = useMemo(
    () => serials.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    [serials],
  )
  const effectiveCount = serialLines.length || count

  async function mint() {
    if (!item || minting) return
    setMinting(true)
    setMintError(null)
    try {
      const res = await fetch('/api/warehouse/units/mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inventoryItemId: item.id,
          count: effectiveCount,
          serialNumbers: serialLines.length ? serialLines : undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setMintError(data.error || `Minting failed (${res.status}).`); return }
      setMinted({ item, units: data.units as Minted[] })
      window.open(sheetUrl((data.units as Minted[]).map((u) => u.barcode), stock, skip), '_blank', 'noopener')
    } catch (e) {
      setMintError(e instanceof Error ? e.message : 'Minting failed.')
    } finally {
      setMinting(false)
    }
  }

  // ── Reprint ─────────────────────────────────────────────────────
  const [codesText, setCodesText] = useState('')
  const [rStock, setRStock] = useState<LabelStockId>(DEFAULT_STOCK)
  const [rSkip, setRSkip] = useState(0)
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<Check | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const codes = useMemo(
    () => Array.from(new Set(codesText.split(/[\s,]+/).map((c) => c.trim().toUpperCase().replace(/^\*|\*$/g, '')).filter(Boolean))),
    [codesText],
  )

  async function runCheck() {
    if (!codes.length || checking) return
    setChecking(true)
    setCheckError(null)
    try {
      const res = await fetch(`${sheetUrl(codes, rStock, rSkip)}&check=1`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setCheckError(data.error || `Check failed (${res.status}).`); setCheck(null); return }
      setCheck(data as Check)
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : 'Check failed.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* ── New labels ─────────────────────────────────────────── */}
      <section className="bg-lt-card border border-lt-hairline rounded-xl p-4 space-y-4">
        <div>
          <div className="text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold mb-1">New labels</div>
          <p className="text-[13px] text-lt-fg2">
            Pick the catalog item, say how many pieces, and each piece gets its own SR number from HQ&rsquo;s block
            (SR900000 up — RentalWorks never issues those). The sheet opens as a PDF; print it at 100%, not fit to page.
          </p>
        </div>

        <div className="relative">
          <label className={labelCls} htmlFor="item-search">Catalog item</label>
          {item ? (
            <div className="flex items-center gap-3 bg-lt-inner border border-lt-hairline rounded-lg px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-lt-fg text-[16px] font-semibold truncate">{item.description}</div>
                <div className="text-lt-fg2 text-[13px] font-mono">{item.code}</div>
              </div>
              <button type="button" onClick={() => { setItem(null); setMinted(null); setQ(''); requestAnimationFrame(() => searchRef.current?.focus()) }} className="text-[13px] font-semibold text-amber-700 hover:text-amber-600">
                Change
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search size={15} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-lt-fg3" />
                <input
                  id="item-search"
                  ref={searchRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by code or name — CP200, hazer, generator…"
                  autoComplete="off"
                  className={`${inputCls} pl-9`}
                />
              </div>
              {hits.length > 0 && (
                <ul className="absolute z-10 left-0 right-0 mt-1 bg-lt-card border border-lt-hairline rounded-lg shadow-lg overflow-hidden">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        onClick={() => { setItem(h); setHits([]); setMinted(null) }}
                        className="w-full text-left px-3 py-2 hover:bg-lt-inner"
                      >
                        <div className="text-lt-fg text-[15px]">{h.description}</div>
                        <div className="text-lt-fg2 text-[12px] font-mono">{h.code}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-3">
          <div>
            <label className={labelCls} htmlFor="count">How many</label>
            <input
              id="count"
              type="number"
              min={1}
              max={MAX_MINT_PER_BATCH}
              value={serialLines.length || count}
              disabled={serialLines.length > 0}
              onChange={(e) => setCount(Math.max(1, Math.min(MAX_MINT_PER_BATCH, Number(e.target.value) || 1)))}
              className={`${inputCls} w-28`}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="serials">Serial numbers <span className="normal-case tracking-normal font-normal">(optional, one per line — sets the count)</span></label>
            <textarea
              id="serials"
              value={serials}
              onChange={(e) => setSerials(e.target.value)}
              rows={3}
              spellCheck={false}
              className={`${inputCls} font-mono`}
            />
          </div>
        </div>

        <StockPicker stock={stock} setStock={setStock} skip={skip} setSkip={setSkip} />

        {mintError && (
          <p className="text-[13px] text-chip-bad-fg bg-chip-bad-bg rounded-lg px-3 py-2 flex items-start gap-1.5">
            <AlertTriangle size={13} aria-hidden className="flex-none mt-0.5" />
            {mintError}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void mint()} disabled={!item || minting || effectiveCount < 1} className={primaryBtn}>
            <Tag size={15} aria-hidden />
            {minting ? 'Minting…' : `Mint ${effectiveCount} label${effectiveCount === 1 ? '' : 's'} & open sheet`}
          </button>
          <span className="text-[12px] text-lt-fg3">The numbers are taken the moment you press this, even if the sheet is not printed.</span>
        </div>

        {minted && (
          <div className="bg-chip-good-bg border border-chip-good-fg/20 rounded-lg p-3">
            <div className="text-[12px] uppercase tracking-wide font-semibold text-chip-good-fg mb-1">
              Minted for {minted.item.code}
            </div>
            <div className="text-[15px] text-lt-fg font-mono break-words">
              {minted.units.map((u) => u.barcode).join('  ')}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <a href={sheetUrl(minted.units.map((u) => u.barcode), stock, skip)} target="_blank" rel="noopener" className={secondaryBtn}>
                <Printer size={15} aria-hidden /> Open the sheet again
              </a>
              <Link href={`/warehouse/units`} className="inline-flex items-center text-[13px] font-semibold text-amber-700 hover:text-amber-600 px-1">
                Find a unit →
              </Link>
            </div>
          </div>
        )}
      </section>

      {/* ── Reprint ────────────────────────────────────────────── */}
      <section className="bg-lt-card border border-lt-hairline rounded-xl p-4 space-y-4">
        <div>
          <div className="text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold mb-1">Reprint</div>
          <p className="text-[13px] text-lt-fg2">
            A worn label, RentalWorks&rsquo; or ours: scan or type the numbers, one per line, and print the same sheet.
          </p>
        </div>
        <div>
          <label className={labelCls} htmlFor="codes">Barcodes</label>
          <textarea
            id="codes"
            value={codesText}
            onChange={(e) => { setCodesText(e.target.value); setCheck(null) }}
            rows={4}
            placeholder={'SR004674\nSR900012'}
            spellCheck={false}
            autoCapitalize="characters"
            className={`${inputCls} font-mono`}
          />
        </div>
        <StockPicker stock={rStock} setStock={setRStock} skip={rSkip} setSkip={setRSkip} />

        {checkError && (
          <p className="text-[13px] text-chip-bad-fg bg-chip-bad-bg rounded-lg px-3 py-2 flex items-start gap-1.5">
            <AlertTriangle size={13} aria-hidden className="flex-none mt-0.5" />
            {checkError}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void runCheck()} disabled={!codes.length || checking} className={secondaryBtn}>
            <Search size={15} aria-hidden /> {checking ? 'Checking…' : `Check ${codes.length || ''} ${codes.length === 1 ? 'label' : 'labels'}`}
          </button>
          {check && check.missing.length === 0 && check.units.length > 0 && (
            <a href={sheetUrl(check.units.map((u) => u.barcode), rStock, rSkip)} target="_blank" rel="noopener" className={primaryBtn}>
              <Printer size={15} aria-hidden /> Print {check.units.length} label{check.units.length === 1 ? '' : 's'}
            </a>
          )}
        </div>

        {check && (
          <div className="space-y-2">
            {check.missing.length > 0 && (
              <p className="text-[13px] text-chip-warn-fg bg-chip-warn-bg rounded-lg px-3 py-2">
                Not in the register: <span className="font-mono">{check.missing.join(', ')}</span>. Remove them to print the rest.
              </p>
            )}
            {check.units.length > 0 && (
              <ul className="text-[13px] text-lt-fg divide-y divide-lt-hairline border border-lt-hairline rounded-lg overflow-hidden">
                {check.units.map((u) => (
                  <li key={u.barcode} className="px-3 py-1.5 flex gap-3">
                    <span className="font-mono font-semibold">{u.barcode}</span>
                    <span className="text-lt-fg2 truncate">{u.itemCode ? `${u.itemCode} · ` : ''}{u.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
