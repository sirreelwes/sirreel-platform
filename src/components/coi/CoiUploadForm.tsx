'use client'

import { useRef, useState } from 'react'

const MAX_BYTES = 25 * 1024 * 1024

type State =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'done'; attached: string; emailed: boolean }
  | { kind: 'error'; message: string }

export function CoiUploadForm({ token }: { token: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)

  // Client-side pre-check (the server re-validates by magic bytes + size).
  const pick = (f: File | null) => {
    setState({ kind: 'idle' })
    if (!f) return setFile(null)
    const looksPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
    if (!looksPdf) {
      setState({ kind: 'error', message: 'Please choose a PDF file.' })
      setFile(null)
      return
    }
    if (f.size > MAX_BYTES) {
      setState({ kind: 'error', message: `That file is too large (max 25 MB).` })
      setFile(null)
      return
    }
    setFile(f)
  }

  const submit = async () => {
    if (!file) return
    setState({ kind: 'uploading' })
    try {
      const body = new FormData()
      body.append('file', file)
      if (name.trim()) body.append('uploaderName', name.trim())
      if (email.trim()) body.append('uploaderEmail', email.trim())
      const res = await fetch(`/api/coi/${token}`, { method: 'POST', body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        setState({ kind: 'error', message: json.error || `Upload failed (HTTP ${res.status}).` })
        return
      }
      setState({ kind: 'done', attached: json.attached, emailed: !!json.emailed })
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : 'Upload failed.' })
    }
  }

  if (state.kind === 'done') {
    return (
      <div className="rounded-xl border border-[#c39a3f] bg-[#fbf6ea]/60 p-5 text-center">
        <div className="text-[15px] font-bold text-[#0c0c0d]" style={{ fontFamily: 'Archivo, sans-serif' }}>
          Got it — thank you!
        </div>
        <p className="mt-1 text-[13px] text-[#5b554b]">
          Your COI was uploaded and sent to the SirReel team. You can close this page.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <label
        className="border-2 border-dashed border-[#cdc7b9] rounded-xl px-4 py-8 text-center cursor-pointer hover:border-[#0c0c0d] transition-colors"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          pick(e.dataTransfer.files?.[0] ?? null)
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <div className="text-[14px] text-[#0c0c0d] font-semibold">{file.name}</div>
        ) : (
          <>
            <div className="text-[14px] text-[#0c0c0d] font-semibold">Click to choose your COI (PDF)</div>
            <div className="text-[12px] text-[#8b857a] mt-1">or drag &amp; drop it here · max 25 MB</div>
          </>
        )}
      </label>

      <div className="grid sm:grid-cols-2 gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name (optional)"
          className="border-[1.5px] border-[#cdc7b9] rounded-md px-3 py-2 text-[13px] outline-none focus:border-[#0c0c0d]"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Your email (optional)"
          className="border-[1.5px] border-[#cdc7b9] rounded-md px-3 py-2 text-[13px] outline-none focus:border-[#0c0c0d]"
        />
      </div>

      {state.kind === 'error' && (
        <div className="text-[13px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          {state.message}
        </div>
      )}

      <button
        type="button"
        disabled={!file || state.kind === 'uploading'}
        onClick={submit}
        className="w-full h-[44px] rounded-[10px] bg-[#0c0c0d] text-white font-bold text-[14px] tracking-wide hover:-translate-y-0.5 transition-transform disabled:opacity-40 disabled:translate-y-0 disabled:cursor-not-allowed"
        style={{ fontFamily: 'Archivo, sans-serif' }}
      >
        {state.kind === 'uploading' ? 'Uploading…' : 'Upload COI'}
      </button>
    </div>
  )
}
