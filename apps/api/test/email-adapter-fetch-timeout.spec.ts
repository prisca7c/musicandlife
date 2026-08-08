import { SenderAdapter } from '../src/email/adapters/sender.adapter';

/**
 * The email adapter's fetch() had no timeout. A provider that accepts the
 * TCP connection but never responds (distinct from a fast 429/5xx) hung the
 * fetch — and since send() awaits recipients sequentially, one hung request
 * stalled every remaining recipient in a broadcast indefinitely, with the
 * circuit breaker never even seeing a failure to count. Every outbound fetch
 * must carry an abort signal so a hang fails fast and counts as a service
 * failure (like a 503), not silently blocking forever.
 */
describe('email adapter — fetch calls carry a timeout signal', () => {
  afterEach(() => jest.restoreAllMocks());

  it('SenderAdapter.send passes an AbortSignal to fetch', async () => {
    process.env.SENDER_API_KEY = 'test-key';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    global.fetch = fetchMock as never;

    const adapter = new SenderAdapter();
    await adapter.send({ to: 'a@x.com', subject: 'hi', html: '<p>hi</p>' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('a hung/aborted request is treated as a service failure, not silently swallowed', async () => {
    process.env.SENDER_API_KEY = 'test-key';
    const abortError = new DOMException('The operation was aborted.', 'TimeoutError');
    const fetchMock = jest.fn().mockRejectedValue(abortError);
    global.fetch = fetchMock as never;

    const adapter = new SenderAdapter();
    await expect(adapter.send({ to: 'a@x.com', subject: 'hi', html: '<p>hi</p>' })).rejects.toThrow();
  });
});
