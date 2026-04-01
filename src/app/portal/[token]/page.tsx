'use client';
import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';

const TERMS = [
  { n: 1, title: 'Indemnity', text: 'Lessee/Renter ("You") agree to defend, indemnify, and hold SirReel Production Vehicles, Inc. dba SirReel Studio Rentals our agents, employees, assignees, suppliers, sub-lessors and sub-renters ("Us" or "We") harmless from and against any and all claims, actions, causes of action, demands, rights, damages of any kind, costs, loss of profit, expenses and compensation whatsoever including court costs and attorneys' fees ("Claims"), in any way arising from, or in connection with the Vehicles and Equipment rented/leased (which vehicles and equipment, together, are referred to in this document as "Equipment"), including, without limitation, as a result of its use, maintenance, or possession, irrespective of the cause of the Claim, except as the result of our sole negligence or willful act, from the time the Equipment leaves our place of business when you rent/lease it until the Equipment is returned to us during normal business hours and we sign a written receipt for it.' },
  { n: 2, title: 'Loss of or Damage to Equipment', text: 'You are responsible for loss, damage or destruction of the Equipment, including but not limited to losses while in transit, while loading and unloading, while at any and all locations, while in storage and while on your premises, except that you are not responsible for damage to or loss of the Equipment caused by our sole negligence or willful misconduct.' },
  { n: 3, title: 'Protection of Others', text: 'You will take reasonable precautions in regard to the use of the Equipment to protect all persons and property from injury or damage. The Equipment shall be used only by your employees or agents qualified to use the Equipment.' },
  { n: 4, title: 'Equipment in Working Order', text: 'We have tested the Equipment in accordance with reasonable industry standards and found it to be in working order immediately prior to the inception of this Agreement, and to the extent you have disclosed to us all of the intended uses of the Equipment, it is fit for its intended purpose. Other than what is set forth herein, you acknowledge that the Equipment is rented/leased without warranty, or guarantee, except as required by law or otherwise agreed upon by the parties at the inception of this Agreement.' },
  { n: 5, title: 'Property Insurance', text: 'You shall, at your own expense, maintain at all times during the term of this Agreement, all risk perils property insurance covering the Equipment from all sources (Equipment Rental Floater or Production Package Policy) including coverage for theft by force, theft by fraudulent scheme, mysterious disappearance, and loss of use of the Equipment. The Property Insurance shall name us as an additional insured and as the loss payee and shall be primary & Non-Contributory coverage with minimum coverage of $1,000,000.' },
  { n: 6, title: 'Workers Compensation & Employers Liability Insurance', text: 'You shall, at your own expense, maintain worker's compensation/employer's liability insurance during the course of the Equipment rental with minimum limits of $1,000,000. Including coverage for the use of any volunteers, interns, or independent contractors working on your behalf and under your supervision.' },
  { n: 7, title: 'Liability Insurance', text: 'You shall, at your own expense, maintain commercial general liability insurance, including coverage for the operations of independent contractors and standard contractual liability coverage. The Liability Insurance shall name us as an additional insured and provide that said insurance is primary & Non-Contributory coverage. Such insurance shall provide general liability aggregate limits of not less than $2,000,000 and not less than $1,000,000 per occurrence.' },
  { n: 8, title: 'Vehicle Insurance', text: 'You shall, at your own expense, maintain business motor vehicle liability insurance, including coverage for loading and unloading Equipment and hired motor vehicle physical damage insurance, covering owned, non-owned, hired and rented vehicles. We shall be named as an additional insured with respect to the liability coverage, and as a loss payee with respect to the physical damage coverage. The Vehicle Insurance shall provide not less than $1,000,000 in combined single limits liability coverage and shall be primary & Non-Contributory.' },
  { n: 9, title: 'Insurance Generally', text: 'All insurance maintained by you pursuant to the foregoing provisions shall contain a waiver of subrogation rights. Lapse, reduction in coverage or cancellation of the required insurance shall be deemed to be an immediate and automatic default of this agreement. The grant by you of a sublease of the Equipment rented/leased shall not affect your obligation to procure insurance on our behalf.' },
  { n: 10, title: 'Cancellation of Insurance', text: 'You and your insurance company shall provide us with not less than 30 days written notice prior to the effective date of any cancellation or material change to any insurance maintained by you pursuant to the foregoing provisions.' },
  { n: 11, title: 'Certificates of Insurance', text: 'Before obtaining possession of the Equipment you shall provide to us Certificates of Insurance confirming the coverages specified above. All certificates shall be signed by an authorized agent or representative of the insurance carrier.' },
  { n: 12, title: 'Drivers', text: 'Any and all drivers who drive the Vehicles you are renting/leasing from us shall be duly licensed, trained and qualified to drive vehicles of this type. You must supply and employ any driver who drives our Vehicles and that driver shall be deemed to be your employee or covered independent contracted driver for all purposes and shall be covered as an additional insured on all of your applicable insurance policies.' },
  { n: 13, title: 'Compliance With Law and Regulations', text: 'You agree to comply with the laws of all states in which the Equipment is transported and/or used as well as all federal and local state laws, regulations, and ordinances pertaining to the transportation and use of such Equipment. You shall indemnify and hold us harmless from and against any and all fines, levies, penalties, taxes and seizures by any governmental authority in connection with your possession or use of the Equipment.' },
  { n: 14, title: 'Valuation of Loss/Our Liability is Limited', text: 'Unless otherwise agreed in writing, you shall be responsible to us for the replacement cost value or repair cost of the Equipment (whichever is less). If there is a reason to believe a theft has occurred, you shall file a police report. WE WILL, IN NO EVENT, BE LIABLE FOR ANY CONSEQUENTIAL, SPECIAL OR INCIDENTAL DAMAGES.' },
  { n: 15, title: 'Subrogation', text: 'You hereby agree that we shall be allowed to subrogate for any recovery rights you may have for damage to the Equipment.' },
  { n: 16, title: 'Bailment', text: 'This agreement constitutes an Agreement of bailment of the Equipment and is not a sale or the creation of a security interest. You will not have, or at any time acquire, any right, title, or interest in the Equipment, except the right to possession and use as provided for in this Agreement.' },
  { n: 17, title: 'Condition of Equipment', text: 'You assume all obligation and liability with respect to the possession of Equipment, and for its use, condition and storage during the term of this Agreement. You will, at your own expense, maintain the Equipment in good mechanical condition and running order.' },
  { n: 18, title: 'Identity', text: 'We will have the right to place and maintain on the exterior or interior of each piece of property covered by this Agreement the inscription: "Property of SirReel." You will not remove, obscure, or deface the inscription or permit any other person to do so.' },
  { n: 19, title: 'Expenses', text: 'You will be responsible for all expenses, including but not limited to fuel, lubricants, and all other charges in connection with the operation of the Equipment.' },
  { n: 20, title: 'Accident Reports', text: 'If any of the Equipment is damaged, lost, stolen, or destroyed, or if any person is injured or dies, or if any property is damaged as a result of its use, maintenance, or possession, you will promptly notify us of the occurrence, and will file all necessary accident reports, including those required by law and those required by applicable insurers.' },
  { n: 21, title: 'Default', text: 'If you fail to pay any portion or installment of the total fees payable hereunder or otherwise materially breach this Agreement, such failure or breach shall constitute a default ("Default"). Upon the occurrence of any such Default, we shall have the right, at our option, to terminate this Agreement and cease performance hereunder.' },
  { n: 22, title: 'Return', text: 'Upon the expiration date of this Agreement with respect to any or all Equipment, you will return the property to us, together with all accessories, free from all damage and in the same condition and appearance as when received by you.' },
  { n: 23, title: 'Additional Equipment', text: 'Additional Equipment may from time to time be added as the subject matter of this Agreement as agreed on by the parties. Any additional property will be added in an amendment describing the property, the monthly rental, security deposit, and stipulated loss value. All amendments must be in writing and signed by both parties.' },
  { n: 24, title: 'Entire Agreement', text: 'This Agreement and any attached schedules constitute the entire agreement between the parties. No agreements, representations, or warranties other than those specifically set forth in this Agreement will be binding on any of the parties unless set forth in writing and signed by both parties.' },
  { n: 25, title: 'Applicable Law', text: 'This Agreement will be deemed to be executed and delivered in Los Angeles, California and governed by the laws of the State of California.' },
  { n: 26, title: 'Arbitration', text: 'Any controversy or claim arising out of or related to this Agreement will be settled by arbitration in Los Angeles, California, under the auspices of JAMS. The decision and award of the arbitrator will be final and binding. The prevailing party shall be entitled to an award of reasonable attorneys fees and costs.' },
  { n: 27, title: 'Severability', text: 'If any provision of this Agreement or the application of any of its provisions to any party or circumstance is held invalid or unenforceable, the remainder of this Agreement will remain valid and in full force and effect.' },
  { n: 28, title: 'Facsimile Signature', text: 'This Agreement may be executed by facsimile signature and such signature shall be deemed a valid and binding original signature.' },
  { n: 29, title: 'Non-smoking Policy', text: 'All vehicles are non-smoking vehicles and lessee is responsible for all damages caused from smoking in or near the vehicles. A $250 per day fee may be charged lessee in addition to the cost to repair any damaged items if the smoking policy is not observed.' },
];

type TabId = 'overview' | 'agreement' | 'lcdw' | 'coi' | 'cc';
const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '📋' },
  { id: 'agreement', label: 'Agreement', icon: '✍️' },
  { id: 'lcdw', label: 'LCDW', icon: '🛡️' },
  { id: 'coi', label: 'COI', icon: '📄' },
  { id: 'cc', label: 'CC Auth', icon: '💳' },
];
const fmtShort = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

