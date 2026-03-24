import { prisma } from "@/lib/prisma"
import { EmailCategory, UserRole } from "@prisma/client"

const CATEGORY_ROLE_MAP: Record<string, UserRole> = {
  BOOKING_INQUIRY: UserRole.AGENT,
  RENTAL_REQUEST: UserRole.AGENT,
  SUPPORT: UserRole.AGENT,
  BILLING: UserRole.AGENT,
  COMPLAINT: UserRole.MANAGER,
  FLEET_ISSUE: UserRole.FLEET_TECH,
  GENERAL: UserRole.AGENT,
  SPAM: UserRole.AGENT,
}

export async function autoAssignEmail(messageId: string, category: EmailCategory) {
  const targetRole = CATEGORY_ROLE_MAP[category] || UserRole.AGENT

  const agents = await prisma.user.findMany({
    where: { role: targetRole, isActive: true },
    include: { _count: { select: { assignedPeople: true } } }
  })

  if (agents.length === 0) return null

  const agent = agents.sort((a, b) => a._count.assignedPeople - b._count.assignedPeople)[0]

  await prisma.emailMessage.update({
    where: { id: messageId },
    data: { assignedToId: agent.id, status: "ASSIGNED" },
  })

  return agent
}
