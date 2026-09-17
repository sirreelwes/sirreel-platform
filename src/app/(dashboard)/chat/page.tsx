/**
 * /chat — every job conversation you are in, across all jobs.
 *
 * Wes 2026-09-17: "let's create a chat tab on the left menu … all chats,
 * no matter which job, will show up here … It's another way to communicate
 * if you're not already in the job" — with the scope he set in the same
 * breath: "the chats shouldn't be for everyone. It should be for everyone
 * who is included in that chat."
 *
 * The inclusion rule and the reason on each row live in
 * `src/lib/email/chatInbox.ts`; the page is the shell.
 */

import { ChatInbox } from '@/components/jobs/ChatInbox'

export const dynamic = 'force-dynamic'

export default function ChatPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <ChatInbox />
    </div>
  )
}
