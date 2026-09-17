'use client'

/**
 * The Conversation dock — the window the job chat lives in.
 *
 * Wes 2026-09-17: "We would like a minimize button for the chat window so
 * that we can leave it open on top of the other jobs that we are looking
 * at. Also, a close window button."
 *
 * That second half is the whole reason this file exists. Until now the
 * panel was rendered by `/jobs/[id]/page.tsx`, so it died on every walk
 * from one job to the next — there was nothing to "leave open". The dock
 * is mounted by the /jobs LAYOUT instead (the same trick that keeps the
 * rail's scroll position across jobs), so the window and everything typed
 * into it outlive the navigation.
 *
 * Three states, one mount:
 *   open  — a reserved 400px column at 1280px+, a full-screen window below
 *           that. Reserved, not floating, so it never covers the job you
 *           are reading; the phone width is a window because there is no
 *           room to reserve.
 *   min   — a pill at the bottom right, over everything, naming the job it
 *           is holding. This is the state Wes asked for: the conversation
 *           stays with you while you look at other jobs.
 *   closed — gone. The job header's Conversation button brings it back.
 *
 * The panel is never unmounted between open and min, only hidden, so a
 * half-written note survives being tucked away.
 *
 * FOLLOW MODE is what keeps the old always-on rail for anyone who never
 * presses either button: while nobody has minimised or closed the window,
 * it re-binds to whichever job is on screen. Minimise stops it following
 * (that is the point — you are pinning THIS conversation while you go
 * elsewhere), and so does close (both buttons mean "out of my way"; the
 * Conversation button is how you say otherwise). Following is gated on
 * 1280px, because below that an open window is the whole screen and a job
 * page that buries itself under a chat on arrival is not a rail.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { MessageSquare, X } from 'lucide-react'
import { JobConversation } from './JobConversation'

export interface ChatTarget {
  id: string
  jobCode: string
  name: string
  company: string | null
}

interface JobChatValue {
  /** The job the window is holding, or null when it is closed. */
  target: ChatTarget | null
  minimized: boolean
  /** The client is waiting on a reply in the held conversation. */
  awaiting: boolean
  /** Open (or re-open) the window on a job and resume following. */
  openFor: (t: ChatTarget) => void
  /** The job page announces itself; the window follows unless pinned. */
  setHere: (t: ChatTarget | null) => void
}

const NOOP: JobChatValue = {
  target: null,
  minimized: false,
  awaiting: false,
  openFor: () => {},
  setHere: () => {},
}

const Ctx = createContext<JobChatValue & { minimize: () => void; close: () => void; restore: () => void; here: ChatTarget | null; onSummary: (s: { awaitingReply: boolean }) => void } | null>(null)

/** Tolerant on purpose: a surface rendered outside the dock gets no-ops
 *  rather than a blank screen. */
export function useJobChat(): JobChatValue {
  return useContext(Ctx) ?? NOOP
}

