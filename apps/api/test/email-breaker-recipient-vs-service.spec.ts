import { SenderAdapter } from '../src/email/adapters/sender.adapter';

// The email circuit breaker opens after 3 consecutive failures. It could not
// tell a rejected *recipient* from a failing *service*, so in a bulk send —
// a broadcast to a few hundred families, where a few dead or mistyped
// addresses are a near-certainty — three bad addresses in a row opened the
// circuit and every family still queued behind them was dropped in
// milliseconds and reported as "failed". Only a 429/5xx may count toward the
// breaker; any other 4xx is that one message's problem.

const OK = { ok: true, status: 200, text: async () => '' };
const badRecipient = { ok: false, status: 400, text: async () => 'invalid recipient' };
const providerDown = { ok: false, status: 503, text: async () => 'service unavailable' };

function makeAdapter(responses: unknown[]) {
  process.env.SENDER_API_KEY = 'test-key';
  const fetchMock = jest.fn();
  for (const r of responses) fetchMock.mockResolvedValueOnce(r);
  global.fetch = fetchMock as never;
  return { adapter: new SenderAdapter(), fetchMock };
}

const send = (adapter: SenderAdapter, to: string) =>
  adapter.send({ to, subject: 'Studio news', html: '<p>hi</p>' });

describe('email breaker — rejected recipient vs failing service', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does not open the circuit after consecutive rejected recipients', async () => {
    const { adapter, fetchMock } = makeAdapter([
      badRecipient, badRecipient, badRecipient, OK,
    ]);

    for (const addr of ['bad1@x.com', 'bad2@x.com', 'bad3@x.com']) {
      await expect(send(adapter, addr)).rejects.toThrow(/invalid recipient/);
    }

    // The 4th family is real and must still be reached — before the fix this
    // rejected instantly with "Circuit breaker OPEN" without calling out.
    await expect(send(adapter, 'good@x.com')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('still opens the circuit when the provider itself is failing', async () => {
    const { adapter, fetchMock } = makeAdapter([
      providerDown, providerDown, providerDown, OK,
    ]);

    for (const addr of ['a@x.com', 'b@x.com', 'c@x.com']) {
      await expect(send(adapter, addr)).rejects.toThrow(/503/);
    }

    // Breaker is open: the 4th send must fail fast without a network call.
    await expect(send(adapter, 'd@x.com')).rejects.toThrow(/Circuit breaker OPEN/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
