'use client'

import { useState } from 'react'

export default function ClientLoginPage() {
  const [email, setEmail] = useState('')
  const [step, setStep] = useState<'form'|'sending'|'sent'|'error'>('form')
  const [error, setError] = useState('')

  const submit = async () => {
    if (!email) return
    setStep('sending')
    try {
      const res = await fetch('/api/client/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (data.ok) {
        setStep('sent')
      } else {
        setError(data.error || 'Something went wrong')
        setStep('error')
      }
    } catch {
      setError('Network error')
      setStep('error')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-[#1f3d5c] px-6 py-8 text-center">
            <div className="text-white font-bold text-xl">SirReel</div>
            <div className="text-blue-200 text-sm mt-1">Studio Services</div>
          </div>

          <div className="px-6 py-8">
            {step === 'sent' ? (
              <div className="text-center">
                <div className="text-4xl mb-4">📧</div>
                <h2 className="text-lg font-bold text-gray-900 mb-2">Check your email</h2>
                <p className="text-sm text-gray-500">We sent a link to <strong>{email}</strong>. Click it to view your job history.</p>
                <p className="text-xs text-gray-400 mt-3">Link expires in 24 hours.</p>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-bold text-gray-900 mb-1">View your jobs</h2>
                <p className="text-sm text-gray-500 mb-6">Enter the email address you use with SirReel.</p>

                <div className="space-y-3">
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submit()}
                    placeholder="your@email.com"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-gray-400"
                  />

                  {step === 'error' && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                      {error}
                    </div>
                  )}

                  <button
                    onClick={submit}
                    disabled={!email || step === 'sending'}
                    className={`w-full py-3 rounded-xl text-sm font-bold transition-colors ${
                      email && step !== 'sending'
                        ? 'bg-[#1f3d5c] text-white hover:bg-[#2a4f77]'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}>
                    {step === 'sending' ? 'Sending...' : 'Send me a link →'}
                  </button>
                </div>

                <p className="text-xs text-gray-400 text-center mt-4">
                  No password needed. We'll email you a secure link.
                </p>
              </>
            )}
          </div>
        </div>

        <div className="text-center mt-4 text-xs text-gray-400">
          SirReel Studio Services · 8500 Lankershim Blvd, Sun Valley, CA
        </div>
      </div>
    </div>
  )
}
