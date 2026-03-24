-- CreateEnum
CREATE TYPE "Location" AS ENUM ('CHESTNUT', 'LIMA', 'LANKERSHIM', 'UTAH', 'ON_RENTAL', 'IN_TRANSIT', 'BODY_SHOP', 'HIGH_TECH');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('AVAILABLE', 'BOOKED', 'MAINTENANCE', 'IN_TRANSIT', 'WAREHOUSE', 'RETIRED', 'SOLD', 'STOLEN');

-- CreateEnum
CREATE TYPE "Region" AS ENUM ('LA', 'NORCAL', 'UTAH');

-- CreateEnum
CREATE TYPE "ClientTier" AS ENUM ('VIP', 'PREFERRED', 'STANDARD', 'NEW');

-- CreateEnum
CREATE TYPE "ProductionType" AS ENUM ('FILM', 'TV', 'COMMERCIAL', 'MUSIC_VIDEO', 'CORPORATE', 'OTHER');

-- CreateEnum
CREATE TYPE "PersonRole" AS ENUM ('UPM', 'PRODUCER', 'LINE_PRODUCER', 'PRODUCTION_COORDINATOR', 'PRODUCTION_SUPERVISOR', 'TRANSPORTATION_COORDINATOR', 'ART_COORDINATOR', 'COORDINATOR', 'OWNER', 'OTHER');

