import React from 'react'
import fs from 'fs'
import path from 'path'
import { Image, StyleSheet, Text, View } from '@react-pdf/renderer'

/**
 * Reusable Zelle "pay by" block for invoice PDFs. Drops in next to the
 * totals (right-aligned) so the client lands on a payment option the
 * moment they finish reading the amount due.
 *
 * Designed to extend cleanly: when we add ACH / Stripe / Square / etc.
 * panels later, they should be sibling components under a single
 * "Pay by" section header, not bespoke insertions in InvoiceDocument.
 *
 * Asset convention: public/payment/zelle-qr.png. Loaded via
 * fs.readFileSync at module-import time (same pattern as the SirReel
 * logo in InvoiceDocument). When the file is missing, the block falls
 * back to a text-only rendering — no broken-image artifact in the
 * generated PDF. (The text handle is the actual payment instruction
 * anyway; the QR is the convenience layer.)
 */

// ── Configuration ──────────────────────────────────────────────────

const ZELLE_QR_PATH = path.join(process.cwd(), 'public', 'payment', 'zelle-qr.png')
let ZELLE_QR_BUFFER: Buffer | null = null
try {
  ZELLE_QR_BUFFER = fs.readFileSync(ZELLE_QR_PATH)
} catch (err) {
  // Asset not present in the repo yet — the text fallback below carries
  // the actionable info. Logged once at module load so we notice in
  // Vercel logs but invoices keep generating.
  console.warn('[ZellePayBlock] failed to load public/payment/zelle-qr.png — rendering text fallback:', err instanceof Error ? err.message : err)
}

export const ZELLE_ACCOUNT_NAME = 'SIRREEL PRODUCTION VEHICLES INC'

/**
 * Plain-text Zelle tag — printed under the QR as the B&W / image-
 * stripped-email fallback. Must remain accurate even when the QR can't
 * be scanned (printed black-and-white, mail client stripped images,
 * client is squinting at a tiny preview).
 *
 * Rendered with the "Zelle® tag:" label in the component below so the
 * line reads as "Zelle® tag: sirreel" — the recipient-name line
 * (ZELLE_ACCOUNT_NAME above) is what the client confirms in their
 * banking app once they enter the tag.
 */
export const ZELLE_HANDLE = 'sirreel'
export const ZELLE_HANDLE_LABEL = 'Zelle® tag:'

// ── Styles — sized to drop next to the invoice totals block ────────

const C = {
  ink:    '#1a1a1a',
  muted:  '#5c5c5c',
  rule:   '#cccccc',
}

// QR target size: ~1.05" on the printed page. 72pt = 1 inch in PDF
// coordinate space; 76pt keeps it just above the 0.9in scan-reliability
// floor without crowding the right rail.
const QR_SIZE = 76

const styles = StyleSheet.create({
  container: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: C.rule,
    // alignSelf right-aligns within the parent column so the block
    // tracks the totals layout above it without needing a wrapper.
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
    // Width matches the totals' label-plus-value width (~246) so the
    // right edge aligns exactly with the Balance Due value above.
    width: 246,
  },
  caption: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  qr: {
    width: QR_SIZE,
    height: QR_SIZE,
    marginBottom: 4,
  },
  qrFallbackBox: {
    width: QR_SIZE,
    height: QR_SIZE,
    marginBottom: 4,
    borderWidth: 0.5,
    borderColor: C.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrFallbackText: {
    fontSize: 7,
    color: C.muted,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  accountName: {
    fontSize: 8,
    color: C.ink,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'right',
    letterSpacing: 0.2,
  },
  handle: {
    fontSize: 9,
    color: C.ink,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'right',
    marginTop: 2,
  },
  // Lighter weight on the "Zelle® tag:" prefix so the actual tag
  // (the next inline Text) reads as the dominant token in the line.
  handleLabel: {
    fontFamily: 'Helvetica',
    color: C.muted,
  },
})

// ── Component ──────────────────────────────────────────────────────

export function ZellePayBlock() {
  return (
    <View style={styles.container} wrap={false}>
      <Text style={styles.caption}>Pay by Zelle</Text>
      {ZELLE_QR_BUFFER ? (
        <Image src={ZELLE_QR_BUFFER} style={styles.qr} />
      ) : (
        <View style={styles.qrFallbackBox}>
          <Text style={styles.qrFallbackText}>QR unavailable —{'\n'}use handle below</Text>
        </View>
      )}
      <Text style={styles.accountName}>{ZELLE_ACCOUNT_NAME}</Text>
      <Text style={styles.handle}>
        <Text style={styles.handleLabel}>{ZELLE_HANDLE_LABEL} </Text>
        {ZELLE_HANDLE}
      </Text>
    </View>
  )
}
