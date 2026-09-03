'use client'

/**
 * /pay-details/[token] — SirReel's payment details for a client's
 * accounts-payable team.
 *
 * Reached from a link SirReel emails on the producer's request. The email
 * carries no account numbers, so there is nothing in it for an attacker to
 * alter; the reader gets the numbers from sirreel.com over TLS instead.
 *
 * Written for someone who has never seen SirReel's systems and is about to
 * move money: say plainly who we are, show the details, and state up front
 * that they never change.
 */

import { useEffect, useState } from 'react'
import { ZelleDetails } from '@/components/payments/ZelleDetails'
import { Check } from 'lucide-react'

interface Details {
  payeeName: string
  bankName: string | null
  accountType: string | null
  accountNumber: string
  routingAch: string
  routingWire: string | null
  remittanceEmail: string | null
  bankAddress: string | null
  instructions: string | null
  zelleHandle: string | null
  zelleName: string | null
}

function Row({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-gray-100 last:border-0">
      <span className="text-[11px] uppercase tracking-wider text-gray-400 pt-1 shrink-0">
        {label}
      </span>
      <span className="flex items-center gap-2 min-w-0">
        <span className="text-[15px] text-gray-900 font-medium text-right break-words">
          {value}
        </span>
        <button
          type="button"
          onClick={() =>
            navigator.clipboard?.writeText(value).then(
              () => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              },
              () => {},
            )
          }
          className="text-[11px] text-gray-400 hover:text-gray-900 shrink-0"
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check size={14} aria-hidden /> : 'copy'}
        </button>
      </span>
    </div>
  )
}

interface Doc {
  slot: string
  label: string
}

export default function PayDetailsPage({ params }: { params: { token: string } }) {
  const [details, setDetails] = useState<Details | null>(null)
  const [docs, setDocs] = useState<Doc[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'gone'>('loading')

  useEffect(() => {
    fetch(`/api/public/pay-details/${encodeURIComponent(params.token)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && d.details) {
          setDetails(d.details)
          setDocs(Array.isArray(d.documents) ? d.documents : [])
          setState('ready')
        } else setState('gone')
      })
      .catch(() => setState('gone'))
  }, [params.token])

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-6">
          <div className="text-[11px] uppercase tracking-[0.2em] text-amber-600 font-semibold">
            SirReel Studio Services
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 mt-1">Payment details</h1>
        </div>

        {state === 'loading' && (
          <p className="text-center text-sm text-gray-400">Loading…</p>
        )}

        {state === 'gone' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center">
            <p className="text-sm text-gray-700">
              This link is no longer available. It may have expired or been replaced.
            </p>
            <p className="text-sm text-gray-500 mt-3">
              Email{' '}
              <a href="mailto:billing@sirreel.com" className="underline">
                billing@sirreel.com
              </a>{' '}
              and we will send a new one.
            </p>
            {/* Deliberately NOT offering the numbers here as a fallback: an
                expired link that hands out banking details anyway is just the
                email problem with extra steps. */}
          </div>
        )}

        {state === 'ready' && details && (
          <>
            <div className="bg-white rounded-2xl border border-gray-200 px-5 py-3">
              <Row label="Payee" value={details.payeeName} />
              <Row label="Bank" value={details.bankName} />
              <Row label="Account type" value={details.accountType} />
              <Row label="Account number" value={details.accountNumber} />
              <Row label="Routing (ACH)" value={details.routingAch} />
              <Row label="Routing (wire)" value={details.routingWire} />
              <Row label="Bank address" value={details.bankAddress} />
              <Row label="Remittance to" value={details.remittanceEmail} />
            </div>

            {details.instructions && (
              <p className="text-sm text-gray-600 mt-4 whitespace-pre-line">
                {details.instructions}
              </p>
            )}

            <div className="mt-4">
              <ZelleDetails handle={details.zelleHandle} name={details.zelleName} />
            </div>

            {docs.length > 0 && (
              <div className="mt-4">
                <div className="text-[11px] uppercase tracking-wider text-gray-400 mb-1.5">
                  Documents
                </div>
                {/* A/P departments keep a signed bank letter in the vendor
                    file; these used to be email attachments. */}
                <ul className="space-y-1">
                  {docs.map((doc) => (
                    <li key={doc.slot}>
                      <a
                        href={`/api/public/pay-details/${encodeURIComponent(params.token)}/doc/${doc.slot}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-gray-900 underline"
                      >
                        {doc.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="font-semibold">These details never change.</span>{' '}
              SirReel will never email you asking to send payment to a different
              account. If you receive a message claiming our banking details have
              changed — even from an address you recognise — call us before sending
              anything.
            </div>

            <p className="text-xs text-gray-400 text-center mt-6">
              Questions?{' '}
              <a href="mailto:billing@sirreel.com" className="underline">
                billing@sirreel.com
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
