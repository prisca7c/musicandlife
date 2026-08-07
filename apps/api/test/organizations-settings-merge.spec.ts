import { OrganizationsService } from '../src/organizations/organizations.service';

/**
 * update() used to .set({ ...data }), so a PATCH sending only a PARTIAL
 * settings object (e.g. { settings: { timezone: 'x' } }) replaced the whole
 * jsonb blob and silently wiped every other field — bank details used on
 * real invoices, invoice notes. The web settings page always spreads the
 * current settings first so this was unreachable through the app today, but
 * the DTO takes an open settings object by design; the service must merge.
 */
function makeService(existingSettings: Record<string, unknown>) {
  let setValues: Record<string, unknown> | undefined;
  const db = {
    db: {
      query: {
        organizations: {
          findFirst: async () => ({ id: 'org-1', settings: existingSettings }),
        },
      },
      update: () => ({
        set: (v: Record<string, unknown>) => {
          setValues = v;
          return { where: () => ({ returning: async () => [{ id: 'org-1', ...v }] }) };
        },
      }),
    },
  };
  return { svc: new OrganizationsService(db as never), getSetValues: () => setValues };
}

describe('OrganizationsService.update — settings merge, not replace', () => {
  it('merges a partial settings update into the existing settings', async () => {
    const { svc, getSetValues } = makeService({
      bankAccountName: 'Music & Life Ltd', bankSortCode: '12-34-56', timezone: 'Europe/London',
    });
    await svc.update('org-1', { settings: { timezone: 'Europe/Dublin' } });
    const set = getSetValues();
    const settings = set!.settings as Record<string, unknown>;
    expect(settings.timezone).toBe('Europe/Dublin');
    // Bank details survive a partial update instead of being wiped.
    expect(settings.bankAccountName).toBe('Music & Life Ltd');
    expect(settings.bankSortCode).toBe('12-34-56');
  });

  it('an update with no settings key leaves settings untouched', async () => {
    const { svc, getSetValues } = makeService({ bankAccountName: 'Music & Life Ltd' });
    await svc.update('org-1', { name: 'New Name' });
    const set = getSetValues();
    expect(set!.name).toBe('New Name');
    expect(set!.settings).toBeUndefined();
  });
});