-- CreateEnum
CREATE TYPE "DriverType" AS ENUM ('EXTERNAL', 'INTERNAL');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('REQUEST', 'AI_REVIEW', 'PENDING_APPROVAL', 'CONFIRMED', 'ACTIVE', 'RETURNED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BookingPriority" AS ENUM ('URGENT', 'HIGH', 'STANDARD', 'LOW');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('WEBSITE', 'PHONE', 'EMAIL', 'AGENT_DIRECT', 'AI_AUTO');

-- CreateEnum
CREATE TYPE "UnionStatus" AS ENUM ('UNION', 'NON_UNION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "BookingItemStatus" AS ENUM ('REQUESTED', 'ASSIGNED', 'SUBSTITUTED', 'UNFULFILLED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'CHECKED_OUT', 'RETURNED', 'SWAPPED');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('REPAIR', 'DOT', 'SERVICE', 'BODYWORK', 'SMOG', 'DAMAGE_REPAIR', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('DELIVERY', 'PICKUP', 'SWAP', 'PUMP_SERVICE', 'STAGE_DELIVERY', 'STAGE_PICKUP', 'REPAIR_TRANSPORT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InspectionType" AS ENUM ('CHECKOUT', 'RETURN', 'ROUTINE', 'INCIDENT');

-- CreateEnum
CREATE TYPE "VehicleCondition" AS ENUM ('EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'DAMAGED');

-- CreateEnum
CREATE TYPE "DamageType" AS ENUM ('SCRATCH', 'DENT', 'CRACK', 'MISSING_PART', 'MECHANICAL', 'INTERIOR', 'OTHER');

-- CreateEnum
CREATE TYPE "DamageSeverity" AS ENUM ('MINOR', 'MODERATE', 'MAJOR');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('DRAFT', 'READY_TO_SEND', 'SUBMITTED', 'ACKNOWLEDGED', 'NEGOTIATING', 'SETTLED', 'DENIED', 'ESCALATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ClaimDocType" AS ENUM ('CHECKOUT_PHOTO', 'RETURN_PHOTO', 'REPAIR_ESTIMATE', 'REPAIR_INVOICE', 'DEMAND_LETTER', 'COUNTER_LETTER', 'COI', 'RENTAL_AGREEMENT', 'CORRESPONDENCE', 'SETTLEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ClaimAction" AS ENUM ('CREATED', 'SUBMITTED', 'ADJUSTER_ASSIGNED', 'OFFER_RECEIVED', 'COUNTER_SENT', 'NEGOTIATION_NOTE', 'SETTLED', 'DENIED', 'ESCALATED', 'DOCUMENT_ADDED');

-- CreateEnum
CREATE TYPE "AiDecisionType" AS ENUM ('AUTO_APPROVE', 'APPROVE_WITH_SUBS', 'NEEDS_REVIEW', 'WAITLIST', 'DENY');

-- CreateEnum
CREATE TYPE "EmailCategory" AS ENUM ('BOOKING_INQUIRY', 'RENTAL_REQUEST', 'SUPPORT', 'BILLING', 'COMPLAINT', 'FLEET_ISSUE', 'GENERAL', 'SPAM');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('UNREAD', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'AGENT', 'DISPATCHER', 'FLEET_TECH', 'DRIVER', 'CLIENT');

-- CreateTable
CREATE TABLE "asset_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "total_units" INTEGER NOT NULL,
    "daily_rate" DECIMAL(10,2) NOT NULL,
    "weekly_rate" DECIMAL(10,2),
    "min_rental_hours" INTEGER NOT NULL DEFAULT 24,
    "max_rental_days" INTEGER NOT NULL DEFAULT 365,
    "region" "Region" NOT NULL DEFAULT 'LA',
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "image_url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "planyo_resource_id" INTEGER,
    "rentalworks_category_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "unit_name" TEXT NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "location" "Location" NOT NULL DEFAULT 'CHESTNUT',
    "vin" VARCHAR(20),
    "license_plate" VARCHAR(20),
    "year" INTEGER,
    "make" VARCHAR(50),
    "model" VARCHAR(50),
    "mileage" INTEGER,
    "purchase_price" DECIMAL(12,2),
    "current_value" DECIMAL(12,2),
    "insurance_policy_num" VARCHAR(50),
    "rentalworks_asset_id" TEXT,
    "damage_id_ref" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "industry" "ProductionType" NOT NULL DEFAULT 'OTHER',
    "tier" "ClientTier" NOT NULL DEFAULT 'NEW',
    "total_spend" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_bookings" INTEGER NOT NULL DEFAULT 0,
    "default_agent_id" TEXT,
    "insurance_carrier" TEXT,
    "insurance_policy_num" TEXT,
    "insurance_contact" TEXT,
    "coi_on_file" BOOLEAN NOT NULL DEFAULT false,
    "coi_expiry" TIMESTAMP(3),
    "coi_document_url" TEXT,
    "rentalworks_customer_id" TEXT,
    "billing_email" TEXT,
    "billing_address" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" VARCHAR(30),
    "mobile" VARCHAR(30),
    "role" "PersonRole" NOT NULL DEFAULT 'OTHER',
    "tier" "ClientTier" NOT NULL DEFAULT 'NEW',
    "assigned_agent_id" TEXT,
    "total_spend" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_bookings" INTEGER NOT NULL DEFAULT 0,
    "last_booking_at" TIMESTAMP(3),
    "works_with_id" TEXT,
    "planyo_user_id" INTEGER,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliations" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "production_name" TEXT,
    "role_on_show" "PersonRole",
    "start_date" DATE,
    "end_date" DATE,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "total_spend" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_bookings" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" VARCHAR(30),
    "email" TEXT,
    "license_number" VARCHAR(30),
    "license_state" VARCHAR(5),
    "license_expiry" TIMESTAMP(3),
    "license_photo_url" TEXT,
    "type" "DriverType" NOT NULL DEFAULT 'EXTERNAL',
    "company_id" TEXT,
    "total_checkouts" INTEGER NOT NULL DEFAULT 0,
    "damage_incidents" INTEGER NOT NULL DEFAULT 0,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "flag_reason" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "booking_number" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "referred_by_id" TEXT,
    "agent_id" TEXT NOT NULL,
    "production_name" TEXT,
    "job_name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'REQUEST',
    "priority" "BookingPriority" NOT NULL DEFAULT 'STANDARD',
    "total_price" DECIMAL(12,2),
    "deposit_amount" DECIMAL(10,2),
    "deposit_paid" BOOLEAN NOT NULL DEFAULT false,
    "rental_agreement" BOOLEAN NOT NULL DEFAULT false,
    "coi_received" BOOLEAN NOT NULL DEFAULT false,
    "union_status" "UnionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "delivery_address" TEXT,
    "delivery_time" TEXT,
    "pickup_address" TEXT,
    "pickup_time" TEXT,
    "notes" TEXT,
    "admin_notes" TEXT,
    "ai_analysis_id" TEXT,
    "rentalworks_order_id" TEXT,
    "rentalworks_invoice_id" TEXT,
    "invoice_status" TEXT,
    "source" "BookingSource" NOT NULL DEFAULT 'PHONE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_items" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "daily_rate" DECIMAL(10,2) NOT NULL,
    "line_total" DECIMAL(10,2),
    "status" "BookingItemStatus" NOT NULL DEFAULT 'REQUESTED',
    "notes" TEXT,

    CONSTRAINT "booking_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_assignments" (
    "id" TEXT NOT NULL,
    "booking_item_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_records" (
    "id" TEXT NOT NULL,
    "booking_assignment_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "checked_out_by" TEXT NOT NULL,
    "checkout_time" TIMESTAMP(3) NOT NULL,
    "mileage_out" INTEGER,
    "fuel_out" TEXT,
    "checkout_inspection_id" TEXT,
    "return_time" TIMESTAMP(3),
    "mileage_in" INTEGER,
    "fuel_in" TEXT,
    "return_inspection_id" TEXT,
    "returned_to" TEXT,
    "license_verified" BOOLEAN NOT NULL DEFAULT false,
    "new_damage_on_return" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_records" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "type" "MaintenanceType" NOT NULL DEFAULT 'REPAIR',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "estimated_cost" DECIMAL(10,2),
    "actual_cost" DECIMAL(10,2),
    "vendor" TEXT,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "related_claim_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_tasks" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT,
    "asset_id" TEXT,
    "type" "TaskType" NOT NULL,
    "assigned_to" TEXT,
    "scheduled_date" DATE NOT NULL,
    "scheduled_time" TEXT,
    "from_location" "Location",
    "to_location" TEXT,
    "tow_vehicle" TEXT,
    "delivery_items" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatch_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspections" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "booking_assignment_id" TEXT,
    "type" "InspectionType" NOT NULL,
    "inspected_by" TEXT NOT NULL,
    "inspection_date" TIMESTAMP(3) NOT NULL,
    "overall_condition" "VehicleCondition" NOT NULL,
    "mileage_at_inspection" INTEGER,
    "fuel_level" TEXT,
    "damage_id_report_url" TEXT,
    "damage_id_ref" TEXT,
    "new_damage_found" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_items" (
    "id" TEXT NOT NULL,
    "inspection_id" TEXT NOT NULL,
    "location_on_vehicle" TEXT NOT NULL,
    "damage_type" "DamageType" NOT NULL,
    "severity" "DamageSeverity" NOT NULL,
    "photo_url" TEXT,
    "estimated_repair_cost" DECIMAL(10,2),
    "is_pre_existing" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "claim_id" TEXT,

    CONSTRAINT "damage_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_claims" (
    "id" TEXT NOT NULL,
    "claim_number" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "checkout_inspection_id" TEXT NOT NULL,
    "return_inspection_id" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "filed_against" TEXT NOT NULL,
    "adjuster_name" TEXT,
    "adjuster_phone" TEXT,
    "adjuster_email" TEXT,
    "policy_number" TEXT,
    "incident_date" DATE NOT NULL,
    "incident_description" TEXT NOT NULL,
    "repair_estimate" DECIMAL(10,2),
    "repair_actual" DECIMAL(10,2),
    "repair_vendor" TEXT,
    "days_out_of_service" INTEGER,
    "daily_revenue_rate" DECIMAL(10,2),
    "loss_of_revenue" DECIMAL(10,2),
    "total_demand" DECIMAL(10,2),
    "amount_offered" DECIMAL(10,2),
    "amount_settled" DECIMAL(10,2),
    "demand_letter_url" TEXT,
    "ai_generated_letter" TEXT,
    "ai_counter_response" TEXT,
    "assigned_to" TEXT,
    "notes" TEXT,
    "submitted_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_documents" (
    "id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "type" "ClaimDocType" NOT NULL,
    "title" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "uploaded_by" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_timeline" (
    "id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "action" "ClaimAction" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2),
    "performed_by" TEXT,
    "is_ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_timeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_decisions" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "decision" "AiDecisionType" NOT NULL,
    "confidence" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "suggested_assignments" JSONB,
    "alternatives_offered" JSONB,
    "conflicts_detected" JSONB,
    "revenue_estimate" DECIMAL(12,2),
    "upsell_suggestions" JSONB,
    "draft_client_message" TEXT,
    "was_overridden" BOOLEAN NOT NULL DEFAULT false,
    "override_reason" TEXT,
    "overridden_by" TEXT,
    "processing_time_ms" INTEGER,
    "model_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email_address" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "token_expiry" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_threads" (
    "id" TEXT NOT NULL,
    "gmail_thread_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "last_message_at" TIMESTAMP(3) NOT NULL,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" TEXT NOT NULL,
    "email_account_id" TEXT NOT NULL,
    "thread_id" TEXT,
    "gmail_message_id" TEXT NOT NULL,
    "company_id" TEXT,
    "person_id" TEXT,
    "from_address" TEXT NOT NULL,
    "to_addresses" TEXT[],
    "subject" TEXT NOT NULL,
    "snippet" TEXT,
    "direction" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "category" "EmailCategory",
    "status" "EmailStatus" NOT NULL DEFAULT 'UNREAD',
    "priority" INTEGER NOT NULL DEFAULT 5,
    "assigned_to_id" TEXT,
    "triage_notes" TEXT,
    "triage_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'AGENT',
    "phone" VARCHAR(30),
    "avatar_url" TEXT,
    "location" "Location",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "person_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "paperwork_requests" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "sent_to" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "coi_received" BOOLEAN NOT NULL DEFAULT false,
    "rental_agreement" BOOLEAN NOT NULL DEFAULT false,
    "credit_card_auth" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "paperwork_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asset_categories_slug_key" ON "asset_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "asset_categories_planyo_resource_id_key" ON "asset_categories"("planyo_resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "people_email_key" ON "people"("email");

-- CreateIndex
CREATE UNIQUE INDEX "affiliations_person_id_company_id_production_name_key" ON "affiliations"("person_id", "company_id", "production_name");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_booking_number_key" ON "bookings"("booking_number");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_claims_claim_number_key" ON "insurance_claims"("claim_number");

-- CreateIndex
CREATE UNIQUE INDEX "email_accounts_email_address_key" ON "email_accounts"("email_address");

-- CreateIndex
CREATE UNIQUE INDEX "email_threads_gmail_thread_id_key" ON "email_threads"("gmail_thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_gmail_message_id_key" ON "email_messages"("gmail_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_person_id_key" ON "users"("person_id");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "paperwork_requests_token_key" ON "paperwork_requests"("token");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "asset_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_default_agent_id_fkey" FOREIGN KEY ("default_agent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_assigned_agent_id_fkey" FOREIGN KEY ("assigned_agent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_works_with_id_fkey" FOREIGN KEY ("works_with_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_referred_by_id_fkey" FOREIGN KEY ("referred_by_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "asset_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_assignments" ADD CONSTRAINT "booking_assignments_booking_item_id_fkey" FOREIGN KEY ("booking_item_id") REFERENCES "booking_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_assignments" ADD CONSTRAINT "booking_assignments_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_records" ADD CONSTRAINT "checkout_records_booking_assignment_id_fkey" FOREIGN KEY ("booking_assignment_id") REFERENCES "booking_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_records" ADD CONSTRAINT "checkout_records_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_records" ADD CONSTRAINT "checkout_records_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_records" ADD CONSTRAINT "checkout_records_checked_out_by_fkey" FOREIGN KEY ("checked_out_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_related_claim_id_fkey" FOREIGN KEY ("related_claim_id") REFERENCES "insurance_claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_tasks" ADD CONSTRAINT "dispatch_tasks_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_tasks" ADD CONSTRAINT "dispatch_tasks_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_tasks" ADD CONSTRAINT "dispatch_tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_booking_assignment_id_fkey" FOREIGN KEY ("booking_assignment_id") REFERENCES "booking_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspected_by_fkey" FOREIGN KEY ("inspected_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_items" ADD CONSTRAINT "damage_items_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_items" ADD CONSTRAINT "damage_items_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "insurance_claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_checkout_inspection_id_fkey" FOREIGN KEY ("checkout_inspection_id") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_return_inspection_id_fkey" FOREIGN KEY ("return_inspection_id") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_documents" ADD CONSTRAINT "claim_documents_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "insurance_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_documents" ADD CONSTRAINT "claim_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_timeline" ADD CONSTRAINT "claim_timeline_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "insurance_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_timeline" ADD CONSTRAINT "claim_timeline_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_overridden_by_fkey" FOREIGN KEY ("overridden_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_email_account_id_fkey" FOREIGN KEY ("email_account_id") REFERENCES "email_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "email_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paperwork_requests" ADD CONSTRAINT "paperwork_requests_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
