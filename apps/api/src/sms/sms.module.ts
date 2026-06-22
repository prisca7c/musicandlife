import { Global, Module } from '@nestjs/common';
import { StubSmsAdapter } from './adapters/stub-sms.adapter';
import { SmsPort } from './ports/sms.port';

@Global()
@Module({
  providers: [{ provide: SmsPort, useClass: StubSmsAdapter }],
  exports: [SmsPort],
})
export class SmsModule {}
