import { registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';

// A birthdate can't be in the future, and a four-digit-year typo the other way
// (e.g. "0202-…" or "1066-…") is just as wrong. Bound it to a realistic human
// range so a slipped digit is caught at the form instead of creating a student
// aged 1900+ or not yet born. Pairs with @IsDateString(), which has already
// confirmed the value parses — we only judge the range here.
const MIN_YEAR = 1900;

export function IsRealisticDob(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isRealisticDob',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null || value === '') return true; // optional
          if (typeof value !== 'string') return false;
          const t = Date.parse(value);
          if (isNaN(t)) return false; // @IsDateString covers the message for this
          const d = new Date(t);
          // Compare against end-of-today so a DOB of "today" is allowed but any
          // future instant is not.
          const now = new Date();
          const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
          return d.getTime() <= endOfToday.getTime() && d.getUTCFullYear() >= MIN_YEAR;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a real date of birth (not in the future, and after ${MIN_YEAR})`;
        },
      },
    });
  };
}
