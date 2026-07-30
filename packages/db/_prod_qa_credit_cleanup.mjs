// One-off cleanup of the £9.9M phantom credit on the QA Test Family (TEST)
// left behind by attendance/payment probing (prod-readiness item #15).
//
// The inflation is dominated by bogus "cash payment" rows recorded during
// probing (e.g. +£9,999,999.99 payment 59712503). No real studio payment is
// anywhere near this size, so this script reverses EXACTLY the oversized
// phantom payments and nothing else:
//   1. finds payments on the QA family with amount >= THRESHOLD (£100,000)
//   2. finds the matching type='payment' ledger entries (same amounts)
//   3. deletes both sets and decrements balance_cached by the exact sum
// It does NOT recompute the whole balance, touch invoices, lesson charges,
// enrollments, lessons, or any of the seeded QA scenario data.
//
// Heavily guarded: verifies the family is a TEST family and that the phantom
// payments and their ledger entries line up (equal count + equal summed
// amount) before writing; aborts if reality has moved on. Read-only dry run
// unless RUN=1 is set.
//
//   DBURL='postgres://…' node packages/db/_prod_qa_credit_cleanup.mjs        # dry run
//   RUN=1 DBURL='postgres://…' node packages/db/_prod_qa_credit_cleanup.mjs  # execute
import postgres from 'postgres';

const sql = postgres(process.env.DBURL, { ssl: 'require' });
const ORG = 'bbc8f6e5-1ff4-4c26-ac9b-050640e7b3ef';
const FAM = 'd7d28e24-df2e-4d4d-addc-2271428f03a4'; // QA Test Family (TEST)
const THRESHOLD = 100_000 * 100;                     // £100,000 in pence — well above any real payment

const [fam] = await sql`
  select f.id, f.balance_cached, s.name as org_name,
         (select string_agg(distinct st.first_name || ' ' || st.last_name, ', ')
            from students st where st.family_id = f.id) as students
  from families f join organizations s on s.id = f.organization_id
  where f.id = ${FAM} and f.organization_id = ${ORG}`;

if (!fam) { console.log('ABORT — QA family not found (wrong DB or already gone).'); await sql.end(); process.exit(1); }

console.log('family:', FAM);
console.log('  org:', fam.org_name);
console.log('  students:', fam.students);
console.log('  balance_cached:', fam.balance_cached, `(£${(fam.balance_cached / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 })})`);

// SAFETY: only ever operate on the labelled TEST family.
if (!/TEST/i.test(fam.students ?? '')) {
  console.log('\nABORT — family students do not contain "TEST"; refusing to touch a possibly-real family.');
  await sql.end(); process.exit(1);
}

const phantomPayments = await sql`
  select id, amount, method, created_at from payments
  where family_id = ${FAM} and organization_id = ${ORG} and amount >= ${THRESHOLD}
  order by amount desc`;
const phantomLedger = await sql`
  select id, amount, type, description, occurred_at from ledger_entries
  where family_id = ${FAM} and organization_id = ${ORG} and type = 'payment' and amount >= ${THRESHOLD}
  order by amount desc`;

console.log('\nphantom payments (amount >= £100,000):');
for (const p of phantomPayments) console.log(`  ${p.id}  ${p.amount}  ${p.method}  ${p.created_at.toISOString()}`);
console.log('phantom ledger entries (type=payment, amount >= £100,000):');
for (const l of phantomLedger) console.log(`  ${l.id}  ${l.amount}  ${l.description ?? ''}  ${l.occurred_at.toISOString()}`);

const paySum = phantomPayments.reduce((s, p) => s + p.amount, 0);
const ledgerSum = phantomLedger.reduce((s, l) => s + l.amount, 0);

const problems = [];
if (phantomPayments.length === 0) problems.push('no oversized phantom payments found — nothing to clean (already done?)');
if (phantomPayments.length !== phantomLedger.length) problems.push(`payment rows (${phantomPayments.length}) != ledger rows (${phantomLedger.length}) — mismatch, refusing to guess`);
if (paySum !== ledgerSum) problems.push(`payment sum (${paySum}) != ledger sum (${ledgerSum}) — mismatch, refusing to guess`);
if (problems.length) { console.log('\nABORT — state does not match expectations:\n- ' + problems.join('\n- ')); await sql.end(); process.exit(1); }

const newBalance = fam.balance_cached - paySum;
if (process.env.RUN !== '1') {
  console.log(`\nDRY RUN. Would delete ${phantomPayments.length} payment(s) + ${phantomLedger.length} ledger entry(ies), and set balance_cached ${fam.balance_cached} -> ${newBalance} (£${(newBalance / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 })}). Re-run with RUN=1 to execute.`);
  await sql.end(); process.exit(0);
}

const payIds = phantomPayments.map(p => p.id);
const ledgerIds = phantomLedger.map(l => l.id);
await sql.begin(async (tx) => {
  await tx`delete from ledger_entries where id = any(${ledgerIds}) and organization_id = ${ORG}`;
  await tx`delete from payments where id = any(${payIds}) and organization_id = ${ORG}`;
  await tx`update families set balance_cached = ${newBalance}, updated_at = now() where id = ${FAM} and organization_id = ${ORG}`;
});

const [after] = await sql`select balance_cached from families where id = ${FAM}`;
console.log('\nDONE. balance_cached now:', after.balance_cached, `(expected ${newBalance}) — £${(after.balance_cached / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`);
await sql.end();
