import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function POST(req: NextRequest) {
  const body = await req.json()
  const token = body.Token || body.token
  const formType = body.FormType || body.formType
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 })
  const paperwork = await prisma.paperworkRequest.findUnique({ where: { token } })
  if (!paperwork) return NextResponse.json({ error: "Invalid token" }, { status: 404 })
  const update: Record<string, boolean> = {}
  if (formType === "coi") update.coiReceived = true
  if (formType === "rental") update.rentalAgreement = true
  if (formType === "creditcard") update.creditCardAuth = true
  const updated = await prisma.paperworkRequest.update({ where: { token }, data: update })
  const allDone = updated.coiReceived && updated.rentalAgreement && updated.creditCardAuth
  if (allDone) {
    await prisma.paperworkRequest.update({ where: { token }, data: { completedAt: new Date() } })
    await prisma.booking.update({ where: { id: paperwork.bookingId }, data: { coiReceived: true, rentalAgreement: true, depositPaid: true } })
  }
  return NextResponse.json({ success: true, allDone })
}
