export interface InvoicingSettings {
  billingStartDate: string | null;
  billingMode: 'prepaid' | 'postpaid';
  invoiceDateOffsetDays: number;
  dueDateOffsetDays: number;
  invoiceFormat: 'condensed' | 'normal' | 'expanded';
  includePreviousBalance: boolean;
  autoEmailInvoice: boolean;
  invoiceFooterNote: string | null;
  autoInvoice: boolean;
}

// Shared by the per-family settings modal and the families-list bulk-apply modal
export function InvoicingSettingsFields({ defaults }: { defaults: Partial<InvoicingSettings> }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="ui-label">Billing start date</label>
          <input name="billingStartDate" type="date" defaultValue={defaults.billingStartDate ?? ''} className="ui-input" />
        </div>
        <div>
          <label className="ui-label">Billing mode</label>
          <select name="billingMode" defaultValue={defaults.billingMode ?? 'postpaid'} className="ui-input">
            <option value="postpaid">Postpaid (bill after lessons)</option>
            <option value="prepaid">Prepaid (bill ahead)</option>
          </select>
        </div>
        <div>
          <label className="ui-label">Invoice date offset (days)</label>
          <input name="invoiceDateOffsetDays" type="number" defaultValue={defaults.invoiceDateOffsetDays ?? 0} className="ui-input" />
        </div>
        <div>
          <label className="ui-label">Due date offset (days)</label>
          <input name="dueDateOffsetDays" type="number" defaultValue={defaults.dueDateOffsetDays ?? 7} className="ui-input" />
        </div>
        <div>
          <label className="ui-label">Invoice format</label>
          <select name="invoiceFormat" defaultValue={defaults.invoiceFormat ?? 'normal'} className="ui-input">
            <option value="condensed">Condensed</option>
            <option value="normal">Normal</option>
            <option value="expanded">Expanded</option>
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input name="autoInvoice" type="checkbox" defaultChecked={defaults.autoInvoice ?? false} />
        Auto-generate invoices on schedule
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="includePreviousBalance" type="checkbox" defaultChecked={defaults.includePreviousBalance ?? true} />
        Include previous balance on invoice
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="autoEmailInvoice" type="checkbox" defaultChecked={defaults.autoEmailInvoice ?? false} />
        Auto-email invoice to family when generated
      </label>
      <div>
        <label className="ui-label">Invoice footer note</label>
        <textarea name="invoiceFooterNote" rows={2} defaultValue={defaults.invoiceFooterNote ?? ''} className="ui-input" style={{ resize: 'vertical' }} />
      </div>
    </>
  );
}

export function readInvoicingSettingsForm(f: FormData) {
  return {
    billingStartDate: (f.get('billingStartDate') as string) || undefined,
    billingMode: f.get('billingMode') as 'prepaid' | 'postpaid',
    invoiceDateOffsetDays: parseInt(f.get('invoiceDateOffsetDays') as string) || 0,
    dueDateOffsetDays: parseInt(f.get('dueDateOffsetDays') as string) || 0,
    invoiceFormat: f.get('invoiceFormat') as 'condensed' | 'normal' | 'expanded',
    includePreviousBalance: f.get('includePreviousBalance') === 'on',
    autoEmailInvoice: f.get('autoEmailInvoice') === 'on',
    invoiceFooterNote: (f.get('invoiceFooterNote') as string) || undefined,
    autoInvoice: f.get('autoInvoice') === 'on',
  };
}
