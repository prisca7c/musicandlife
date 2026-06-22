export interface SendSmsOptions {
  to: string;
  body: string;
}

export abstract class SmsPort {
  abstract send(opts: SendSmsOptions): Promise<void>;
}
