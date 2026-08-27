import { redirect } from 'next/navigation';

/**
 * /sales/pipeline → /inquiries (2026-08-21 sales-workspace redesign).
 *
 * The pipeline page's living parts (New inbound, open quotes,
 * follow-up nudges, signals, upcooming-reservations glance) all moved
 * into the redesigned /inquiries workspace. Its dead weight — the
 * DRAFT/SENT/WON/LOST kanban whose LOST column could never populate
 * and whose WON column nothing ever left, the 100+-card Active Jobs
 * wall (the /jobs board does that job properly), and the "Prospects —
 * coming soon" placeholder — was deleted rather than moved.
 *
 * The route stays as a redirect for muscle memory and old links.
 */
export default function PipelineRedirect() {
  redirect('/jobs');  // /inquiries itself now redirects to /jobs — skip the hop
}
