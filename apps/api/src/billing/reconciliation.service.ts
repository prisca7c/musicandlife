import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { eq, and, isNull, isNotNull, desc, inArray } from 'drizzle-orm';
import { createHash } from 'crypto';
import { invoices, paymentClaims, bankTransactions, payments } from '@music-life/db';
import { DbService } from '../db/db.service';
import { BillingService } from './billing.service';

// Bank references get mangled in transit: banks strip punctuation, collapse
// spaces, change case and truncate. Compare on letters+digits only so
// "ML-4F2A", "ml 4f2a" and "REF ML4F2A NAKAMURA" all still find the family.
function normalise(s: string | null | undefined): string {
  return (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface ParsedStatementRow {
  bookedOn: string;
  amount: number;       // pence, positive = money in
  reference?: string;
  description?: string;
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly db: DbService,
    private readonly billing: BillingService,
  ) {}

  // ─── Claims ────────────────────────────────────────────────────────────────

  /**
   * A family says they've sent a transfer. This is a CLAIM, not money: the
   * ledger does not move and the invoice stays unpaid until a real statement
   * line backs it up (or staff confirm it by hand).
   *
   * The reference a family is told to quote is simply that invoice's own
   * number — it changes every invoice, so there's no separate per-family code
   * to keep straight, and matching an incoming transfer means finding which
   * invoice number appears in its reference/description, not guessing by
   * amount. A claim therefore always belongs to one specific invoice.
   */
  async createClaim(orgId: string, familyId: string, invoiceId: string, amount: number) {
    // Defence in depth behind the caller's own check. A claim for £0 or a
    // negative amount would sit in the exceptions queue forever — no bank line
    // can ever match it — and a negative claim would try to match a debit,
    // which the importer deliberately skips.
    if (amount <= 0) {
      throw new BadRequestException('A payment claim must be for a positive amount.');
    }
    const invoice = await this.db.db.query.invoices.findFirst({
      where: and(eq(invoices.id, invoiceId), eq(invoices.organizationId, orgId), eq(invoices.familyId, familyId)),
      columns: { number: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const open = await this.db.db.query.paymentClaims.findFirst({
      where: and(
        eq(paymentClaims.organizationId, orgId),
        eq(paymentClaims.invoiceId, invoiceId),
        eq(paymentClaims.status, 'pending'),
      ),
    });
    // Repeat taps are idempotent — the partial unique index enforces this too.
    if (open) return { ...open, alreadyClaimed: true };

    const [claim] = await this.db.db.insert(paymentClaims).values({
      organizationId: orgId, familyId, invoiceId, amount, reference: invoice.number, status: 'pending',
    }).returning();

    // A claim may arrive after the money did (parent forgot to press the button
    // until later). Try the already-imported statement lines straight away.
    await this.tryMatchClaimAgainstImported(orgId, claim!.id);

    const settled = await this.db.db.query.paymentClaims.findFirst({ where: eq(paymentClaims.id, claim!.id) });
    return { ...settled!, alreadyClaimed: false };
  }

  async listClaims(orgId: string, status?: 'pending' | 'confirmed' | 'rejected') {
    return this.db.db.query.paymentClaims.findMany({
      where: status
        ? and(eq(paymentClaims.organizationId, orgId), eq(paymentClaims.status, status))
        : eq(paymentClaims.organizationId, orgId),
      with: {
        family: { columns: { id: true, name: true, contactName: true } },
        invoice: { columns: { id: true, number: true, total: true, status: true } },
      },
      orderBy: [desc(paymentClaims.createdAt)],
      limit: 200,
    });
  }

  /** Staff override: confirm a claim with no matching statement line. */
  async confirmClaim(orgId: string, claimId: string, userId: string) {
    const claim = await this.db.db.query.paymentClaims.findFirst({
      where: and(eq(paymentClaims.id, claimId), eq(paymentClaims.organizationId, orgId)),
    });
    if (!claim) throw new NotFoundException('Claim not found');
    if (claim.status !== 'pending') throw new BadRequestException('This claim has already been decided');

    // The money may have already landed and been auto-credited (an imported
    // statement line for this invoice that no claim is tied to yet). If
    // so, settle the claim against THAT existing payment — recording a fresh
    // one here would credit the same transfer twice. Only fall through to a
    // genuine staff override (new payment) when nothing is already banked.
    const banked = claim.invoiceId
      ? await this.findUnclaimedBankPayment(orgId, claim.familyId, claim.invoiceId, claim.amount)
      : null;
    if (banked) {
      await this.linkClaimToBankedPayment(claim, banked, userId);
      return { status: 'confirmed', paymentId: banked.paymentId };
    }

    const payment = await this.settleClaim(orgId, claim, {
      notes: 'Confirmed by staff without a matching statement line.',
      manual: true,
      confirmedBy: userId,
    });
    return { status: 'confirmed', paymentId: payment.id };
  }

  /**
   * An imported statement line for this family that already has a payment but
   * isn't yet tied to a claim — this is the money a later claim should settle
   * against rather than paying again. Narrowed to the SAME invoice the claim
   * is for (not just a matching amount), since two invoices for the same
   * family can share a total; matching by amount alone could link a claim to
   * a payment that actually settled a different invoice.
   */
  private async findUnclaimedBankPayment(orgId: string, familyId: string, invoiceId: string, amount: number) {
    const candidates = await this.db.db.query.bankTransactions.findMany({
      where: and(
        eq(bankTransactions.organizationId, orgId),
        eq(bankTransactions.matchedFamilyId, familyId),
        eq(bankTransactions.amount, amount),
        eq(bankTransactions.status, 'matched'),
        isNull(bankTransactions.matchedClaimId),
        isNotNull(bankTransactions.paymentId),
      ),
      orderBy: [desc(bankTransactions.bookedOn)],
    });
    if (candidates.length === 0) return null;

    const paymentIds = candidates.map((t) => t.paymentId!).filter(Boolean);
    const matchingPayments = await this.db.db.query.payments.findMany({
      where: and(inArray(payments.id, paymentIds), eq(payments.invoiceId, invoiceId)),
      columns: { id: true },
    });
    const matchingPaymentIds = new Set(matchingPayments.map((p) => p.id));
    return candidates.find((t) => t.paymentId && matchingPaymentIds.has(t.paymentId)) ?? null;
  }

  /**
   * Settle a claim against a bank line whose money is already banked: point the
   * claim at the existing payment and stamp the claim onto the line so a second
   * claim can't attach to the same transfer. No new payment — the ledger already
   * moved when the line was imported.
   */
  private async linkClaimToBankedPayment(
    claim: typeof paymentClaims.$inferSelect,
    txn: typeof bankTransactions.$inferSelect,
    confirmedBy?: string,
  ) {
    await this.db.db.update(bankTransactions).set({
      matchedClaimId: claim.id, updatedAt: new Date(),
    }).where(eq(bankTransactions.id, txn.id));

    await this.db.db.update(paymentClaims).set({
      status: 'confirmed',
      paymentId: txn.paymentId,
      matchedTransactionId: txn.id,
      confirmedBy: confirmedBy ?? null,
      confirmedAt: new Date(),
      resolvedManually: false,
      notes: `Matched to bank statement line of ${txn.bookedOn}, already credited on import.`,
      updatedAt: new Date(),
    }).where(eq(paymentClaims.id, claim.id));
  }

  async rejectClaim(orgId: string, claimId: string, userId: string, reason?: string) {
    const claim = await this.db.db.query.paymentClaims.findFirst({
      where: and(eq(paymentClaims.id, claimId), eq(paymentClaims.organizationId, orgId)),
    });
    if (!claim) throw new NotFoundException('Claim not found');
    if (claim.status !== 'pending') throw new BadRequestException('This claim has already been decided');

    const [updated] = await this.db.db.update(paymentClaims).set({
      status: 'rejected', confirmedBy: userId, confirmedAt: new Date(),
      resolvedManually: true, notes: reason ?? 'No matching payment found.', updatedAt: new Date(),
    }).where(eq(paymentClaims.id, claimId)).returning();
    return updated!;
  }

  /** Turn a claim into real money. Idempotent via the payment key. */
  private async settleClaim(
    orgId: string,
    claim: typeof paymentClaims.$inferSelect,
    opts: { notes: string; manual: boolean; confirmedBy?: string; transactionId?: string },
  ) {
    const payment = await this.billing.recordPayment(orgId, {
      familyId: claim.familyId,
      invoiceId: claim.invoiceId ?? undefined,
      method: 'bank_transfer',
      amount: claim.amount,
      notes: opts.notes,
      idempotencyKey: `claim-${claim.id}`,
    });

    await this.db.db.update(paymentClaims).set({
      status: 'confirmed',
      paymentId: payment.id,
      matchedTransactionId: opts.transactionId ?? null,
      confirmedBy: opts.confirmedBy ?? null,
      confirmedAt: new Date(),
      resolvedManually: opts.manual,
      updatedAt: new Date(),
    }).where(eq(paymentClaims.id, claim.id));

    return payment;
  }

  // ─── Statement import ──────────────────────────────────────────────────────

  /**
   * Parse a bank CSV. Deliberately forgiving about column names — every UK bank
   * exports a different header row, and the alternative is asking the studio to
   * reformat a spreadsheet every month.
   *
   * Only money IN is imported; debits are skipped.
   */
  parseCsv(csv: string): { rows: ParsedStatementRow[]; skipped: number; headers: string[] } {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new BadRequestException('That file has no data rows.');

    const headers = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
    const find = (...names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)));

    const iDate = find('date', 'booked');
    const iRef = find('reference', 'ref');
    const iDesc = find('description', 'details', 'narrative', 'payee', 'counterparty', 'memo');
    // Banks use either one signed Amount column, or separate In/Out columns.
    const iIn = find('paid in', 'money in', 'credit', 'received');
    // "value" catches NatWest/RBS, whose amount column is literally "Value" — but
    // it must NOT swallow a "Value Date" column. Without the date guard that
    // column wins (it sorts before "Amount"), and every row's amount becomes its
    // date parsed as a number: "01/07/2026" → 1072026 → £1,072,026 credited on
    // account to any family whose reference matches. Exclude any date column.
    const iAmount = headers.findIndex(
      (h) => (h.includes('amount') || h.includes('value')) && !h.includes('date'),
    );

    if (iDate === -1 || (iIn === -1 && iAmount === -1)) {
      throw new BadRequestException(
        `Could not find a date and an amount column. Found: ${headers.join(', ')}`,
      );
    }

    const rows: ParsedStatementRow[] = [];
    let skipped = 0;

    for (const line of lines.slice(1)) {
      const cells = splitCsvLine(line);
      const rawAmount = iIn !== -1 ? cells[iIn] : cells[iAmount];
      const amount = parseMoney(rawAmount);
      // Debits and zero rows are not incoming payments.
      if (amount === null || amount <= 0) { skipped++; continue; }

      const bookedOn = parseDate(cells[iDate]);
      if (!bookedOn) { skipped++; continue; }

      rows.push({
        bookedOn,
        amount,
        reference: iRef !== -1 ? cells[iRef]?.trim() : undefined,
        description: iDesc !== -1 ? cells[iDesc]?.trim() : undefined,
      });
    }

    return { rows, skipped, headers };
  }

  /**
   * Import statement rows and match them automatically.
   *
   * At any real volume nobody can eyeball hundreds of lines, so the importer
   * settles everything it can identify and only surfaces what it genuinely
   * cannot. Matching is entirely by invoice number now — a family is told to
   * quote the invoice's own number (it changes every invoice), so finding
   * that number in the reference/description IS finding the invoice, with no
   * need to also guess by amount:
   *
   *   1. invoice number found → a pending claim for that invoice … confirm it
   *   2. invoice number found, no claim                          … pay that
   *      invoice directly, whatever the amount (covers partial payments too)
   *   3. no invoice number recognised                            … the only
   *      thing a human has to look at
   */
  async importStatement(orgId: string, rows: ParsedStatementRow[]) {
    // Only invoices still awaiting payment are worth matching against — an
    // already-paid or void invoice's number showing up again is far more
    // likely a mistyped/reused reference than a genuine second bill.
    const openInvoices = await this.db.db.query.invoices.findMany({
      where: and(eq(invoices.organizationId, orgId), eq(invoices.status, 'sent')),
      columns: { id: true, number: true, familyId: true },
    });
    // Longest number first: a short one must never shadow a longer one that
    // happens to contain it.
    const refIndex = openInvoices
      .map((inv) => ({ invoice: inv, key: normalise(inv.number) }))
      .sort((a, b) => b.key.length - a.key.length);

    const summary = {
      imported: 0, duplicates: 0,
      matchedToClaim: 0, matchedToInvoice: 0, unmatched: 0,
      unmatchedRows: [] as { bookedOn: string; amount: number; reference?: string; description?: string }[],
    };

    for (const row of rows) {
      const fingerprint = createHash('sha256')
        .update([row.bookedOn, row.amount, normalise(row.reference), normalise(row.description)].join('|'))
        .digest('hex');

      const seen = await this.db.db.query.bankTransactions.findFirst({
        where: and(eq(bankTransactions.organizationId, orgId), eq(bankTransactions.fingerprint, fingerprint)),
        columns: { id: true },
      });
      // Overlapping monthly exports are normal — never credit the same line twice.
      if (seen) { summary.duplicates++; continue; }

      const haystack = normalise(`${row.reference ?? ''} ${row.description ?? ''}`);
      const hit = refIndex.find((r) => r.key.length >= 4 && haystack.includes(r.key));

      const [txn] = await this.db.db.insert(bankTransactions).values({
        organizationId: orgId,
        bookedOn: row.bookedOn,
        amount: row.amount,
        reference: row.reference ?? null,
        description: row.description ?? null,
        fingerprint,
        matchedFamilyId: hit?.invoice.familyId ?? null,
        status: 'unmatched',
      }).returning();
      summary.imported++;

      if (!hit) {
        summary.unmatched++;
        summary.unmatchedRows.push(row);
        continue;
      }

      const { familyId, id: invoiceId } = hit.invoice;

      // 1 — a claim already raised for this specific invoice
      const claim = await this.db.db.query.paymentClaims.findFirst({
        where: and(
          eq(paymentClaims.organizationId, orgId),
          eq(paymentClaims.invoiceId, invoiceId),
          eq(paymentClaims.status, 'pending'),
        ),
        orderBy: [desc(paymentClaims.createdAt)],
      });
      if (claim) {
        const payment = await this.settleClaim(orgId, claim, {
          notes: `Matched to bank statement line of ${row.bookedOn}.`,
          manual: false,
          transactionId: txn!.id,
        });
        await this.markTxnMatched(txn!.id, claim.id, payment.id);
        summary.matchedToClaim++;
        continue;
      }

      // 2 — no claim yet, but the invoice number tells us exactly what this is
      const payment = await this.billing.recordPayment(orgId, {
        familyId, invoiceId, method: 'bank_transfer', amount: row.amount,
        notes: `Auto-matched from bank statement (${row.bookedOn}).`,
        idempotencyKey: `bank-${txn!.id}`,
      });
      await this.markTxnMatched(txn!.id, null, payment.id);
      summary.matchedToInvoice++;
    }

    return summary;
  }

  private async markTxnMatched(txnId: string, claimId: string | null, paymentId: string) {
    await this.db.db.update(bankTransactions).set({
      status: 'matched', matchedClaimId: claimId, paymentId, updatedAt: new Date(),
    }).where(eq(bankTransactions.id, txnId));
  }

  /**
   * A claim raised after the money already landed still needs to settle.
   *
   * When a transfer arrives before the family taps "I've paid", the importer has
   * no claim to match, so it credits the family on account and marks the line
   * `matched` (never `unmatched` — a `matched_family_id` is only ever set on a
   * line that then gets settled). The old lookup here required an `unmatched`
   * line WITH a family, a combination the importer never produces, so this never
   * fired: the claim sat `pending` forever and a staffer confirming it recorded a
   * SECOND payment for money already banked. Point the claim at the existing
   * payment instead — no new money moves.
   */
  private async tryMatchClaimAgainstImported(orgId: string, claimId: string) {
    const claim = await this.db.db.query.paymentClaims.findFirst({ where: eq(paymentClaims.id, claimId) });
    if (!claim || claim.status !== 'pending' || !claim.invoiceId) return;

    const txn = await this.findUnclaimedBankPayment(orgId, claim.familyId, claim.invoiceId, claim.amount);
    if (!txn) return;

    await this.linkClaimToBankedPayment(claim, txn);
  }

  /** The exceptions queue — the only thing staff routinely need to look at. */
  async listUnmatchedTransactions(orgId: string) {
    return this.db.db.query.bankTransactions.findMany({
      where: and(eq(bankTransactions.organizationId, orgId), eq(bankTransactions.status, 'unmatched')),
      orderBy: [desc(bankTransactions.bookedOn)],
      limit: 200,
    });
  }

  /** Staff assign an unidentifiable line to a family by hand. */
  async assignTransaction(orgId: string, txnId: string, familyId: string) {
    const txn = await this.db.db.query.bankTransactions.findFirst({
      where: and(eq(bankTransactions.id, txnId), eq(bankTransactions.organizationId, orgId)),
    });
    if (!txn) throw new NotFoundException('Transaction not found');
    if (txn.status === 'matched') throw new BadRequestException('That line is already matched');

    const payment = await this.billing.recordPayment(orgId, {
      familyId, method: 'bank_transfer', amount: txn.amount,
      notes: `Assigned by staff from bank statement (${txn.bookedOn}).`,
      idempotencyKey: `bank-${txn.id}`,
    });
    await this.db.db.update(bankTransactions).set({
      status: 'matched', matchedFamilyId: familyId, paymentId: payment.id, updatedAt: new Date(),
    }).where(eq(bankTransactions.id, txn.id));
    return { status: 'matched', paymentId: payment.id };
  }

  async ignoreTransaction(orgId: string, txnId: string) {
    const [updated] = await this.db.db.update(bankTransactions)
      .set({ status: 'ignored', updatedAt: new Date() })
      .where(and(eq(bankTransactions.id, txnId), eq(bankTransactions.organizationId, orgId)))
      .returning();
    if (!updated) throw new NotFoundException('Transaction not found');
    return updated;
  }
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

/** Minimal RFC-4180 splitter: handles quoted cells containing commas. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** "1,234.56", "£45.00", "(12.00)" → pence. Returns null if not a number. */
export function parseMoney(raw: string | undefined): number | null {
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw.trim()) || raw.includes('-');
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) * (negative ? -1 : 1);
}

/** Accepts dd/mm/yyyy (UK banks) and yyyy-mm-dd. Returns yyyy-mm-dd. */
export function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const uk = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (uk) {
    const year = uk[3]!.length === 2 ? `20${uk[3]}` : uk[3]!;
    return `${year}-${uk[2]!.padStart(2, '0')}-${uk[1]!.padStart(2, '0')}`;
  }
  return null;
}
