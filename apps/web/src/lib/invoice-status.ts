// "sent" is our internal word for "issued and waiting to be paid" — meaningless to
// a parent. Show plain English everywhere an invoice status appears. A negative
// total is a credit note regardless of workflow status.

export const INVOICE_STATUS_COLORS: Record<string, string> = {
  draft: 'default', sent: 'trial', paid: 'active', void: 'withdrawn',
};

export function invoiceStatusLabel(i: { status: string; total: number }): string {
  if (i.total < 0) return 'Credit';
  return { draft: 'Draft', sent: 'Due', paid: 'Paid', void: 'Void' }[i.status] ?? i.status;
}

export function invoiceStatusColor(i: { status: string; total: number }): string {
  return i.total < 0 ? 'default' : (INVOICE_STATUS_COLORS[i.status] ?? 'default');
}
