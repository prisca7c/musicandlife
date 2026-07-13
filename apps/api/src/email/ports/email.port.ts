export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
}

/** Which mailing-list audience a contact belongs to (maps to a provider group). */
export type ContactAudience = 'families' | 'teachers' | 'students';

export interface AddContactOptions {
  email: string;
  name?: string;
  audience?: ContactAudience;
}

export abstract class EmailPort {
  abstract send(opts: SendEmailOptions): Promise<void>;

  /**
   * Add/ensure a contact in the provider's mailing list (for newsletters /
   * group emails). Optional capability — default is a no-op so providers that
   * don't manage lists (or aren't configured) simply do nothing. Callers treat
   * it as best-effort and never let it block the main action.
   */
  async addContact(_opts: AddContactOptions): Promise<void> {
    /* no-op by default */
  }
}