export function JobChatProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<ChatTarget | null>(null)
  const [minimized, setMinimized] = useState(false)
  const [follow, setFollow] = useState(true)
  const [here, setHere] = useState<ChatTarget | null>(null)
  const [awaiting, setAwaiting] = useState(false)

  // Following only auto-opens where the window RESERVES a column. Below
  // 1280px an open window covers the whole screen, and a job page that
  // buries itself under a chat the moment you open it is not a feature —
  // there it waits for the Conversation button or a deep link.
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)')
    const read = () => setWide(mq.matches)
    read()
    mq.addEventListener('change', read)
    return () => mq.removeEventListener('change', read)
  }, [])

  // While following, the window belongs to whatever job is on screen.
  useEffect(() => {
    if (!follow || !wide || !here) return
    setTarget((cur) => (cur?.id === here.id ? cur : here))
  }, [follow, wide, here])

  const openFor = useCallback((t: ChatTarget) => {
    setTarget(t)
    setMinimized(false)
    setFollow(true)
  }, [])
  const minimize = useCallback(() => {
    setMinimized(true)
    setFollow(false)
  }, [])
  const close = useCallback(() => {
    setTarget(null)
    setMinimized(false)
    setFollow(false)
  }, [])
  const restore = useCallback(() => setMinimized(false), [])
  const onSummary = useCallback((s: { awaitingReply: boolean }) => setAwaiting(s.awaitingReply), [])

  const value = useMemo(
    () => ({ target, minimized, awaiting, openFor, setHere, minimize, close, restore, here, onSummary }),
    [target, minimized, awaiting, openFor, minimize, close, restore, here, onSummary],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Rendered as the last child of the /jobs list|detail flex row. In the
 * open state at 1280px+ it is an ordinary flex child and reserves its
 * column; every other state is `fixed`, which takes it out of the flow
 * entirely, so the job pane grows back without the row knowing.
 */
export function JobChatPane() {
  const ctx = useContext(Ctx)
  if (!ctx) return null
  const { target, minimized, awaiting, here, minimize, close, restore, onSummary, openFor } = ctx
  if (!target) return null

  // The window can be holding one job while you read another — that is the
  // feature. It is also exactly how someone writes into the wrong
  // conversation, so the strip says so and offers the swap.
  const elsewhere = here && here.id !== target.id ? here : null

  return (
    <>
      {minimized && (
        <div className="fixed bottom-0 right-4 z-40 flex items-stretch rounded-t-xl border border-b-0 border-lt-hairline bg-lt-card shadow-2xl">
          <button
            type="button"
            onClick={restore}
            className="flex items-center gap-2 pl-3 pr-2 py-2 text-[12.5px] font-semibold text-lt-fg hover:bg-lt-inner rounded-tl-xl max-w-[70vw] sm:max-w-sm"
            title={`Reopen the conversation on ${target.jobCode}`}
          >
            <MessageSquare size={14} className="text-amber-600 shrink-0" aria-hidden />
            <span className="shrink-0">{target.jobCode}</span>
            <span className="text-lt-fg3 font-normal truncate">{target.company || target.name}</span>
            {awaiting && <span className="w-2 h-2 rounded-full bg-amber-600 shrink-0" aria-label="client replied" />}
          </button>
          <button
            type="button"
            onClick={close}
            className="px-2 text-lt-fg3 hover:text-lt-fg hover:bg-lt-inner rounded-tr-xl border-l border-lt-hairline"
            title="Close the conversation"
            aria-label="Close the conversation"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      )}

      {/* One mount, hidden rather than unmounted while minimised. */}
      <div
        className={
          minimized
            ? 'hidden'
            : 'fixed inset-0 z-40 flex flex-col bg-lt-page p-0 xl:static xl:z-auto xl:w-[400px] xl:shrink-0 xl:border-l xl:border-lt-hairline xl:p-3'
        }
      >
        {elsewhere && (
          <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 text-[11.5px] bg-chip-warn-bg text-chip-warn-fg xl:rounded-t-lg xl:mb-1">
            <span className="truncate">
              Holding <strong>{target.jobCode}</strong> — you&rsquo;re on {elsewhere.jobCode}
            </span>
            <button
              type="button"
              onClick={() => openFor(elsewhere)}
              className="ml-auto shrink-0 font-semibold underline underline-offset-2"
            >
              Switch
            </button>
          </div>
        )}
        <JobConversation
          key={target.id}
          jobId={target.id}
          onSummary={onSummary}
          onMinimize={minimize}
          onClose={close}
          className="flex-1 min-h-0 rounded-none xl:rounded-2xl"
        />
        {elsewhere && (
          <Link
            href={`/jobs/${target.id}`}
            className="shrink-0 text-center text-[11.5px] text-lt-fg3 hover:text-lt-fg py-1.5 xl:py-1"
          >
            Open {target.jobCode}
          </Link>
        )}
      </div>
    </>
  )
}
