export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
}

export abstract class EmailPort {
  abstract send(opts: SendEmailOptions): Promise<void>;
}
