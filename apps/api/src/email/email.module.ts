import { Global, Module } from '@nestjs/common';
import { MailrelayAdapter } from './adapters/mailrelay.adapter';
import { EmailPort } from './ports/email.port';

@Global()
@Module({
  providers: [{ provide: EmailPort, useClass: MailrelayAdapter }],
  exports: [EmailPort],
})
export class EmailModule {}
