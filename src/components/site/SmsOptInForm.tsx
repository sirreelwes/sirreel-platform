'use client'
/**
 * The public SMS opt-in form — a mobile number and the consent checkbox on
 * the SAME form, which is what carrier review requires ("add a phone number
 * field on the same form as the SMS consent checkbox so it's clear
 * consumers are giving that number permission", Twilio A2P review,
 * 2026-09-07). Lives on /sms-terms#opt-in.
 *
 * It is real, not a prop: a submission records the opt-in on the number's
 * thread (optedInVia 'form') and, once Twilio is configured, the number
 * receives the opt-in confirmation text filed with the campaign.
 */
import { useState } from 'react'

export default function SmsOptInForm({ numberDisplay }: { numberDisplay: string }) {
  const [phone, setPhone] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!agree) { setError('Please check the box to confirm you agree to receive texts.'); return }
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/public/sms/opt-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, consent: true }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error ?? 'That didn’t go through — please try again.')
      setDone(j.confirmationSent
        ? `You're opted in. A confirmation text is on its way to ${j.phone}.`
        : `You're opted in for ${j.phone}. You'll hear from us about your booking by text.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return <p className="mt-3 text-[14px] font-semibold text-[#2f7d5d]">{done}</p>
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3" noValidate>
      <label className="block">
        <span className="block text-[12px] font-semibold tracking-[0.1em] uppercase text-[#8b857a] mb-1.5">Mobile number</span>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(818) 555-0100"
          required
          className="w-full max-w-[360px] border border-[#e4dfd4] rounded-lg px-3 py-2.5 text-[16px] bg-white focus:outline-none focus:border-[#0F7A93]"
        />
      </label>
      <label className="flex items-start gap-3 text-[14px] leading-relaxed text-[#3d392f] cursor-pointer max-w-[640px]">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 w-4 h-4 accent-[#0F7A93]" />
        <span>
          I agree to receive text messages from SirReel Studio Services at the mobile number above about my rental
          bookings, including confirmations and day-of logistics changes. Message frequency varies. Message and data
          rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of renting. See the{' '}
          <a href="/sms-terms" className="text-[#0F7A93] underline underline-offset-2">Text Message Terms</a> and{' '}
          <a href="/privacy" className="text-[#0F7A93] underline underline-offset-2">Privacy Policy</a>.
        </span>
      </label>
      {error && <p className="text-[13px] text-rose-700">{error}</p>}
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={busy || !phone.trim() || !agree}
          className="inline-flex min-h-[44px] items-center rounded-full bg-amber-600 hover:bg-amber-500 text-white px-6 text-[14px] font-bold disabled:opacity-50"
          style={{ fontFamily: 'Archivo, sans-serif' }}
        >
          {busy ? 'Signing you up…' : 'Opt in to texts'}
        </button>
        <span className="text-[13px] text-[#8b857a]">or text START to {numberDisplay}</span>
      </div>
    </form>
  )
}
