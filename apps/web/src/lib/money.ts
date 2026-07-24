// One place that turns integer pence into money a human reads. Historically every
// screen wrote `£${(x/100).toFixed(2)}` inline, which gave no thousands separators
// (£9999789.66) and put the minus in the wrong place for credits (£-4.00). Route
// all money through here so it is grouped and signed consistently.

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

/** Pence → GBP, grouped. 1234567 → "£12,345.67"; -400 → "-£4.00". */
export function formatMoney(pence: number): string {
  return gbp.format((Number(pence) || 0) / 100);
}

/**
 * A running account balance, where the sign carries meaning. Credit is shown with
 * an explicit "+" so a parent can tell it apart from money owed; owed amounts keep
 * the locale minus ("-£4.00"). Zero is a plain "£0.00".
 */
export function formatBalance(pence: number): string {
  const p = Number(pence) || 0;
  return p > 0 ? `+${formatMoney(p)}` : formatMoney(p);
}
