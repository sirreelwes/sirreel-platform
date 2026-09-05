'use client'
/** /vendor/account/[token]/sign — the partner signs the agreement SirReel
 *  filed for them. Same evidence as every other signature in HQ. */
import { useState } from 'react'
import { useParams } from 'next/navigation'
import { SignaturePad } from '@/components/portal/SignaturePad'
import { VENDOR_AGREEMENT_ACK as ACK } from '@/lib/contracts/vendorAgreementClauses'

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #d6d1c4', borderRadius: 8, fontSize: 15, color: '#111', background: '#fff' }

export default function VendorSignPage() {
  const params = useParams()
  const token = String(params?.token || '')
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [email, setEmail] = useState('')
  const [sig, setSig] = useState<string | null>(null)
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [agreementId, setAgreementId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  // The agreement id comes off the page's own PDF endpoint metadata — a
  // tiny fetch to learn which agreement is live.
  if (!loaded) {
    setLoaded(true)
    fetch(`/api/public/vendor-account/${token}/agreement/pdf`, { method: 'HEAD' }).then((r) => {
      const id = r.headers.get('x-agreement-id')
      setAgreementId(id)
    }).catch(() => setAgreementId(null))
  }

  const can = name.trim().length > 1 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !!sig && ack && !busy
  async function sign() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/public/vendor-account/${token}/agreement/sign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agreementId: agreementId ?? 'current', signerName: name.trim(), signerTitle: title.trim() || null, signerEmail: email.trim(), signatureImageData: sig, acknowledgmentText: ACK }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Signing failed')
      setDone(true)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Signing failed') } finally { setBusy(false) }
  }

  return (
    <div style={{ fontFamily: FONT, background: '#f6f4ef', minHeight: '100vh' }}>
      <div style={{ background: '#0c0c0d', color: '#fff' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <a href={`/vendor/account/${token}`} style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, textDecoration: 'none' }}>← Your account</a>
          <span style={{ fontSize: 10, letterSpacing: '2.5px', textTransform: 'uppercase', color: '#c39a3f', fontWeight: 700 }}>Partner agreement</span>
        </div>
      </div>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 20px 48px', display: 'grid', gap: 16 }}>
        {done ? (
          <div style={{ background: '#fff', border: '1px solid #e2ddd0', borderRadius: 14, padding: 24 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#2f7d5d' }}>Signed. Thank you.</div>
            <p style={{ fontSize: 14, color: '#3d392f' }}>The executed copy is on your account page.</p>
            <a href={`/vendor/account/${token}`} style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>Back to your account →</a>
          </div>
        ) : (
          <>
            <div style={{ background: '#fff', border: '1px solid #e2ddd0', borderRadius: 14, overflow: 'hidden' }}>
              <iframe title="Partner agreement" src={`/api/public/vendor-account/${token}/agreement/pdf#toolbar=0`} style={{ width: '100%', height: '68vh', border: 0 }} />
              <div style={{ padding: '8px 14px', borderTop: '1px solid #eeece6', fontSize: 12, color: '#6b6560' }}>
                Trouble viewing? <a href={`/api/public/vendor-account/${token}/agreement/pdf?download=1`} style={{ color: '#111' }}>Download the PDF</a>.
              </div>
            </div>
            <div style={{ background: '#fff', border: '1px solid #e2ddd0', borderRadius: 14, padding: 20, display: 'grid', gap: 12 }}>
              <div style={{ fontSize: 11, letterSpacing: '1.6px', textTransform: 'uppercase', color: '#8a8272', fontWeight: 700 }}>Sign</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                <input style={inp} placeholder="Your full name" value={name} onChange={(e) => setName(e.target.value)} />
                <input style={inp} placeholder="Title (e.g. Owner)" value={title} onChange={(e) => setTitle(e.target.value)} />
                <input style={inp} placeholder="Your email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <SignaturePad onChange={setSig} />
              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12, color: '#3d392f', lineHeight: 1.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: 3 }} />
                <span>{ACK}</span>
              </label>
              {err && <div style={{ fontSize: 13, color: '#a33' }}>{err}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" disabled={!can} onClick={sign} style={{ fontSize: 14, fontWeight: 700, color: '#fff', background: '#0c0c0d', border: 0, borderRadius: 8, padding: '10px 18px', cursor: can ? 'pointer' : 'default', opacity: can ? 1 : 0.4 }}>
                  {busy ? 'Signing…' : 'Sign the agreement'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
