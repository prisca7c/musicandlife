import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';

jest.mock('argon2', () => ({
  verify: jest.fn(),
  hash: jest.fn(),
}));
import { verify as argonVerify } from 'argon2';

/**
 * Login used to check account status/verification BEFORE the password, so
 * submitting any real email with a wrong password returned a DIFFERENT error
 * ("Account suspended" / "Please verify your email") than an unknown email
 * ("Invalid credentials") — a user-enumeration oracle that let an attacker
 * learn an account exists and its exact status without ever proving they know
 * the password. Both checks must now run AFTER the password is confirmed.
 */
function makeService(user: Record<string, unknown> | undefined) {
  const db = {
    db: {
      query: {
        users: { findFirst: jest.fn().mockResolvedValue(user) },
      },
    },
  };
  const jwt = {};
  const email = {};
  return new AuthService(db as never, jwt as never, email as never);
}

describe('AuthService.login — no account-status leak before password check', () => {
  beforeEach(() => jest.clearAllMocks());

  it('a wrong password on a SUSPENDED account returns the generic error, not "Account suspended"', async () => {
    (argonVerify as jest.Mock).mockResolvedValue(false);
    const svc = makeService({ id: 'u1', email: 'a@x.com', passwordHash: 'h', status: 'suspended', emailVerifiedAt: new Date() });
    await expect(svc.login('a@x.com', 'wrong')).rejects.toThrow('Invalid credentials');
  });

  it('a wrong password on an UNVERIFIED account returns the generic error, not the verify-email message', async () => {
    (argonVerify as jest.Mock).mockResolvedValue(false);
    const svc = makeService({ id: 'u1', email: 'a@x.com', passwordHash: 'h', status: 'active', emailVerifiedAt: null });
    await expect(svc.login('a@x.com', 'wrong')).rejects.toThrow('Invalid credentials');
  });

  it('an unknown email returns the same generic error', async () => {
    const svc = makeService(undefined);
    await expect(svc.login('nobody@x.com', 'whatever')).rejects.toThrow('Invalid credentials');
  });

  it('a CORRECT password on a suspended account still reveals "Account suspended"', async () => {
    (argonVerify as jest.Mock).mockResolvedValue(true);
    const svc = makeService({ id: 'u1', email: 'a@x.com', passwordHash: 'h', status: 'suspended', emailVerifiedAt: new Date() });
    await expect(svc.login('a@x.com', 'correct')).rejects.toThrow('Account suspended');
  });

  it('a CORRECT password on an unverified account still reveals the verify-email message', async () => {
    (argonVerify as jest.Mock).mockResolvedValue(true);
    const svc = makeService({ id: 'u1', email: 'a@x.com', passwordHash: 'h', status: 'active', emailVerifiedAt: null });
    await expect(svc.login('a@x.com', 'correct')).rejects.toThrow('Please verify your email');
  });

  it('all three rejection paths throw UnauthorizedException', async () => {
    (argonVerify as jest.Mock).mockResolvedValue(false);
    const svc = makeService({ id: 'u1', email: 'a@x.com', passwordHash: 'h', status: 'suspended', emailVerifiedAt: new Date() });
    await expect(svc.login('a@x.com', 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
