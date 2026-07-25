import { toCsv, parseCsv } from '../src/common/csv';

describe('toCsv — spreadsheet formula-injection hardening', () => {
  it('neutralises a leading = formula', () => {
    const out = toCsv([{ instrument: '=HYPERLINK("http://evil","click")' }]);
    // apostrophe-prefixed, and quoted because it contains a comma + quotes
    expect(out.split('\n')[1]).toBe(`"'=HYPERLINK(""http://evil"",""click"")"`);
  });

  it('neutralises the classic DDE payload', () => {
    const out = toCsv([{ instrument: "=cmd|'/c calc'!A1" }]);
    expect(out.split('\n')[1]).toBe(`'=cmd|'/c calc'!A1`);
  });

  it('neutralises leading + @ tab and CR triggers', () => {
    expect(toCsv([{ v: '+1+1' }]).split('\n')[1]).toBe(`'+1+1`);
    expect(toCsv([{ v: '@SUM(A1:A9)' }]).split('\n')[1]).toBe(`'@SUM(A1:A9)`);
    expect(toCsv([{ v: '\t=1' }]).split('\n')[1]).toBe(`'\t=1`);
  });

  it('leaves legitimate numbers (incl. negatives / money) untouched', () => {
    expect(toCsv([{ amount: -500 }]).split('\n')[1]).toBe('-500');
    expect(toCsv([{ amount: '-4.00' }]).split('\n')[1]).toBe('-4.00');
    expect(toCsv([{ amount: 1234.56 }]).split('\n')[1]).toBe('1234.56');
  });

  it('leaves ordinary text untouched', () => {
    expect(toCsv([{ instrument: 'Piano' }]).split('\n')[1]).toBe('Piano');
  });

  it('a neutralised value round-trips back to its literal text', () => {
    const payload = '=1+2';
    const csv = toCsv([{ v: payload }]);
    const parsed = parseCsv(csv);
    // parser strips nothing — the apostrophe stays, so the cell is inert text,
    // never re-interpreted as the original formula.
    expect(parsed[1]![0]).toBe(`'=1+2`);
  });
});
