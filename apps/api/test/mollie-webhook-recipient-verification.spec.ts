import { MollieService } from '../src/payments/mollie.service';

// Mollie webhooks carry only a payment id in the body — no amount, no status.
// The service must re-fetch the payment from Mollie's own API before trusting
// anything about it, so a forged POST to our webhook URL can at most trigger a
// harmless re-check of a payment that genuinely exists; it can never assert
// "this was paid" on its own say-so. These tests pin that behaviour down.

function makeService(mollieResponses: Record<string, unknown>) {
  process.env.MOLLIE_API_KEY = 'test_fake_key';
  const fetchMock = jest.fn((url: string) => {
    const path = url.replace('https://api.mollie.com/v2', '');
    const body = mollieResponses[path];
    if (!body) throw new Error(`Unexpected Mollie call: ${path}`);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });
  global.fetch = fetchMock as never;

  const recordPayment = jest.fn().mockResolvedValue({ id: 'payment-row-1' });
  const db = {
    db: {
      query: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'inv-1', familyId: 'fam-1', organizationId: 'org-1',
          }),
        },
      },
    },
  };
  const billing = { recordPayment };
  const svc = new MollieService(db as never, billing as never);
  return { svc, fetchMock, recordPayment };
}

describe('MollieService.handleWebhook — recipient verification', () => {
  afterEach(() => { jest.restoreAllMocks(); delete process.env.MOLLIE_API_KEY; });

  it('records a payment only after re-reading it as paid from Mollie', async () => {
    const { svc, fetchMock, recordPayment } = makeService({
      '/payments/tr_real123': {
        id: 'tr_real123', status: 'paid',
        amount: { value: '42.50', currency: 'GBP' },
        metadata: { invoiceId: 'inv-1' },
      },
    });

    await svc.handleWebhook('tr_real123');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.mollie.com/v2/payments/tr_real123',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test_fake_key' }) }),
    );
    expect(recordPayment).toHaveBeenCalledWith('org-1', expect.objectContaining({
      invoiceId: 'inv-1', method: 'card', amount: 4250, providerRef: 'tr_real123',
    }));
  });

  it('does not record anything for a payment that is not actually paid', async () => {
    // A forged webhook claiming "paid" in its body cannot matter — only what
    // Mollie's own API says about that id is ever trusted.
    const { svc, recordPayment } = makeService({
      '/payments/tr_open456': {
        id: 'tr_open456', status: 'open',
        amount: { value: '10.00', currency: 'GBP' },
        metadata: { invoiceId: 'inv-1' },
      },
    });

    await svc.handleWebhook('tr_open456');

    expect(recordPayment).not.toHaveBeenCalled();
  });

  it('is idempotent under Mollie retries — a replayed webhook does not double-charge', async () => {
    const { svc, recordPayment } = makeService({
      '/payments/tr_retry789': {
        id: 'tr_retry789', status: 'paid',
        amount: { value: '15.00', currency: 'GBP' },
        metadata: { invoiceId: 'inv-1' },
      },
    });

    await svc.handleWebhook('tr_retry789');
    await svc.handleWebhook('tr_retry789');

    // Both calls reach recordPayment (which de-dupes on providerRef itself —
    // see billing.service.spec for that guarantee); this test's job is only to
    // confirm the *same* providerRef is sent both times, so that guard applies.
    expect(recordPayment).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = recordPayment.mock.calls;
    expect(firstCall[1].providerRef).toBe(secondCall[1].providerRef);
  });
});
