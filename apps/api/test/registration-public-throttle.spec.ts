import 'reflect-metadata';
import { RegistrationController } from '../src/registration/registration.controller';

// The two public, unauthenticated registration endpoints must carry their own
// rate limit. `public/registrations` emails both the admin AND the caller-
// supplied contactEmail on every call — without a per-route limit it is a
// limited open relay (email-bomb an arbitrary address / flood the admin inbox)
// capped only by the 120/min global default. `public/families/search` is an
// email-existence + family-name oracle. Both mirror auth's throttled public
// POSTs. @Throttle({ default: { ttl, limit } }) records metadata under
// "THROTTLER:TTLdefault" / "THROTTLER:LIMITdefault" on the handler.
const TTL_KEY = 'THROTTLER:TTLdefault';
const LIMIT_KEY = 'THROTTLER:LIMITdefault';

describe('public registration endpoints are individually throttled', () => {
  it('submit is limited to 5 per minute', () => {
    const handler = RegistrationController.prototype.submit;
    expect(Reflect.getMetadata(LIMIT_KEY, handler)).toBe(5);
    expect(Reflect.getMetadata(TTL_KEY, handler)).toBe(60_000);
  });

  it('family search is limited to 10 per minute', () => {
    const handler = RegistrationController.prototype.searchFamilies;
    expect(Reflect.getMetadata(LIMIT_KEY, handler)).toBe(10);
    expect(Reflect.getMetadata(TTL_KEY, handler)).toBe(60_000);
  });
});
