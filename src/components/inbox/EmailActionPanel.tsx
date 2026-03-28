'use client';
import { useState } from 'react';

const STAGE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  new_inquiry:        { label: 'New Inquiry',         color: 'text-blue-700',   bg: 'bg-blue-50',   icon: '📥' },
  quote_sent:         { label: 'Quote Sent',           color: 'text-purple-700', bg: 'bg-purple-50', icon: '📋' },
  negotiating:        { label: 'Negotiating',          color: 'text-amber-700',  bg: 'bg-amber-50',  icon: '💬' },
  confirmed:          { label: 'Quote Confirmed ✓',    color: 'text-emerald-700',bg: 'bg-emerald-50',icon: '✅' },
  paperwork_sent:     { label: 'Paperwork Sent',       color: 'text-blue-600',   bg: 'bg-blue-50',   icon: '📤' },
  paperwork_partial:  { label: 'Paperwork Partial',    color: 'text-amber-700',  bg: 'bg-amber-50',  icon: '⏳' },
  paperwork_complete: { label: 'Paperwork Complete ✓', color: 'text-emerald-700',bg: 'bg-emerald-50',icon: '✅' },
  active_job:         { label: 'Active Job',           color: 'text-emerald-700',bg: 'bg-emerald-50',icon: '🎬' },
  damage_claim:       { label: 'Damage/Claim',         color: 'text-red-700',    bg: 'bg-red-50',    icon: '⚠️' },
  billing:            { label: 'Billing',              color: 'text-amber-700',  bg: 'bg-amber-50',  icon: '💳' },
  general:            { label: 'General',              color: 'text-gray-600',   bg: 'bg-gray-50',   icon: '📧' },
};

const ACTION_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  create_booking_and_quote: { label: 'Create Booking & Send Quote', color: 'bg-blue-600 hover:bg-blue-700', icon: '📋' },
  send_revised_quote:       { label: 'Send Revised Quote',          color: 'bg-purple-600 hover:bg-purple-700', icon: '💰' },
  send_portal_link:         { label: 'Send Portal Link',            color: 'bg-emerald-600 hover:bg-emerald-700', icon: '🔗' },
  follow_up_wc:             { label: 'Follow Up — Workers Comp',    color: 'bg-amber-500 hover:bg-amber-600', icon: '📄' },
  follow_up_coi:            { label: 'Follow Up — COI',             color: 'bg-amber-500 hover:bg-amber-600', icon: '🛡️' },
  follow_up_paperwork:      { label: 'Follow Up — Paperwork',       color: 'bg-amber-500 hover:bg-amber-600', icon: '📝' },
  confirm_card_on_file:     { label: 'Confirm Card on File',        color: 'bg-gray-700 hover:bg-gray-800', icon: '💳' },
  loop_in_claims:           { label: 'Loop in Claims Team',         color: 'bg-red-600 hover:bg-red-700', icon: '⚠️' },
  mark_complete:            { label: 'Mark Paperwork Complete',     color: 'bg-emerald-600 hover:bg-emerald-700', icon: '✅' },
};