function SigCanvas({ canvasRef, drawn, onClear }: { canvasRef: React.RefObject<HTMLCanvasElement>; drawn: boolean; onClear: () => void }) {
  return (
    <div>
      <div className="border-2 border-dashed border-gray-300 rounded-xl overflow-hidden bg-white relative" style={{ touchAction: 'none' }}>
        <canvas ref={canvasRef} width={600} height={150} className="w-full" style={{ cursor: 'crosshair' }} />
        {!drawn && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><span className="text-gray-400 text-sm">Sign here</span></div>}
      </div>
      <button type="button" onClick={onClear} className="mt-1 text-[11px] text-blue-600 hover:underline">Clear</button>
    </div>
  );
}

export default function ClientPortal() {
  const params = useParams();
  const token = params?.token as string;
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState<any>(null);
  const [paperwork, setPaperwork] = useState<any>(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [submitting, setSubmitting] = useState(false);
  const [locked, setLocked] = useState(false);
  const [done, setDone] = useState({ agreement: false, lcdw: false, coi: false, cc: false });

  // Agreement
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [signerPhone, setSignerPhone] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [dotNumber, setDotNumber] = useState('');
  const [termsRead, setTermsRead] = useState(false);
  const [additionalContacts, setAdditionalContacts] = useState([{ name: '', email: '', phone: '', position: '' }]);

  // LCDW
  const [lcdwAccepted, setLcdwAccepted] = useState(false);
  const [fuelAcknowledged, setFuelAcknowledged] = useState(false);

  // COI
  const [coiFile, setCoiFile] = useState<File | null>(null);
  const [coiReview, setCoiReview] = useState<any>(null);
  const [coiReviewing, setCoiReviewing] = useState(false);

  // Workers Comp
  const [wcFile, setWcFile] = useState<File | null>(null);
  const [wcReview, setWcReview] = useState<any>(null);
  const [wcReviewing, setWcReviewing] = useState(false);

  // Redline
  const [redlineFile, setRedlineFile] = useState<File | null>(null);
  const [redlineReview, setRedlineReview] = useState<any>(null);
  const [redlineSubmitting, setRedlineSubmitting] = useState(false);

  // CC
  const [ccRepFirst, setCcRepFirst] = useState('');
  const [ccRepLast, setCcRepLast] = useState('');
  const [ccRepPhone, setCcRepPhone] = useState('');
  const [ccRepEmail, setCcRepEmail] = useState('');
  const [ccCardholderFirst, setCcCardholderFirst] = useState('');
  const [ccCardholderLast, setCcCardholderLast] = useState('');
  const [ccAddress1, setCcAddress1] = useState('');
  const [ccAddress2, setCcAddress2] = useState('');
  const [ccCity, setCcCity] = useState('');
  const [ccState, setCcState] = useState('');
  const [ccZip, setCcZip] = useState('');
  const [ccBillingPhone, setCcBillingPhone] = useState('');
  const [ccBillingEmail, setCcBillingEmail] = useState('');
  const [ccCardType, setCcCardType] = useState('');
  const [ccChargeSummary, setCcChargeSummary] = useState('');
  const [ccChargeEstimate, setCcChargeEstimate] = useState('');
  const [ccAcknowledged, setCcAcknowledged] = useState(false);

  const mainSigRef = useRef<HTMLCanvasElement>(null);
  const lcdwSigRef = useRef<HTMLCanvasElement>(null);
  const ccSigRef = useRef<HTMLCanvasElement>(null);
  const [mainSigDrawn, setMainSigDrawn] = useState(false);
  const [lcdwSigDrawn, setLcdwSigDrawn] = useState(false);
  const [ccSigDrawn, setCcSigDrawn] = useState(false);
  const [cpIframeUrl, setCpIframeUrl] = useState('');
  const [cpToken, setCpToken] = useState('');

  useEffect(() => {
    fetch(`/api/portal/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return; }
        setBooking(data.booking);
        setPaperwork(data.request);
        setSignerName(data.booking.person?.name || '');
        setSignerEmail(data.booking.person?.email || '');
        if (data.booking.depositAmount) setCcChargeEstimate(String(data.booking.depositAmount));
        const req = data.request as any;
        setDone({
          agreement: req?.rentalAgreement || false,
          lcdw: req?.lcdwAccepted || false,
          coi: (req?.coiReceived && req?.wcReceived) || false,
          cc: req?.creditCardAuth || false,
        });
        setLocked(['CONFIRMED', 'ACTIVE', 'COMPLETE', 'CLOSED'].includes(data.booking.status));
      })
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false));
  }, [token]);

  const initCanvas = (canvas: HTMLCanvasElement | null, setDrawn: (v: boolean) => void) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = '#111827'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    let drawing = false, lx = 0, ly = 0;
    const getPos = (e: MouseEvent | TouchEvent) => {
      const r = canvas.getBoundingClientRect();
      const sx = canvas.width / r.width, sy = canvas.height / r.height;
      if ('touches' in e) return { x: (e.touches[0].clientX - r.left) * sx, y: (e.touches[0].clientY - r.top) * sy };
      return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    };
    canvas.onmousedown = canvas.ontouchstart = (e: any) => { e.preventDefault(); drawing = true; const p = getPos(e); lx = p.x; ly = p.y; };
    canvas.onmousemove = canvas.ontouchmove = (e: any) => { e.preventDefault(); if (!drawing) return; const p = getPos(e); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(p.x, p.y); ctx.stroke(); lx = p.x; ly = p.y; setDrawn(true); };
    canvas.onmouseup = canvas.ontouchend = () => { drawing = false; };
  };

  useEffect(() => { if (activeTab === 'agreement') setTimeout(() => initCanvas(mainSigRef.current, setMainSigDrawn), 200); }, [activeTab]);
  useEffect(() => { if (activeTab === 'lcdw') setTimeout(() => initCanvas(lcdwSigRef.current, setLcdwSigDrawn), 200); }, [activeTab]);
  useEffect(() => { if (activeTab === 'cc') setTimeout(() => initCanvas(ccSigRef.current, setCcSigDrawn), 200); }, [activeTab]);
  useEffect(() => {
    if (activeTab !== 'cc' || cpIframeUrl) return;
    fetch('/api/cardpointe/config').then(r => r.json()).then(d => { if (d.iframeUrl) setCpIframeUrl(d.iframeUrl); });
  }, [activeTab]);
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (typeof e.data === 'string' && e.data.startsWith('{"message":')) {
        try {
          const msg = JSON.parse(e.data);
          if (msg.message?.token) setCpToken(msg.message.token);
        } catch {}
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const clearSig = (ref: React.RefObject<HTMLCanvasElement>, setDrawn: (v: boolean) => void) => {
    if (!ref.current) return;
    ref.current.getContext('2d')!.clearRect(0, 0, ref.current.width, ref.current.height);
    setDrawn(false);
  };
  const sigData = (ref: React.RefObject<HTMLCanvasElement>) => ref.current?.toDataURL('image/png') || '';

  const post = async (path: string, body: any) => {
    if (locked) return false;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/portal/${token}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return r.ok;
    } finally { setSubmitting(false); }
  };

  const tabColor = (id: TabId): string => {
    if (id === 'overview') return 'neutral';
    if (id === 'coi') {
      if (done.coi) return 'done';
      if (coiReview?.requiresAdminApproval) return 'pending_admin';
      if (coiReview && !coiReview.hardPass) return 'fail';
      return 'pending';
    }
    return done[id] ? 'done' : 'pending';
  };

  const allDone = done.agreement && done.lcdw && done.coi && done.cc;

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-gray-400 text-sm">Loading...</div></div>;

  if (error || !booking) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="text-center">
        <div className="text-4xl mb-3">🔒</div>
        <div className="text-gray-800 font-semibold">Link Not Found</div>
        <div className="text-gray-500 text-sm mt-1">{error || 'This link is invalid or expired.'}</div>
        <div className="mt-3 text-sm">📞 <a href="tel:8185152389" className="font-semibold text-gray-700">(818) 515-2389</a></div>
      </div>
    </div>
  );

  const renderLockedCard = (title: string) => (
    <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6 text-center">
      <div className="text-4xl mb-3">🔒</div>
      <div className="font-bold text-base text-gray-800">{title} — Locked</div>
      <div className="text-sm mt-1 text-gray-500">This rental has been confirmed. Documents are read-only.</div>
    </div>
  );

  const renderDoneCard = (title: string, sub: string) => (
    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
      <div className="text-4xl mb-3">✅</div>
      <div className="text-emerald-800 font-bold text-base">{title}</div>
      <div className="text-emerald-600 text-sm mt-1">{sub}</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8F7F4]">
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center"><span className="text-white text-xs font-bold">SR</span></div>
            <div>
              <div className="text-sm font-semibold text-gray-900">SirReel Studio Services</div>
              <div className="text-[10px] text-gray-400">{booking.jobName} · {booking.bookingNumber}</div>
            </div>
          </div>
          <div className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg ${allDone ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            {[done.agreement, done.lcdw, done.coi, done.cc].filter(Boolean).length}/4 complete
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-2 flex overflow-x-auto border-t border-gray-100">
          {TABS.map(tab => {
            const color = tabColor(tab.id);
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-bold border-b-2 transition-all whitespace-nowrap ${
                  isActive
                    ? color === 'done' ? 'border-emerald-500 text-emerald-700'
                    : color === 'pending_admin' ? 'border-amber-500 text-amber-700'
                    : color === 'fail' ? 'border-red-500 text-red-600'
                    : color === 'pending' ? 'border-red-500 text-red-600'
                    : 'border-gray-900 text-gray-900'
                    : color === 'done' ? 'border-transparent text-emerald-600'
                    : color === 'pending_admin' ? 'border-transparent text-amber-500'
                    : color === 'fail' ? 'border-transparent text-red-400'
                    : color === 'pending' ? 'border-transparent text-red-400'
                    : 'border-transparent text-gray-400'
                }`}>
                <span className="text-sm">{color === 'done' ? '✓' : color === 'pending_admin' ? '⚠' : color === 'fail' ? '✗' : tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <div className="bg-gray-900 rounded-2xl p-5 text-white relative overflow-hidden">
              <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'repeating-linear-gradient(45deg,white 0,white 1px,transparent 0,transparent 50%)', backgroundSize: '8px 8px' }} />
              <div className="relative">
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Production</div>
                <h1 className="text-xl font-bold mb-3">{booking.jobName}</h1>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-white/10 rounded-xl p-2.5"><div className="text-[9px] text-gray-400 font-bold uppercase mb-0.5">Company</div><div className="text-sm font-semibold">{booking.company?.name}</div></div>
                  <div className="bg-white/10 rounded-xl p-2.5"><div className="text-[9px] text-gray-400 font-bold uppercase mb-0.5">Dates</div><div className="text-sm font-semibold">{fmtShort(booking.startDate)} – {fmtShort(booking.endDate)}</div></div>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Paperwork Required</div>
              <p className="text-xs text-gray-400 mb-4">Tap any item to complete it — you can do them in any order.</p>
              <div className="grid grid-cols-2 gap-2">
                {TABS.filter(t => t.id !== 'overview').map(tab => {
                  const color = tabColor(tab.id);
                  const isDone = color === 'done';
                  const isAmber = color === 'pending_admin';
                  const isFail = color === 'fail';
                  return (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${isDone ? 'border-emerald-200 bg-emerald-50' : isAmber ? 'border-amber-200 bg-amber-50' : isFail ? 'border-red-200 bg-red-50' : 'border-red-200 bg-red-50/60 hover:border-red-300'}`}>
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0 ${isDone ? 'bg-emerald-100' : isAmber ? 'bg-amber-100' : 'bg-red-100'}`}>{isDone ? '✓' : isAmber ? '⚠' : isFail ? '✗' : tab.icon}</div>
                      <div>
                        <div className={`text-[12px] font-semibold ${isDone ? 'text-emerald-700' : isAmber ? 'text-amber-700' : 'text-red-700'}`}>{tab.label}</div>
                        <div className={`text-[10px] ${isDone ? 'text-emerald-500' : isAmber ? 'text-amber-500' : 'text-red-400'}`}>{isDone ? 'Complete ✓' : isAmber ? 'Pending review' : 'Required'}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {allDone && <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-center text-sm text-emerald-700 font-semibold">🎉 All paperwork complete!</div>}
            </div>
          </div>
        )}

        {/* AGREEMENT */}
        {activeTab === 'agreement' && (
          locked ? renderLockedCard('Rental Agreement') :
          done.agreement ? renderDoneCard('Rental Agreement Signed', `Signed by ${paperwork?.signerName || signerName}`) : (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h2 className="font-bold text-gray-900 mb-2">Rental Agreement</h2>
                <p className="text-xs text-gray-500 mb-3">Download and review the agreement below. Upload your signed copy when ready — let us know if it contains any proposed changes.</p>
                <div className="flex gap-2 mb-4">
                  <a href={`/api/portal/${token}/contract/download?format=pdf`} target="_blank" className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-gray-900 text-white rounded-xl text-xs font-semibold hover:bg-gray-800">📄 Download PDF</a>
                  <a href={`/api/portal/${token}/contract/download?format=docx`} target="_blank" className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-semibold hover:bg-gray-50">📝 Download Word</a>
                </div>
                <div className="border-t border-gray-100 pt-4">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Upload Signed Contract</div>
                  {!redlineReview ? (
                    <div className="space-y-2">
                      <div onDragOver={e => { e.preventDefault(); }} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setRedlineFile(f); }} onClick={() => document.getElementById('redline-file')?.click()}
                        className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer ${redlineFile ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:border-gray-300 bg-gray-50'}`}>
                        {redlineFile ? <div><div className="text-xl mb-1">📄</div><div className="text-xs font-semibold text-blue-700">{redlineFile.name}</div></div> : <div><div className="text-xl mb-1">📤</div><div className="text-xs text-gray-500">Drop contract here or click to browse</div><div className="text-[10px] text-gray-400 mt-0.5">PDF or Word (.docx)</div></div>}
                        <input id="redline-file" type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={e => setRedlineFile(e.target.files?.[0] || null)} />
                      </div>
                      {redlineFile && (
                        <div className="space-y-2">
                          <div className="text-[11px] font-semibold text-gray-700">Does this contract contain proposed changes?</div>
                          <div className="flex gap-2">
                            <button onClick={async () => {
                              if (!redlineFile) return;
                              setRedlineSubmitting(true);
                              try {
                                const fd = new FormData(); fd.append('file', redlineFile);
                                const res = await fetch(`/api/portal/${token}/contract/redline`, { method: 'POST', body: fd });
                                const data = await res.json();
                                if (data.review) setRedlineReview(data.review);
                                else alert('Error: ' + (data.error || 'Unknown'));
                              } finally { setRedlineSubmitting(false); }
                            }} disabled={redlineSubmitting} className="flex-1 py-2 bg-amber-500 text-white rounded-xl text-xs font-semibold hover:bg-amber-600 disabled:opacity-40">
                              {redlineSubmitting ? '📋 Reviewing...' : '✏️ Yes, has changes'}
                            </button>
                            <button onClick={async () => {
                              if (!redlineFile) return;
                              setRedlineSubmitting(true);
                              try {
                                const fd = new FormData(); fd.append('file', redlineFile);
                                await fetch(`/api/portal/${token}/contract/redline`, { method: 'POST', body: fd });
                                setRedlineReview({ recommendation: 'approve', noChanges: true });
                              } finally { setRedlineSubmitting(false); }
                            }} disabled={redlineSubmitting} className="flex-1 py-2 bg-gray-900 text-white rounded-xl text-xs font-semibold hover:bg-gray-800 disabled:opacity-40">
                              {redlineSubmitting ? '...' : '✓ No changes'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className={`rounded-xl p-3 border ${redlineReview.noChanges ? 'bg-emerald-50 border-emerald-200' : redlineReview.recommendation === 'approve' ? 'bg-emerald-50 border-emerald-200' : redlineReview.recommendation === 'reject' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{redlineReview.noChanges ? '✅' : redlineReview.recommendation === 'approve' ? '✅' : redlineReview.recommendation === 'reject' ? '❌' : '📋'}</span>
                        <div>
                          <div className="text-xs font-bold text-gray-800">{redlineReview.noChanges && redlineReview.recommendation === 'approve' ? 'Contract Confirmed — No Issues' : redlineReview.noChanges ? 'Contract Received — Under Review' : redlineReview.recommendation === 'approve' ? 'Changes Acceptable' : redlineReview.recommendation === 'reject' ? 'Changes Not Acceptable' : 'Under Review'}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5">{redlineReview.noChanges && redlineReview.recommendation === 'approve' ? 'Your contract matches our standard agreement and is on file.' : 'Your contract has been received and is being reviewed by the SirReel team.'}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h2 className="font-bold text-gray-900 mb-4">Your Information</h2>
                <div className="grid grid-cols-2 gap-3">
                  {(['Full Name *', 'Title *', 'Email *', 'Phone', 'PO Number', 'DOT #'] as string[]).map((label, idx) => {
                    const vals = [signerName, signerTitle, signerEmail, signerPhone, poNumber, dotNumber];
                    const sets = [setSignerName, setSignerTitle, setSignerEmail, setSignerPhone, setPoNumber, setDotNumber];
                    return <div key={label}><label className="text-[11px] font-semibold text-gray-600 mb-1 block">{label}</label><input value={vals[idx]} onChange={e => sets[idx](e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" /></div>;
                  })}
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <div className="flex justify-between items-center mb-3"><h2 className="font-bold text-gray-900">Additional Contacts</h2><button type="button" onClick={() => setAdditionalContacts([...additionalContacts, { name: '', email: '', phone: '', position: '' }])} className="text-[11px] text-blue-600 font-semibold">+ Add</button></div>
                {additionalContacts.map((c, i) => (
                  <div key={i} className="grid grid-cols-2 gap-2 mb-2">
                    {['name', 'email', 'phone', 'position'].map(f => <input key={f} value={(c as any)[f]} placeholder={f.charAt(0).toUpperCase() + f.slice(1)} onChange={e => { const a = [...additionalContacts]; (a[i] as any)[f] = e.target.value; setAdditionalContacts(a); }} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />)}
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h2 className="font-bold text-gray-900 mb-2">Terms & Conditions</h2>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1 mb-4 border border-gray-100 rounded-xl p-3 bg-gray-50">
                  {TERMS.map(t => <div key={t.n} className="text-xs text-gray-600 leading-relaxed"><span className="font-semibold text-gray-800">{t.n}. {t.title}. </span>{t.text}</div>)}
                </div>
                <label className="flex items-start gap-3 cursor-pointer"><input type="checkbox" checked={termsRead} onChange={e => setTermsRead(e.target.checked)} className="mt-0.5 w-4 h-4 accent-gray-900" /><span className="text-sm text-gray-700 font-medium">I have read and agree to all terms and conditions.</span></label>
              </div>
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h2 className="font-bold text-gray-900 mb-2">Signature</h2>
                <SigCanvas canvasRef={mainSigRef} drawn={mainSigDrawn} onClear={() => clearSig(mainSigRef, setMainSigDrawn)} />
              </div>
              <button onClick={async () => { if (await post('sign', { step: 'agreement', signerName, signerTitle, signerEmail, signerPhone, poNumber, dotNumber, additionalContacts, termsRead, signatureData: sigData(mainSigRef) })) { setDone(d => ({ ...d, agreement: true })); setActiveTab('lcdw'); } }} disabled={!signerName || !signerTitle || !signerEmail || !termsRead || !mainSigDrawn || submitting} className="w-full bg-gray-900 text-white rounded-xl py-4 font-semibold text-sm hover:bg-gray-800 disabled:opacity-40">{submitting ? 'Saving...' : 'Sign & Save →'}</button>
            </div>
          )
        )}

        {/* LCDW */}
        {activeTab === 'lcdw' && (
          locked ? renderLockedCard('LCDW') :
          done.lcdw ? renderDoneCard('LCDW Acknowledged', 'Signed & on file') : (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h2 className="font-bold text-gray-900 mb-3">Limited Collision Damage Waiver</h2>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4"><div className="text-sm font-bold text-amber-800">$24.00 / day / vehicle</div></div>
                <p className="text-sm text-gray-600 leading-relaxed mb-5">The LCDW limits your liability for physical damage to SirReel vehicles at $24.00/day/vehicle.</p>
                <div className="space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer"><input type="checkbox" checked={lcdwAccepted} onChange={e => setLcdwAccepted(e.target.checked)} className="mt-0.5 w-4 h-4 accent-gray-900" /><span className="text-sm text-gray-700 font-medium">I accept LCDW at $24.00/day/vehicle.</span></label>
                  <label className="flex items-start gap-3 cursor-pointer"><input type="checkbox" checked={fuelAcknowledged} onChange={e => setFuelAcknowledged(e.target.checked)} className="mt-0.5 w-4 h-4 accent-gray-900" /><span className="text-sm text-gray-700 font-medium">I acknowledge the $10.00/gallon fuel return policy.</span></label>
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h2 className="font-bold text-gray-900 mb-2">Signature</h2>
                <SigCanvas canvasRef={lcdwSigRef} drawn={lcdwSigDrawn} onClear={() => clearSig(lcdwSigRef, setLcdwSigDrawn)} />
              </div>
              <button onClick={async () => { if (await post('sign', { step: 'lcdw', lcdwAccepted, fuelAcknowledged, lcdwSignatureData: sigData(lcdwSigRef) })) { setDone(d => ({ ...d, lcdw: true })); setActiveTab('coi'); } }} disabled={!lcdwSigDrawn || !fuelAcknowledged || submitting} className="w-full bg-gray-900 text-white rounded-xl py-4 font-semibold text-sm hover:bg-gray-800 disabled:opacity-40">{submitting ? 'Saving...' : 'Sign & Save →'}</button>
            </div>
          )
        )}

        {/* COI */}
        {activeTab === 'coi' && locked && renderLockedCard('Insurance Documents')}
        {activeTab === 'coi' && !locked && done.coi && !coiReview && !wcReview && renderDoneCard('Insurance Documents Approved', 'COI and Workers Comp on file')}
        {activeTab === 'coi' && !locked && (!done.coi || coiReview || wcReview) && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-2">
                <h2 className="font-bold text-gray-900">Certificate of Insurance</h2>
                {coiReview && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${coiReview.overallPass ? 'bg-emerald-100 text-emerald-700' : coiReview.requiresAdminApproval ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
                    {coiReview.overallPass ? '✓ Approved' : coiReview.requiresAdminApproval ? '⚠ Pending Review' : '✗ Issues'}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 mb-3">Upload your COI — we'll review it instantly against SirReel's requirements.</p>
              <div className="bg-gray-50 rounded-xl p-3 mb-4 text-xs text-gray-600"><div className="font-semibold text-gray-700 mb-0.5">Certificate holder must read:</div><div>SirReel Production Vehicles Inc. · 8500 Lankershim Blvd, Sun Valley, CA 91352</div></div>
              {!coiReview ? (
                <div className="space-y-3">
                  <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setCoiFile(f); }} onClick={() => document.getElementById('coi-file')?.click()}
                    className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer ${coiFile ? 'border-emerald-300 bg-emerald-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'}`}>
                    {coiFile ? <div><div className="text-2xl mb-1">📄</div><div className="text-sm font-semibold text-emerald-700">{coiFile.name}</div></div> : <div><div className="text-2xl mb-1">📎</div><div className="text-sm text-gray-600">Drop COI here or click to browse</div><div className="text-xs text-gray-400">PDF, JPG, or PNG</div></div>}
                    <input id="coi-file" type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setCoiFile(e.target.files?.[0] || null)} />
                  </div>
                  <button onClick={async () => {
                    if (!coiFile) return;
                    setCoiReviewing(true);
                    try {
                      const fd = new FormData(); fd.append('file', coiFile);
                      const res = await fetch(`/api/portal/${token}/coi-review`, { method: 'POST', body: fd });
                      const data = await res.json();
                      if (data.review) {
                        setCoiReview(data.review);
                        if (data.review.overallPass && (data.review.workersComp?.pass || wcReview?.pass)) setDone(d => ({ ...d, coi: true }));
                      } else alert('Review error: ' + (data.error || 'Unknown'));
                      const fd2 = new FormData(); fd2.append('file', coiFile);
                      await fetch(`/api/portal/${token}/coi`, { method: 'POST', body: fd2 });
                    } catch (err: any) { alert('Upload failed: ' + err.message); }
                    finally { setCoiReviewing(false); }
                  }} disabled={!coiFile || coiReviewing} className="w-full bg-gray-900 text-white rounded-xl py-3.5 font-semibold text-sm hover:bg-gray-800 disabled:opacity-40">
                    {coiReviewing ? '🔍 Reviewing COI...' : 'Upload & Review →'}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className={`rounded-xl p-3 flex items-center gap-3 ${coiReview.overallPass ? 'bg-emerald-50 border border-emerald-200' : coiReview.requiresAdminApproval ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'}`}>
                    <span className="text-xl">{coiReview.overallPass ? '✅' : coiReview.requiresAdminApproval ? '⚠️' : '❌'}</span>
                    <div>
                      <div className={`text-sm font-bold ${coiReview.overallPass ? 'text-emerald-800' : coiReview.requiresAdminApproval ? 'text-amber-800' : 'text-red-700'}`}>
                        {coiReview.overallPass ? 'COI Approved' : coiReview.requiresAdminApproval ? 'Pending SirReel Review' : 'COI Needs Corrections'}
                      </div>
                      <div className={`text-xs mt-0.5 ${coiReview.overallPass ? 'text-emerald-600' : coiReview.requiresAdminApproval ? 'text-amber-600' : 'text-red-500'}`}>
                        {coiReview.overallPass ? 'All requirements met.' : coiReview.requiresAdminApproval ? 'Required coverages are in place. A SirReel team member will review the remaining items shortly.' : 'Please work with your broker to correct the issues below.'}
                      </div>
                    </div>
                  </div>
                  {coiReview.hardIssues?.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                      <div className="text-[10px] font-bold text-red-700 uppercase mb-2">Must Correct</div>
                      <ul className="space-y-1">{coiReview.hardIssues.map((issue: string, i: number) => <li key={i} className="text-[11px] text-red-700">• {issue}</li>)}</ul>
                    </div>
                  )}
                  {coiReview.manageableIssues?.length > 0 && coiReview.requiresAdminApproval && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                      <div className="text-[10px] font-bold text-amber-700 uppercase mb-2">Under Review by SirReel</div>
                      <ul className="space-y-1">{coiReview.manageableIssues.map((issue: string, i: number) => <li key={i} className="text-[11px] text-amber-700">• {issue}</li>)}</ul>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    {[
                      { label: 'Certificate Holder: SirReel', item: coiReview.certificateHolder, hard: true },
                      { label: 'General Liability', item: coiReview.generalLiability, hard: true },
                      { label: 'Auto Liability', item: coiReview.autoLiability, hard: true },
                      { label: 'Additional Insured', item: coiReview.additionalInsured, hard: true },
                      { label: 'Loss Payee', item: coiReview.lossPayee, hard: true },
                      { label: 'Primary & Non-Contributory', item: coiReview.primaryNonContributory, hard: true },
                      { label: 'Umbrella/Excess', item: coiReview.umbrella, hard: false },
                      { label: 'Waiver of Subrogation', item: coiReview.waiverOfSubrogation, hard: false },
                      { label: 'Entertainment Package', item: coiReview.entertainmentPackage, hard: false },
                      { label: 'Workers Comp (on COI)', item: coiReview.workersComp, hard: false },
                    ].filter(r => r.item).map((r, i) => (
                      <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] ${r.item.pass ? 'bg-emerald-50 text-emerald-700' : r.hard ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
                        <span className="font-bold">{r.item.pass ? '✓' : r.hard ? '✗' : '⚠'}</span>
                        <span className="flex-1">{r.label}</span>
                        {!r.hard && !r.item.pass && <span className="text-[9px] bg-amber-100 px-1.5 py-0.5 rounded font-bold">Admin review</span>}
                        {r.item.found && <span className="text-gray-400 text-[10px] truncate max-w-[80px]">{r.item.found}</span>}
                      </div>
                    ))}
                  </div>
                  {!coiReview.hardPass && <button onClick={() => { setCoiReview(null); setCoiFile(null); }} className="w-full py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50">Upload a New COI</button>}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-2">
                <h2 className="font-bold text-gray-900">Workers Compensation</h2>
                {wcReview && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${wcReview.pass ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>{wcReview.pass ? '✓ Approved' : '✗ Issues'}</span>}
              </div>
              <p className="text-sm text-gray-500 mb-3">If Workers Comp is on your main COI it will be reviewed automatically. If provided separately by your payroll company (ADP, Entertainment Partners, Cast & Crew, etc.), upload it here.</p>
              {coiReview?.workersComp?.pass ? (
                <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl"><span className="text-emerald-500">✓</span><span className="text-sm text-emerald-700">Workers Comp found on main COI — no separate upload needed.</span></div>
              ) : !wcReview ? (
                <div className="space-y-3">
                  <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setWcFile(f); }} onClick={() => document.getElementById('wc-file')?.click()}
                    className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer ${wcFile ? 'border-blue-300 bg-blue-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'}`}>
                    {wcFile ? <div><div className="text-2xl mb-1">📄</div><div className="text-sm font-semibold text-blue-700">{wcFile.name}</div></div> : <div><div className="text-2xl mb-1">🛡️</div><div className="text-sm text-gray-600">Drop WC certificate here or click to browse</div><div className="text-xs text-gray-400 mt-0.5">PDF, JPG, or PNG</div></div>}
                    <input id="wc-file" type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setWcFile(e.target.files?.[0] || null)} />
                  </div>
                  <button onClick={async () => {
                    if (!wcFile) return;
                    setWcReviewing(true);
                    try {
                      const fd = new FormData(); fd.append('file', wcFile);
                      const res = await fetch(`/api/portal/${token}/wc-review`, { method: 'POST', body: fd });
                      const data = await res.json();
                      if (data.review) { setWcReview(data.review); if (data.review.pass && coiReview?.overallPass) setDone(d => ({ ...d, coi: true })); }
                      else alert('Error: ' + (data.error || 'Unknown'));
                    } catch (err: any) { alert('Upload failed: ' + err.message); }
                    finally { setWcReviewing(false); }
                  }} disabled={!wcFile || wcReviewing} className="w-full bg-gray-900 text-white rounded-xl py-3.5 font-semibold text-sm hover:bg-gray-800 disabled:opacity-40">
                    {wcReviewing ? '🔍 Reviewing...' : 'Upload & Review →'}
                  </button>
                  <p className="text-center text-xs text-gray-400">Don't have it? Your SirReel rep can upload it if you send it to them directly.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className={`rounded-xl p-3 flex items-center gap-3 ${wcReview.pass ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                    <span className="text-xl">{wcReview.pass ? '✅' : '❌'}</span>
                    <div><div className={`text-sm font-bold ${wcReview.pass ? 'text-emerald-800' : 'text-red-700'}`}>{wcReview.pass ? 'Workers Comp Approved' : 'Needs Correction'}</div><div className="text-xs text-gray-500">{wcReview.provider && `Provider: ${wcReview.provider}`}{wcReview.expiryDate && ` · Expires ${wcReview.expiryDate}`}</div></div>
                  </div>
                  {!wcReview.pass && <button onClick={() => { setWcReview(null); setWcFile(null); }} className="w-full py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50">Upload New Document</button>}
                </div>
              )}
            </div>

            <button onClick={() => setActiveTab('cc')} className={`w-full rounded-xl py-4 font-semibold text-sm transition-colors ${(coiReview?.overallPass || coiReview?.requiresAdminApproval) && (coiReview?.workersComp?.pass || wcReview?.pass) ? 'bg-gray-900 text-white hover:bg-gray-800' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}>
              {(coiReview?.overallPass || coiReview?.requiresAdminApproval) ? 'Continue to CC Auth →' : 'Skip for now →'}
            </button>
          </div>
        )}

        {/* CC AUTH */}
        {activeTab === 'cc' && (
          locked ? renderLockedCard('Credit Card Authorization') :
          done.cc ? renderDoneCard('Credit Card Authorized', 'Authorization on file with SirReel') : (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h2 className="font-bold text-gray-900 mb-1">Credit Card Authorization</h2>
                <p className="text-sm text-gray-500 mb-5">Authorize SirReel to charge your card for rental fees, deposits, and applicable charges.</p>
                <div className="space-y-5">
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Contracting Rep</div>
                    <div className="grid grid-cols-2 gap-2">
                      {(['First', 'Last', 'Phone', 'Email'] as string[]).map((label, idx) => {
                        const vals = [ccRepFirst, ccRepLast, ccRepPhone, ccRepEmail];
                        const sets = [setCcRepFirst, setCcRepLast, setCcRepPhone, setCcRepEmail];
                        return <div key={label}><label className="text-[10px] text-gray-400 mb-1 block">{label}</label><input value={vals[idx]} onChange={e => sets[idx](e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" /></div>;
                      })}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Cardholder *</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="text-[10px] text-gray-400 mb-1 block">First Name *</label><input value={ccCardholderFirst} onChange={e => setCcCardholderFirst(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" /></div>
                      <div><label className="text-[10px] text-gray-400 mb-1 block">Last Name *</label><input value={ccCardholderLast} onChange={e => setCcCardholderLast(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" /></div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Billing Address</div>
                    <div className="space-y-2">
                      <input value={ccAddress1} onChange={e => setCcAddress1(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" placeholder="Address Line 1" />
                      <input value={ccAddress2} onChange={e => setCcAddress2(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" placeholder="Address Line 2 (optional)" />
                      <div className="grid grid-cols-3 gap-2">
                        <input value={ccCity} onChange={e => setCcCity(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" placeholder="City" />
                        <input value={ccState} onChange={e => setCcState(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" placeholder="State" />
                        <input value={ccZip} onChange={e => setCcZip(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" placeholder="ZIP" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input value={ccBillingPhone} onChange={e => setCcBillingPhone(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" placeholder="Phone" />
                        <input type="email" value={ccBillingEmail} onChange={e => setCcBillingEmail(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" placeholder="Email" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Card Type</div>
                    <div className="flex gap-2">
                      {['AMEX', 'VISA', 'MASTERCARD'].map(type => (
                        <label key={type} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer ${ccCardType === type ? 'border-gray-900 bg-gray-50 font-semibold' : 'border-gray-200'}`}>
                          <input type="radio" name="cardType" checked={ccCardType === type} onChange={() => setCcCardType(type)} className="accent-gray-900" />
                          <span className="text-sm">{type === 'MASTERCARD' ? 'MC' : type}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Summary of Charges</div>
                    <textarea value={ccChargeSummary} onChange={e => setCcChargeSummary(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400 resize-none" rows={2} placeholder="e.g. Truck Rentals, Production Supplies..." />
                    <input type="number" value={ccChargeEstimate} onChange={e => setCcChargeEstimate(e.target.value)} className="mt-2 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" placeholder="Approximate estimate ($)" />
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Card Number *</div>
                  <div className={`border rounded-xl overflow-hidden transition-all ${cpToken ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200'}`} style={{height: '48px'}}>
                    {cpIframeUrl ? (
                      <iframe src={cpIframeUrl} frameBorder="0" scrolling="no" width="100%" height="48" title="Card Entry" />
                    ) : (
                      <div className="flex items-center justify-center h-full text-xs text-gray-400">Loading secure card entry...</div>
                    )}
                  </div>
                  {cpToken && <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-600 font-semibold"><span>✓</span><span>Card captured securely</span></div>}
                  {!cpToken && cpIframeUrl && <div className="mt-1 text-[10px] text-gray-400">Enter your card number above — it is encrypted and never stored.</div>}
                </div>
                <div className="mt-3 bg-gray-50 rounded-xl p-3 text-xs text-gray-600">This Credit Card Authorization form guarantees the payment of all fees due SirReel Studio Services according to the Rental Agreement. This credit card may be used for Charges and Deposits, Cancellation Fees, Damage to Premises and Equipment, Past Due Balances, Fines, Parking Fees and all fees incurred during a given project/production. I agree that the cardholder is a Personal Guarantor of the charges here described and summarized.</div>
                <label className="flex items-start gap-3 cursor-pointer mt-4"><input type="checkbox" checked={ccAcknowledged} onChange={e => setCcAcknowledged(e.target.checked)} className="mt-0.5 w-4 h-4 accent-gray-900" /><span className="text-sm text-gray-700 font-medium">By submitting this form, I acknowledge that the information above is correct. By signing this form I am authorizing SirReel to charge my card for all fees listed above and to keep my card information on file with the payment processor until the transaction is completed. I also acknowledge and accept the Terms and Conditions stated by SirReel.</span></label>
              </div>
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h2 className="font-bold text-gray-900 mb-2">Cardholder Signature</h2>
                <SigCanvas canvasRef={ccSigRef} drawn={ccSigDrawn} onClear={() => clearSig(ccSigRef, setCcSigDrawn)} />
              </div>
              <button onClick={async () => {
                if (await post('sign', { step: 'cc', ccRepFirst, ccRepLast, ccRepPhone, ccRepEmail, ccCardholderFirst, ccCardholderLast, ccAddress1, ccAddress2, ccCity, ccState, ccZip, ccBillingPhone, ccBillingEmail, ccCardType, ccChargeSummary, ccChargeEstimate, ccToken: cpToken, ccSignatureData: sigData(ccSigRef) })) {
                  setDone(d => ({ ...d, cc: true })); setActiveTab('overview');
                }
              }} disabled={!ccCardholderFirst || !ccCardholderLast || !ccAcknowledged || !ccSigDrawn || !cpToken || submitting} className="w-full bg-gray-900 text-white rounded-xl py-4 font-semibold text-sm hover:bg-gray-800 disabled:opacity-40">{submitting ? 'Submitting...' : 'Authorize & Complete ✓'}</button>
            </div>
          )
        )}

        <p className="text-center text-[11px] text-gray-400 pb-4">SirReel Studio Services · (818) 515-2389</p>
      </div>
    </div>
  );
}
