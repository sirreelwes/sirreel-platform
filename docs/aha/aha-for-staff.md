# AHA for staff — one page

## What it is
- SirReel's After Hours Assistant — one brain behind the public chat, the text line and the signed-in chat on /admin/assistant
- What it can do for you follows your HQ role

## How to reach it as staff
- Text (747) 335-1665 from the mobile on your emergency-contacts card (/admin/assistant) — AHA knows it is you
- Signed in: /admin/assistant → "Ask AHA as yourself" (level follows your session role, every use audited)
- ADMIN role → admin level · MANAGER / AGENT / BILLING / DISPATCHER → staff level

## Fleet and job lookups (staff level)
- "Who's on Cube 27?" → the job, dates, the checked-out driver's name and phone, the requester, delivery address
- "Has Forgotten Island come back?" → by job code, name or company: marked returned / every unit checked in / still out / not yet out
- A job's orders and bookings with dates, every unit with its driver, and the contacts with phone numbers
- Names, numbers and addresses from those lookups may be shared with you — AHA is terse because you are working
- Codes still go through the same verification as everyone else; AHA never freelances a gate or lockbox code

## Admin level adds continuity
- Platform memory: "how do reservations and Planyo relate", "what is the collections panel" — answered from CLAUDE.md, SHIPLOG.md and docs, credential-looking lines redacted
- Recent activity: what the admins have been doing, from the audit log — counts and latest entries, never old/new values
- Built for continuity: a plain-words walkthrough of anything in HQ for whoever has to step in, one thing at a time

## What AHA does for callers, so you don't have to
- Releases the lot gate code and a truck's lockbox code after hours on a job code + one corroborator, or a unit + driver name, or (by text) a number on file for the job + the unit or VIN last 4
- Answers hours, address, directions, where to pay, how to quote
- Walks clients through gear setup from the same registry as the public /help guides
- Gives production contacts on a current job their booking details and files any request for their agent

## What lands with the team
- rentals@ and hq@ get an email for every release, denial, callback, emergency and stranded-driver alert — codes are never repeated in the email
- Callback requests arrive as NEW inquiries in New inbound on /jobs, with an AI summary of what the caller actually typed
- Emergencies and stranded drivers text the on-call phones (one stranded alert per vehicle per hour); email is the fallback if SMS is not configured
- Audit log actions: public.access_released, public.access_denied, public.emergency_escalation, public.stranded_driver, sms.assistant_tools, hq.assistant_tools

## What you manage on /admin/assistant
- Emergency contacts: who gets texted for emergencies and stranded drivers, and your mobile that texts AHA as staff
- "Who AHA recognises": every number by tier (staff / production contact / checkout driver), what it unlocks, when it lapses, and a link to the record — the list is the access; change the record it points to
- Add a person, or block one, by hand (admin only, audited) — a hand-made CONTACT grant can be pinned to one job
- Gate code lives in Site Settings; each truck's lockbox code is set on the Fleet vehicle summary panel — no code on file means AHA says so and the team is notified

## Ground rules
- Automated texts hold during quiet hours, 9pm–6am Pacific; staff sends are exempt
- STOP is honored immediately; a blocked number gets one fixed line and never reaches the model
- Job codes show on the client's portal job page only; lockbox codes are never rendered on any public or portal surface