export default function EmailActionPanel({ email }: { email: any }) {
  const [detecting, setDetecting] = useState(false);
  const [detection, setDetection] = useState<any>(null);
  const [replyText, setReplyText] = useState('');
  const [rwOrderNumber, setRwOrderNumber] = useState('');
  const [lookingUpRw, setLookingUpRw] = useState(false);
  const [rwData, setRwData] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [showReply, setShowReply] = useState(false);

  const detect = async () => {
    setDetecting(true);
    try {
      const res = await fetch('/api/email/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailBody: email.body || email.snippet || '',
          subject: email.subject,
          fromEmail: email.fromAddress,
        })
      });
      const data = await res.json();
      if (data.detection) {
        setDetection(data.detection);
        setReplyText(data.suggestedReply || '');
      }
    } finally { setDetecting(false); }
  };

  const lookupRw = async () => {
    if (!rwOrderNumber.trim()) return;
    setLookingUpRw(true);
    try {
      const res = await fetch(`/api/bookings/by-rw-order?orderNumber=${encodeURIComponent(rwOrderNumber)}`);
      const data = await res.json();
      setRwData(data);
      // If portal URL found, inject into reply
      if (data.existingBooking?.portalUrl && replyText) {
        setReplyText(replyText.replace('[PORTAL LINK]', data.existingBooking.portalUrl));
      }
    } finally { setLookingUpRw(false); }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openGmail = () => {
    const subject = `Re: ${email.subject || ''}`;
    const body = encodeURIComponent(replyText);
    const to = encodeURIComponent(email.fromAddress || '');
    window.open(`https://mail.google.com/mail/?view=cm&to=${to}&su=${encodeURIComponent(subject)}&body=${body}`, '_blank');
  };

  const stageCfg = detection ? (STAGE_CONFIG[detection.stage] || STAGE_CONFIG.general) : null;
  const actionCfg = detection?.suggestedAction ? (ACTION_CONFIG[detection.suggestedAction] || null) : null;

  return (
    <div className="space-y-3">
      {/* Detect button */}
      {!detection ? (
        <button onClick={detect} disabled={detecting}
          className="w-full py-2.5 bg-gray-900 text-white rounded-xl text-[12px] font-semibold hover:bg-gray-800 disabled:opacity-40 flex items-center justify-center gap-2">
          {detecting ? <><span className="animate-spin">⚡</span> Analyzing email...</> : '⚡ Analyze with AI'}
        </button>
      ) : (
        <div className="space-y-3">
          {/* Stage badge */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${stageCfg?.bg}`}>
            <span className="text-base">{stageCfg?.icon}</span>
            <div className="flex-1">
              <div className={`text-[12px] font-bold ${stageCfg?.color}`}>{stageCfg?.label}</div>
              {detection.returningClient && <div className="text-[10px] text-emerald-600 font-semibold">↩ Returning client — check what's on file</div>}
            </div>
            <button onClick={() => { setDetection(null); setReplyText(''); }} className="text-[10px] text-gray-400 hover:text-gray-600">Re-analyze</button>
          </div>

          {/* Extracted info */}
          {(detection.company || detection.jobName || detection.vehicles?.length || detection.dates) && (
            <div className="bg-gray-50 rounded-xl p-3 space-y-1">
              {detection.company && <div className="text-[11px]"><span className="text-gray-400">Company: </span><span className="font-semibold text-gray-800">{detection.company}</span></div>}
              {detection.jobName && <div className="text-[11px]"><span className="text-gray-400">Job: </span><span className="font-semibold text-gray-800">{detection.jobName}</span></div>}
              {detection.vehicles?.length > 0 && <div className="text-[11px]"><span className="text-gray-400">Vehicles: </span><span className="font-semibold text-gray-800">{detection.vehicles.join(', ')}</span></div>}
              {detection.dates && <div className="text-[11px]"><span className="text-gray-400">Dates: </span><span className="font-semibold text-gray-800">{detection.dates}</span></div>}
              {detection.contactPhone && <div className="text-[11px]"><span className="text-gray-400">Phone: </span><span className="font-semibold text-gray-800">{detection.contactPhone}</span></div>}
            </div>
          )}

          {/* Suggested action */}
          {actionCfg && detection.suggestedAction !== 'none' && (
            <div className="space-y-2">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Suggested Action</div>

              {/* RW order lookup for portal link */}
              {detection.suggestedAction === 'send_portal_link' && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-2">
                  <div className="text-[11px] font-semibold text-emerald-800">✅ Quote confirmed — ready to send portal link</div>
                  <div className="flex gap-2">
                    <input value={rwOrderNumber} onChange={e => setRwOrderNumber(e.target.value)}
                      className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[11px] focus:outline-none focus:border-gray-400"
                      placeholder="RW Order # (e.g. 302881)" onKeyDown={e => e.key === 'Enter' && lookupRw()} />
                    <button onClick={lookupRw} disabled={lookingUpRw || !rwOrderNumber}
                      className="px-3 py-1.5 bg-gray-900 text-white text-[11px] font-semibold rounded-lg disabled:opacity-40">
                      {lookingUpRw ? '...' : 'Look up'}
                    </button>
                  </div>
                  {rwData?.existingBooking && (
                    <div className="text-[10px] text-emerald-700 font-semibold">
                      ✓ Found: {rwData.existingBooking.jobName || rwData.existingBooking.company}
                      {rwData.existingBooking.portalUrl && ' · Portal link ready'}
                    </div>
                  )}
                  {rwData?.rwOrder && !rwData?.existingBooking && (
                    <div className="text-[10px] text-amber-700">Order found in RW — no portal created yet. <a href="/bookings" className="underline font-semibold">Create in platform →</a></div>
                  )}
                </div>
              )}

              <button className={`w-full py-2.5 text-white rounded-xl text-[12px] font-semibold flex items-center justify-center gap-2 ${actionCfg.color}`}>
                <span>{actionCfg.icon}</span> {actionCfg.label}
              </button>
            </div>
          )}

          {/* Reply template */}
          {replyText && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Suggested Reply</div>
                <button onClick={() => setShowReply(!showReply)} className="text-[10px] text-blue-600 font-semibold">{showReply ? 'Hide ▲' : 'Show ▼'}</button>
              </div>
              {showReply && (
                <>
                  <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl p-3 text-[11px] resize-none focus:outline-none focus:border-gray-400 leading-relaxed"
                    rows={10} />
                  <div className="flex gap-2">
                    <button onClick={() => copy(replyText)}
                      className={`flex-1 py-2 rounded-xl text-[11px] font-semibold border transition-colors ${copied ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                      {copied ? '✓ Copied!' : 'Copy Reply'}
                    </button>
                    <button onClick={openGmail}
                      className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-[11px] font-semibold hover:bg-blue-700">
                      Open in Gmail ↗
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
