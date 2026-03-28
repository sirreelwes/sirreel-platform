/*
  Warnings:

  - A unique constraint covering the columns `[fleetio_id]` on the table `maintenance_records` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "maintenance_records" ADD COLUMN     "fleetio_id" TEXT,
ADD COLUMN     "unit_name" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_records_fleetio_id_key" ON "maintenance_records"("fleetio_id");
