/**
 * Run from the repo root: npx tsx tmp/verify-line-unit-throughline.ts
 * Live verification of the order-line ↔ reserved-unit through line, against
 * the real route handlers with a stubbed session. Self-owned ZZTEST fixtures
 * on 2027 dates; cleanup by captured id only.
 */
import Module from 'module'
import { NextRequest } from 'next/server'

const SESSION = { user: { email: 'wes@sirreel.com', name: 'Wes Bailey' } }
const origLoad = (Module as any)._load
;(Module as any)._load = function (req: string, parent: any, isMain: boolean) {
  const mod = origLoad.apply(this, [req, parent, isMain])
  if (req === 'next-auth' && mod && typeof mod === 'object') {
    return new Proxy(mod, { get: (t, p) => (p === 'getServerSession' ? async () => SESSION : (t as any)[p]) })
  }
  return mod
}

const CARGO_INV = '10c2108c-c3ff-4e23-b317-a1989b130368' // Cargo Van w/ Liftgate
const CARGO_CAT = 'c6bffb8b-f047-404b-a48a-b9e6862ce8d3'
const CUBE_INV = '9e990153-429f-4687-9e3a-493f1def398d' // SuperCube Truck
const CUBE_CAT = 'c564d46e-12f7-4a04-a3f1-e87ca57ce37b'
const START = '2027-03-08'
const END = '2027-03-10'

const fails: string[] = []
function check(cond: unknown, label: string, extra?: unknown) {
  if (cond) console.log('  ✓', label)
  else { console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra) : ''); fails.push(label) }
}
const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

