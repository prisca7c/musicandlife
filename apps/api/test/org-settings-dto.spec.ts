import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateOrgDto } from '../src/organizations/dto/update-org.dto';

/**
 * The studio-settings blob is a jsonb column: PATCH /organizations/me must
 * receive `settings` as an OBJECT. The web settings page once sent it as a JSON
 * string (`settings: JSON.stringify({...})`), which — once #48 added @IsObject —
 * failed validation with a 400 that the page swallowed, so every studio-details
 * / invoice-defaults (address, bank account, accounting mode) save silently did
 * nothing. This pins the contract the web must honour.
 */
describe('UpdateOrgDto — settings must be an object', () => {
  it('accepts settings as an object', () => {
    const dto = plainToInstance(UpdateOrgDto, {
      name: 'Studio',
      settings: { address: 'High St', bankAccountNumber: '1234', accountingMode: 'cash' },
    });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects settings sent as a JSON string (the old web bug)', () => {
    const dto = plainToInstance(UpdateOrgDto, {
      name: 'Studio',
      settings: JSON.stringify({ address: 'High St' }),
    });
    const errors = validateSync(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toHaveProperty('isObject');
  });
});
