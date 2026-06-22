import { Injectable, Logger } from '@nestjs/common';
import { SmsPort, type SendSmsOptions } from '../ports/sms.port';

@Injectable()
export class StubSmsAdapter extends SmsPort {
  private readonly logger = new Logger(StubSmsAdapter.name);

  async send(opts: SendSmsOptions): Promise<void> {
    // SMS provider not yet chosen — logs payload until native-code/Twilio/Vonage is wired
    this.logger.log(`[STUB SMS] to=${opts.to} body="${opts.body}"`);
  }
}
