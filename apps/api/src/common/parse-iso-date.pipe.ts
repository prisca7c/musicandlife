import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

// Validates an optional `YYYY-MM-DD` query param. Report endpoints pass `from`/
// `to` straight into date arithmetic, so an unparseable value (e.g. "not-a-date"
// or "2026-13-99") previously produced an Invalid Date and an unhandled 500.
// Absent values pass through untouched so the controller's default still applies.
@Injectable()
export class ParseIsoDatePipe implements PipeTransform<string | undefined, string | undefined> {
  transform(value: string | undefined): string | undefined {
    if (value === undefined || value === null || value === '') return value;
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
    if (!ok) throw new BadRequestException('Date must be in YYYY-MM-DD format');
    return value;
  }
}
