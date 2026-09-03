/**
 * Deposit-invoice tests.
 *
 *   npm run test:deposits
 *
 * Pure + offline: exercises the arithmetic and the type-guard reasoning
 * WITHOUT touching the database. The live DB is the production DB (see
 * CLAUDE.md), and a test that writes invoices and payments to it to prove
 * deposit maths is exactly the kind of fixture that leaves real AR rows
 * behind.
 *
 * What matters most here is the double-billing direction. A deposit that
 * fails to credit bills the client twice for the same money; the client
 * catches that and it costs trust. A credit applied twice under-bills, and
 * nobody catches it at all.
 */

import { depositCreditLine } from '../../src/lib/invoices/deposits'

const failures: string[] = []
const check = (c: boolean, why: string) => {
  console.log(c ? `  ok — ${why}` : `  FAIL — ${why}`)
  if (!c) failures.push(why)
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

// The production arithmetic, mirrored: invoiceTotal = booked + damages − deposits.
const finalTotal = (booked: number, damages: number, deposits: number) =>
  round2(booked + damages - deposits)

console.log('\n1. The credit line')
check(depositCreditLine(0) === null, 'no line when nothing was collected')
check(depositCreditLine(0.004) === null, 'no line for sub-cent noise')
const line = depositCreditLine(2145)!
check(line !== null, 'a line once real money was taken')
check(line.amount === -2145, 'the amount is NEGATIVE — it subtracts in the charges column')
check(line.kind === 'DEPOSIT_CREDIT', 'tagged DEPOSIT_CREDIT, distinct from a DISCOUNT')
check(/deposit/i.test(line.description), 'the client can see what it is')

console.log('\n2. A deposit is billed once, not twice')
// The whole point: deposit invoice $2,145 + final $2,145 = the $4,290 job.
const booked = 4290
const deposit = 2145
const final = finalTotal(booked, 0, deposit)
check(final === 2145, 'final invoice bills the remainder ($2,145 of a $4,290 job)')
check(round2(deposit + final) === booked, 'deposit + final === the job total, no double count')

console.log('\n3. Paid in full upfront')
const paidUpfront = finalTotal(booked, 0, booked)
check(paidUpfront === 0, 'a fully-prepaid job leaves a $0 final invoice, not a second bill')

console.log('\n4. Damage after a deposit still bills')
const withDamage = finalTotal(booked, 500, booked)
check(withDamage === 500, 'prepaid job + $500 damage bills exactly the damage')

console.log('\n5. Overpayment surfaces as a negative total, and is not swallowed')
// The shoot drops a day after a 100% prepayment: booked falls to $3,000.
const shrunk = finalTotal(3000, 0, 4290)
check(shrunk === -1290, 'final total goes NEGATIVE when the job shrank below the deposit')
check(shrunk < 0, 'negative is the signal the desk flags on — never clamped to zero')

console.log('\n6. Cent-level integrity')
check(finalTotal(1000.1, 0, 333.37) === 666.73, 'no floating-point drift on awkward cents')
check(finalTotal(0.1 + 0.2, 0, 0) === 0.3, '0.1 + 0.2 rounds to 0.30, not 0.30000000000000004')

console.log('\n7. Tax is NOT recomputed on the reduced figure')
// Subtotal and tax stay anchored to the booked snapshot; only the bottom
// line moves. Netting the deposit out of the SUBTOTAL would shrink the
// taxable base and under-collect sales tax — the error nobody notices until
// a filing.
const subtotal = 4000
const taxRate = 0.0725
const tax = round2(subtotal * taxRate)
const grossTotal = round2(subtotal + tax)
const netOfDeposit = finalTotal(grossTotal, 0, 2000)
check(tax === 290, 'tax computed on the full $4,000 subtotal')
check(netOfDeposit === 2290, 'deposit comes off the GROSS ($4,290 − $2,000), tax untouched')
check(round2(netOfDeposit + 2000) === grossTotal, 'the two documents still sum to the gross')

console.log(
  failures.length === 0
    ? `\n✓ all deposit checks passed\n`
    : `\n✗ ${failures.length} FAILED:\n${failures.map((f) => `  - ${f}`).join('\n')}\n`,
)
process.exit(failures.length === 0 ? 0 : 1)
