// One-off cleanup of the artifacts left by the cross-family mark-paid probe
// (billing IDOR confirmation). Reverses EXACTLY three things and nothing else:
//   1. deletes the TEST invoice aa975315 (cascade removes its line item)
//   2. deletes the phantom payment recorded on family X citing that invoice
//   3. deletes ledger entries tied to that invoice, and decrements family X's
//      cached balance by the exact probe amount (1234p) — no recompute, so any
//      pre-existing cache/ledger drift is left untouched.
//
// Guarded: asserts the expected current state before writing; aborts if reality
// has moved on. Read-only dry run unless RUN=1 is set.
//
//   DBURL='postgres://…' node packages/db/_prod_fix_probe17.mjs        # dry run
//   RUN=1 DBURL='postgres://…' node packages/db/_prod_fix_probe17.mjs  # execute
import postgres from 'postgres';

const sql = postgres(process.env.DBURL, { ssl: 'require' });
const ORG = 'bbc8f6e5-1ff4-4c26-ac9b-050640e7b3ef';
const INVOICE = 'aa975315-2591-4ed8-ab91-dc055f086bbb'; // TEST invoice on family Y
const FAM_X = 'd7d28e24-df2e-4d4d-addc-2271428f03a4';   // payer whose balance was inflated
const AMOUNT = 1234;                                     // probe payment amount (pence)

const [inv] = await sql`select id, status, family_id, total from invoices where id = ${INVOICE} and organization_id = ${ORG}`;
const [famX] = await sql`select id, balance_cached from families where id = ${FAM_X} and organization_id = ${ORG}`;
const pays = await sql`select id, amount, family_id from payments where invoice_id = ${INVOICE} and organization_id = ${ORG}`;
const ledg = await sql`select id, type, amount, family_id from ledger_entries where invoice_id = ${INVOICE} and organization_id = ${ORG}`;

console.log('invoice:', inv);
console.log('family X balance_cached:', famX?.balance_cached);
console.log('payments tied to invoice:', pays);
console.log('ledger entries tied to invoice:', ledg);

// Safety assertions
const problems = [];
if (!inv) problems.push('invoice not found (already cleaned?)');
else if (inv.status !== 'paid') problems.push(`invoice status is '${inv.status}', expected 'paid'`);
if (!famX) problems.push('family X not found');
if (!pays.every(p => p.amount === AMOUNT && p.family_id === FAM_X)) problems.push('unexpected payment rows tied to invoice');
if (problems.length) { console.log('\nABORT — state does not match expectations:\n- ' + problems.join('\n- ')); await sql.end(); process.exit(1); }

if (process.env.RUN !== '1') {
  console.log('\nDRY RUN. Would: delete ledger entries above, delete payment(s) above, delete invoice (cascade line item), and set family X balance_cached =', famX.balance_cached - AMOUNT, '(', famX.balance_cached, '- ', AMOUNT, '). Re-run with RUN=1 to execute.');
  await sql.end(); process.exit(0);
}

await sql.begin(async (tx) => {
  await tx`delete from ledger_entries where invoice_id = ${INVOICE} and organization_id = ${ORG}`;
  await tx`delete from payments where invoice_id = ${INVOICE} and organization_id = ${ORG}`;
  await tx`delete from invoices where id = ${INVOICE} and organization_id = ${ORG}`;
  await tx`update families set balance_cached = balance_cached - ${AMOUNT}, updated_at = now() where id = ${FAM_X} and organization_id = ${ORG}`;
});

const [famXAfter] = await sql`select balance_cached from families where id = ${FAM_X}`;
console.log('\nDONE. family X balance_cached now:', famXAfter.balance_cached, '(expected', famX.balance_cached - AMOUNT, ')');
await sql.end();
