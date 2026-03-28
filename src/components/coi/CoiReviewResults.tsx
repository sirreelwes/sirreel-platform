'use client';

type ReviewItem = { pass: boolean; found?: string; required?: string; note?: string };
type SubItem = { pass: boolean; found?: string; required?: string };

function Row({ label, item, children }: { label: string; item: ReviewItem; children?: React.ReactNode }) {
  return (
    <div className={`p-3 rounded-xl border ${item.pass ? 'border-emerald-100 bg-emerald-50' : 'border-red-100 bg-red-50'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={`text-sm flex-shrink-0 ${item.pass ? 'text-emerald-600' : 'text-red-500'}`}>
            {item.pass ? '✓' : '✗'}
          </span>
          <span className={`text-[12px] font-semibold ${item.pass ? 'text-emerald-800' : 'text-red-700'}`}>{label}</span>
        </div>
        {item.found && (
          <span className="text-[10px] text-gray-500 flex-shrink-0 text-right max-w-[140px] truncate">{item.found}</span>
        )}
      </div>
      {item.note && !item.pass && (
        <div className="mt-1 ml-5 text-[11px] text-red-600">{item.note}</div>
      )}
      {children && <div className="mt-2 ml-5 space-y-1">{children}</div>}
    </div>
  );
}

function SubRow({ label, item }: { label: string; item: SubItem }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <div className="flex items-center gap-1.5">
        <span className={item.pass ? 'text-emerald-500' : 'text-red-500'}>{item.pass ? '✓' : '✗'}</span>
        <span className={item.pass ? 'text-emerald-700' : 'text-red-600'}>{label}</span>
      </div>
      <div className="text-gray-500 text-right">
        {item.found && <span>{item.found}</span>}
        {item.required && !item.pass && <span className="text-red-500 ml-1">(need {item.required})</span>}
      </div>
    </div>
  );
}

export default function CoiReviewResults({ review, compact = false }: { review: any; compact?: boolean }) {
  if (!review) return null;

  const passCount = [
    review.certificateHolder?.pass,
    review.generalLiability?.pass,
    review.autoLiability?.pass,
    review.umbrella?.pass,
    review.workersComp?.pass,
    review.entertainmentPackage?.pass,
    review.additionalInsured?.pass,
    review.lossPayee?.pass,
    review.primaryNonContributory?.pass,
    review.waiverOfSubrogation?.pass,
    review.noRentedAutoExclusion?.pass,
  ].filter(Boolean).length;

  const totalChecks = 11;

  return (
    <div className="space-y-3">
      {/* Overall result banner */}
      <div className={`rounded-2xl p-4 flex items-center gap-3 ${
        review.overallPass ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'
      }`}>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-xl ${
          review.overallPass ? 'bg-emerald-100' : 'bg-red-100'
        }`}>
          {review.overallPass ? '✅' : '❌'}
        </div>
        <div className="flex-1">
          <div className={`text-sm font-bold ${review.overallPass ? 'text-emerald-800' : 'text-red-700'}`}>
            {review.overallPass ? 'COI Approved' : 'COI Needs Corrections'}
          </div>
          <div className={`text-[11px] ${review.overallPass ? 'text-emerald-600' : 'text-red-500'}`}>
            {passCount}/{totalChecks} requirements met
            {review.policyExpiry?.date && ` · Expires ${review.policyExpiry.date}`}
          </div>
        </div>
        {review.policyExpiry?.expired && (
          <div className="px-2 py-1 bg-red-200 text-red-800 text-[10px] font-bold rounded-lg flex-shrink-0">EXPIRED</div>
        )}
      </div>

      {/* Issues list */}
      {review.issues?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="text-[10px] font-bold text-amber-700 uppercase mb-2">Issues to Correct</div>
          <ul className="space-y-1">
            {review.issues.map((issue: string, i: number) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] text-amber-800">
                <span className="flex-shrink-0 mt-0.5">•</span>
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!compact && (
        <>
          {/* Certificate Holder */}
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Certificate Holder & Insured</div>
            <div className="space-y-1.5">
              {review.certificateHolder && (
                <Row label="Certificate Holder: SirReel" item={review.certificateHolder} />
              )}
              {review.insuredName && (
                <Row label={`Insured: ${review.insuredName.found || 'Unknown'}`} item={review.insuredName} />
              )}
            </div>
          </div>

          {/* Coverage sections */}
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Coverage Requirements</div>
            <div className="space-y-1.5">
              {review.generalLiability && (
                <Row label="General Liability" item={review.generalLiability}>
                  {review.generalLiability.perOccurrence && <SubRow label="Per Occurrence" item={review.generalLiability.perOccurrence} />}
                  {review.generalLiability.aggregate && <SubRow label="General Aggregate" item={review.generalLiability.aggregate} />}
                  {review.generalLiability.occurrenceForm && <SubRow label="Occurrence Form" item={review.generalLiability.occurrenceForm} />}
                </Row>
              )}
              {review.autoLiability && (
                <Row label="Automobile Liability" item={review.autoLiability}>
                  {review.autoLiability.combinedSingleLimit && <SubRow label="Combined Single Limit" item={review.autoLiability.combinedSingleLimit} />}
                  {review.autoLiability.hiredAutos && <SubRow label="Hired Autos" item={review.autoLiability.hiredAutos} />}
                  {review.autoLiability.nonOwnedAutos && <SubRow label="Non-Owned Autos" item={review.autoLiability.nonOwnedAutos} />}
                </Row>
              )}
              {review.umbrella && (
                <Row label="Umbrella / Excess Liability" item={review.umbrella}>
                  {review.umbrella.perOccurrence && <SubRow label="Per Occurrence" item={review.umbrella.perOccurrence} />}
                  {review.umbrella.aggregate && <SubRow label="Aggregate" item={review.umbrella.aggregate} />}
                </Row>
              )}
              {review.workersComp && (
                <Row label="Workers Compensation" item={review.workersComp}>
                  {review.workersComp.eachAccident && <SubRow label="Each Accident" item={review.workersComp.eachAccident} />}
                </Row>
              )}
              {review.entertainmentPackage && (
                <Row label="Entertainment Package" item={review.entertainmentPackage} />
              )}
            </div>
          </div>

          {/* Policy language */}
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Required Policy Language</div>
            <div className="space-y-1.5">
              {review.additionalInsured && <Row label="Additional Insured" item={review.additionalInsured} />}
              {review.lossPayee && <Row label="Loss Payee" item={review.lossPayee} />}
              {review.primaryNonContributory && <Row label="Primary & Non-Contributory" item={review.primaryNonContributory} />}
              {review.waiverOfSubrogation && <Row label="Waiver of Subrogation" item={review.waiverOfSubrogation} />}
              {review.noRentedAutoExclusion && <Row label="No Rented Auto Exclusion" item={review.noRentedAutoExclusion} />}
            </div>
          </div>
        </>
      )}

      {review.notes && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
          <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Notes</div>
          <p className="text-[11px] text-gray-600">{review.notes}</p>
        </div>
      )}
    </div>
  );
}