async function main() {
  const { prisma } = await import('../src/lib/prisma')
  const lineItems = await import('../src/app/api/orders/[id]/line-items/route')
  const lineItem = await import('../src/app/api/orders/[id]/line-items/[lineId]/route')
  const switchClass = await import('../src/app/api/orders/[id]/line-items/[lineId]/switch-class/route')
  const gearHandoff = await import('../src/app/api/orders/[id]/gear-handoff/route')
  const orderRoute = await import('../src/app/api/orders/[id]/route')

  const ts = Date.now()
  const wes = await prisma.user.findFirstOrThrow({ where: { email: 'wes@sirreel.com' }, select: { id: true } })
  const owned = { companyId: '', personId: '', jobId: '', contactId: '', orderId: '', bookingId: '' as string | null }

  try {
    const company = await prisma.company.create({ data: { name: `ZZTEST Throughline ${ts}` }, select: { id: true } })
    owned.companyId = company.id
    const person = await prisma.person.create({
      data: { firstName: 'Zz', lastName: `ZZTEST-${ts}`, email: `zztest-throughline-${ts}@example.invalid` }, select: { id: true },
    })
    owned.personId = person.id
    const job = await prisma.job.create({
      data: { jobCode: `ZZTEST-TL-${ts}`, name: `ZZTEST Throughline ${ts}`, companyId: company.id, agentId: wes.id },
      select: { id: true },
    })
    owned.jobId = job.id
    const contact = await prisma.jobContact.create({ data: { jobId: job.id, personId: person.id, role: 'PM', isPrimary: true }, select: { id: true } })
    owned.contactId = contact.id
    const order = await prisma.order.create({
      data: {
        orderNumber: `ZZTEST-TL-${ts}`, companyId: company.id, agentId: wes.id, jobId: job.id,
        jobContactId: person.id, status: 'DRAFT', startDate: new Date(START), endDate: new Date(END),
      },
      select: { id: true },
    })
    owned.orderId = order.id
    const P = (lineId?: string) => ({ params: Promise.resolve(lineId ? { id: order.id, lineId } : { id: order.id }) })

    // ── a. Two cargo vans on one line → two trucks stamped with THAT line ──
    console.log('\n[a] add 2× Cargo Van line')
    let r: Response = await lineItems.POST(req(`/api/orders/${order.id}/line-items`, 'POST', {
      type: 'VEHICLE', description: 'Cargo Van w/ Liftgate', inventoryItemId: CARGO_INV, rateType: 'DAILY', rate: 170, quantity: 2,
      unitAssignment: { mode: 'next' },
    }), P())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let j: any = await r.json()
    check(r.status === 200 || r.status === 201, `POST cargo line → ${r.status}`, j)
    const cargoLineId: string = j.lineItem?.id
    check(j.unitAssignment?.assigned?.length === 2, 'two cargo units bound', j.unitAssignment)
    let rows = await prisma.bookingAssignment.findMany({ where: { orderId: order.id }, select: { id: true, assetId: true, orderLineItemId: true, status: true, asset: { select: { unitName: true } }, bookingItem: { select: { categoryId: true } } } })
    check(rows.length === 2 && rows.every((a) => a.orderLineItemId === cargoLineId), 'both assignments carry the cargo line id', rows)
    const cargoUnits = rows.map((a) => a.asset.unitName)
    const ord = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { bookingId: true } })
    owned.bookingId = ord.bookingId
    check(!!ord.bookingId, 'order has a booking')

    // ── b. One SuperCube on a second line ──
    console.log('\n[b] add 1× SuperCube line')
    r = await lineItems.POST(req(`/api/orders/${order.id}/line-items`, 'POST', {
      type: 'VEHICLE', description: 'SuperCube Truck', inventoryItemId: CUBE_INV, rateType: 'DAILY', rate: 200, quantity: 1,
    }), P())
    j = await r.json()
    const cubeLineId: string = j.lineItem?.id
    check(j.unitAssignment?.assigned?.length === 1, 'one cube bound', j.unitAssignment)
    const cubeAssignment = await prisma.bookingAssignment.findFirstOrThrow({ where: { orderLineItemId: cubeLineId, status: 'ASSIGNED' }, select: { id: true, assetId: true, asset: { select: { unitName: true } } } })
    console.log('    cube line unit:', cubeAssignment.asset.unitName)

    // ── c. Cargo line 2 → 1 gives back ONE specific van, the other stays ──
    console.log('\n[c] cargo quantity 2 → 1')
    r = await lineItem.PUT(req(`/api/orders/${order.id}/line-items/${cargoLineId}`, 'PUT', { quantity: 1 }), P(cargoLineId))
    j = await r.json()
    check(r.status === 200, `PUT quantity → ${r.status}`, j)
    check(j.released?.units?.length === 1, 'response names the released van', j.released)
    rows = await prisma.bookingAssignment.findMany({ where: { orderLineItemId: cargoLineId }, select: { id: true, assetId: true, orderLineItemId: true, status: true, asset: { select: { unitName: true } }, bookingItem: { select: { categoryId: true } } } })
    check(rows.filter((a) => a.status === 'ASSIGNED').length === 1 && rows.filter((a) => a.status === 'SWAPPED').length === 1, 'one ASSIGNED, one SWAPPED on the cargo line', rows.map((a) => [a.asset.unitName, a.status]))
    const cargoItem = await prisma.bookingItem.findFirstOrThrow({ where: { bookingId: ord.bookingId!, categoryId: CARGO_CAT }, select: { id: true, quantity: true, status: true } })
    check(cargoItem.quantity === 1, `cargo hold quantity is 1 (got ${cargoItem.quantity})`)
    const remainingCargo = rows.find((a) => a.status === 'ASSIGNED')!.asset.unitName

    // ── d. Re-picking the catalog row to a cube is REFUSED, pointing at Switch class ──
    console.log('\n[d] edit form re-picks the cargo line as a SuperCube')
    r = await lineItem.PUT(req(`/api/orders/${order.id}/line-items/${cargoLineId}`, 'PUT', { inventoryItemId: CUBE_INV, assetCategoryId: null, rate: 170, quantity: 1 }), P(cargoLineId))
    j = await r.json()
    check(r.status === 409 && j.code === 'USE_SWITCH_CLASS', `refused with USE_SWITCH_CLASS (${r.status})`, j)
    check(Array.isArray(j.units) && j.units.includes(remainingCargo), `refusal names ${remainingCargo}`, j.units)
    check(j.newCategoryId === CUBE_CAT, 'refusal carries the new class id')
    const still = await prisma.orderLineItem.findUniqueOrThrow({ where: { id: cargoLineId }, select: { inventoryItemId: true } })
    check(still.inventoryItemId === CARGO_INV, 'line unchanged after refusal')

    // ── e. Switch class moves THIS line's van, leaves the cube line's cube alone ──
    console.log('\n[e] switch the cargo line to SuperCube')
    r = await switchClass.POST(req(`/api/orders/${order.id}/line-items/${cargoLineId}/switch-class`, 'POST', { categoryId: CUBE_CAT }), P(cargoLineId))
    j = await r.json()
    check(r.status === 200, `switch-class → ${r.status}`, j)
    check(j.released?.units?.length === 1 && j.released.units[0] === remainingCargo, `released ${remainingCargo}`, j.released)
    check(j.unitAssignment?.assigned?.length === 1, 'a cube bound for the switched line', j.unitAssignment)
    const switched = await prisma.bookingAssignment.findMany({ where: { orderLineItemId: cargoLineId, status: 'ASSIGNED' }, select: { asset: { select: { unitName: true } }, bookingItem: { select: { categoryId: true } } } })
    check(switched.length === 1 && switched[0].bookingItem.categoryId === CUBE_CAT, 'switched line now holds a cube stamped to it', switched)
    const cubeStill = await prisma.bookingAssignment.findUniqueOrThrow({ where: { id: cubeAssignment.id }, select: { status: true, orderLineItemId: true } })
    check(cubeStill.status === 'ASSIGNED' && cubeStill.orderLineItemId === cubeLineId, 'the cube line’s own cube untouched by the switch')
    const cubeItem = await prisma.bookingItem.findFirstOrThrow({ where: { bookingId: ord.bookingId!, categoryId: CUBE_CAT, status: { in: ['REQUESTED', 'ASSIGNED'] } }, select: { id: true, quantity: true, status: true } })
    check(cubeItem.quantity === 2, `cube hold quantity is 2 (got ${cubeItem.quantity})`)

    // ── f. A gear line, and where it loads ──
    console.log('\n[f] gear line + load-on note')
    r = await lineItems.POST(req(`/api/orders/${order.id}/line-items`, 'POST', {
      type: 'EQUIPMENT', description: 'ZZTEST walkies', department: 'PRO_SUPPLIES', rateType: 'DAILY', rate: 10, quantity: 4,
    }), P())
    j = await r.json()
    check(r.status === 200 || r.status === 201, `POST gear line → ${r.status}`, j)
    const gearLineId: string = j.lineItem?.id
    r = await gearHandoff.PATCH(req(`/api/orders/${order.id}/gear-handoff`, 'PATCH', { handoff: 'LOAD_ON', assignmentId: cubeAssignment.id }), P())
    j = await r.json()
    check(r.status === 200 && j.gearLoadsOnAssignmentId === cubeAssignment.id && j.unitName === cubeAssignment.asset.unitName, `LOAD_ON ${cubeAssignment.asset.unitName} accepted`, j)
    const swappedCargo = await prisma.bookingAssignment.findFirstOrThrow({ where: { orderId: order.id, status: 'SWAPPED' }, select: { id: true } })
    r = await gearHandoff.PATCH(req(`/api/orders/${order.id}/gear-handoff`, 'PATCH', { handoff: 'LOAD_ON', assignmentId: swappedCargo.id }), P())
    j = await r.json()
    check(r.status === 409, `a released unit is refused (${r.status}: ${j.reason})`)
    r = await gearHandoff.PATCH(req(`/api/orders/${order.id}/gear-handoff`, 'PATCH', { handoff: 'LOAD_ON', assignmentId: '00000000-0000-0000-0000-000000000000' }), P())
    check(r.status === 404, `an unknown unit is refused (${r.status})`)
    const foreign = await prisma.bookingAssignment.findFirst({ where: { status: 'ASSIGNED', bookingItem: { booking: { jobId: { not: job.id } } } }, select: { id: true } })
    if (foreign) {
      r = await gearHandoff.PATCH(req(`/api/orders/${order.id}/gear-handoff`, 'PATCH', { handoff: 'LOAD_ON', assignmentId: foreign.id }), P())
      check(r.status === 409, `another job's unit is refused (${r.status})`)
    }
    r = await gearHandoff.PATCH(req(`/api/orders/${order.id}/gear-handoff`, 'PATCH', { handoff: 'WILL_CALL' }), P())
    j = await r.json()
    check(r.status === 200 && j.gearHandoff === 'WILL_CALL' && j.gearLoadsOnAssignmentId === null, 'WILL_CALL clears the unit')
    r = await gearHandoff.PATCH(req(`/api/orders/${order.id}/gear-handoff`, 'PATCH', { handoff: 'LOAD_ON', assignmentId: cubeAssignment.id }), P())
    check(r.status === 200, 'back to LOAD_ON for the read check')

    // ── g. Order GET carries the stamps + the note ──
    console.log('\n[g] order GET')
    r = await orderRoute.GET(req(`/api/orders/${order.id}`, 'GET'), P())
    j = await r.json()
    const items = (j.booking?.items ?? []) as { assignments: { id: string; orderLineItemId: string | null; order: { orderNumber: string } | null }[] }[]
    const allAssign = items.flatMap((it) => it.assignments)
    check(allAssign.some((a) => a.orderLineItemId === cubeLineId), 'GET assignments carry orderLineItemId', allAssign)
    check(allAssign.every((a) => a.order?.orderNumber === `ZZTEST-TL-${ts}`), 'GET assignments carry the order number')
    check(j.gearHandoff === 'LOAD_ON' && j.gearLoadsOnAssignmentId === cubeAssignment.id, 'GET carries the load-on note')

    // ── h. Deleting the cube line takes ITS cube, not the switched line's ──
    console.log('\n[h] delete the cube line')
    r = await lineItem.DELETE(req(`/api/orders/${order.id}/line-items/${cubeLineId}`, 'DELETE'), P(cubeLineId))
    j = await r.json()
    check(r.status === 200, `DELETE → ${r.status}`, j)
    check(j.released?.units?.length === 1 && j.released.units[0] === cubeAssignment.asset.unitName, `released ${cubeAssignment.asset.unitName}`, j.released)
    const afterDel = await prisma.bookingAssignment.findUniqueOrThrow({ where: { id: cubeAssignment.id }, select: { status: true, orderLineItemId: true } })
    check(afterDel.status === 'SWAPPED', 'deleted line’s cube is SWAPPED')
    const sibling = await prisma.bookingAssignment.findMany({ where: { orderLineItemId: cargoLineId, status: 'ASSIGNED' }, select: { id: true } })
    check(sibling.length === 1, 'the switched line still holds its cube (sibling untouched)')
    const cubeItemAfter = await prisma.bookingItem.findUniqueOrThrow({ where: { id: cubeItem.id }, select: { quantity: true, status: true } })
    check(cubeItemAfter.quantity === 1 && cubeItemAfter.status !== 'UNFULFILLED', `cube hold now quantity 1, live (got ${cubeItemAfter.quantity} ${cubeItemAfter.status})`)
    check(!(await prisma.orderLineItem.findUnique({ where: { id: cubeLineId } })), 'line row gone')

    // ── i. Deleting the last line of a class releases the whole hold; a new line revives it ──
    console.log('\n[i] delete the switched line, then re-add a cube')
    r = await lineItem.DELETE(req(`/api/orders/${order.id}/line-items/${cargoLineId}`, 'DELETE'), P(cargoLineId))
    j = await r.json()
    check(r.status === 200 && j.released?.units?.length === 1, 'last cube released', j.released)
    const cubeItemDead = await prisma.bookingItem.findUniqueOrThrow({ where: { id: cubeItem.id }, select: { quantity: true, status: true } })
    check(cubeItemDead.status === 'UNFULFILLED', `cube hold released (${cubeItemDead.status} q${cubeItemDead.quantity}) — the row survives, nothing cascaded`)
    r = await lineItems.POST(req(`/api/orders/${order.id}/line-items`, 'POST', {
      type: 'VEHICLE', description: 'SuperCube Truck', inventoryItemId: CUBE_INV, rateType: 'DAILY', rate: 200, quantity: 1,
    }), P())
    j = await r.json()
    const cubeLine2: string = j.lineItem?.id
    const cubeItemRevived = await prisma.bookingItem.findFirst({ where: { bookingId: ord.bookingId!, categoryId: CUBE_CAT, status: { in: ['REQUESTED', 'ASSIGNED'] } }, select: { id: true, quantity: true, status: true } })
    check(!!cubeItemRevived && cubeItemRevived.quantity === 1, `a new cube line revives the hold at quantity 1`, cubeItemRevived)
    check(j.unitAssignment?.assigned?.length === 1, 'and binds a cube to it', j.unitAssignment)
    const stamped2 = await prisma.bookingAssignment.count({ where: { orderLineItemId: cubeLine2, status: 'ASSIGNED' } })
    check(stamped2 === 1, 'stamped to the new line')
    void gearLineId
  } finally {
    // ── cleanup by captured id ──
    console.log('\n[cleanup]')
    if (owned.orderId) {
      const lines = await prisma.orderLineItem.findMany({ where: { orderId: owned.orderId }, select: { id: true } })
      const ids = [owned.orderId, owned.jobId, ...lines.map((l) => l.id)].filter(Boolean)
      if (owned.bookingId) {
        const items = await prisma.bookingItem.findMany({ where: { bookingId: owned.bookingId }, select: { id: true } })
        ids.push(owned.bookingId, ...items.map((i) => i.id))
        await prisma.booking.delete({ where: { id: owned.bookingId } }).catch((e) => console.log('  booking delete:', e.message))
      }
      const audits = await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } })
      console.log('  audit rows removed:', audits.count)
      await prisma.order.delete({ where: { id: owned.orderId } }).catch((e) => console.log('  order delete:', e.message))
    }
    if (owned.contactId) await prisma.jobContact.delete({ where: { id: owned.contactId } }).catch(() => {})
    if (owned.jobId) await prisma.job.delete({ where: { id: owned.jobId } }).catch((e) => console.log('  job delete:', e.message))
    if (owned.personId) await prisma.person.delete({ where: { id: owned.personId } }).catch((e) => console.log('  person delete:', e.message))
    if (owned.companyId) await prisma.company.delete({ where: { id: owned.companyId } }).catch((e) => console.log('  company delete:', e.message))
    const leftovers = await prisma.bookingAssignment.count({ where: { orderId: owned.orderId || 'none' } })
    console.log('  leftover assignments on the order:', leftovers)
    console.log('\n' + (fails.length === 0 ? 'ALL CHECKS PASSED' : `FAILED: ${fails.length}\n - ${fails.join('\n - ')}`))
  }
}
main().then(() => process.exit(fails.length ? 1 : 0)).catch((e) => { console.error(e); process.exit(1) })
