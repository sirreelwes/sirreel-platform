'use client';

/**
 * /tools/send-payment-info — the sales-reachable home of the "Send payment
 * info" form. Sales cannot open /admin/payment-info (it shows the account
 * numbers; reading stays ADMIN + BILLING), but Wes 2026-09-15: "let sales
 * send it too". The send route admits them; this page is just the form.
 */

import { SendPaymentInfoCard } from '@/components/payments/SendPaymentInfoCard';

export default function SendPaymentInfoPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-lt-fg">Send Payment Info</h1>
        <p className="text-sm text-lt-fg2 mt-1 max-w-[72ch]">
          For a client who needs to pay by transfer and isn&rsquo;t set up in HQ — an old job, a
          new A/P contact. The note is internal and says who they are.
        </p>
      </header>
      <SendPaymentInfoCard />
    </div>
  );
}
