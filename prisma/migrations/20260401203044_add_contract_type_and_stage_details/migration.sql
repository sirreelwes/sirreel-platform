-- AlterTable
ALTER TABLE "paperwork_requests" ADD COLUMN     "cc_auth_signed_at" TIMESTAMP(3),
ADD COLUMN     "cc_card_last4" TEXT,
ADD COLUMN     "cc_card_number_encrypted" TEXT,
ADD COLUMN     "cc_card_type" TEXT,
ADD COLUMN     "cc_cardholder_first" TEXT,
ADD COLUMN     "cc_cardholder_last" TEXT,
ADD COLUMN     "cc_charge_estimate" DECIMAL(10,2),
ADD COLUMN     "contract_type" TEXT NOT NULL DEFAULT 'vehicles',
ADD COLUMN     "lcdw_accepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "signer_name" TEXT,
ADD COLUMN     "stage_details" TEXT,
ADD COLUMN     "studio_contract_signed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "wc_received" BOOLEAN NOT NULL DEFAULT false;
