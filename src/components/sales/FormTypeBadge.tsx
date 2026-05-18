'use client';

/**
 * Shared visual treatment for EmailMessage.inferredFormType. Used by the
 * pipeline list (InquiriesSection) and the slider (ThreadDrawer) so the
 * team sees the same color/label everywhere a form-typed message surfaces.
 *
 * Routing isn't affected yet — this is purely a "what kind of message is
 * this" signal. The current enum values + their visual treatment are
 * deliberately conservative; we can tighten the design later without
 * touching every callsite.
 */

export type FormType =
  | 'BOOKING_INQUIRY'
  | 'ANNUAL_AGREEMENT'
  | 'JOB_AGREEMENT'
  | 'DAMAGE_REPORT'
  | 'COI';

interface FormTypeMeta {
  label: string;
  short: string;
  classes: string;
}

const META: Record<FormType, FormTypeMeta> = {
  BOOKING_INQUIRY: {
    label: 'Booking inquiry',
    short: 'Inquiry',
    classes: 'bg-emerald-100 text-emerald-700',
  },
  ANNUAL_AGREEMENT: {
    label: 'Annual agreement',
    short: 'Annual MSA',
    classes: 'bg-violet-100 text-violet-700',
  },
  JOB_AGREEMENT: {
    label: 'Rental agreement',
    short: 'Agreement',
    classes: 'bg-amber-100 text-amber-700',
  },
  DAMAGE_REPORT: {
    label: 'Damage report',
    short: 'Damage',
    classes: 'bg-red-100 text-red-700',
  },
  COI: {
    label: 'Certificate of insurance',
    short: 'COI',
    classes: 'bg-blue-100 text-blue-700',
  },
};

export function FormTypeBadge({
  type,
  size = 'sm',
  variant = 'short',
}: {
  type: FormType | null | undefined;
  size?: 'sm' | 'xs';
  variant?: 'short' | 'long';
}) {
  if (!type) return null;
  const meta = META[type];
  if (!meta) return null;
  const sizeClasses = size === 'xs' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5';
  const label = variant === 'long' ? meta.label : meta.short;
  return (
    <span
      title={meta.label}
      className={`${sizeClasses} font-bold uppercase tracking-wider rounded ${meta.classes}`}
    >
      {label}
    </span>
  );
}

export function formTypeLabel(type: FormType | null | undefined): string {
  if (!type) return '';
  return META[type]?.label || '';
}
