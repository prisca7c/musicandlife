import { Global, Module } from '@nestjs/common';
import { SenderAdapter } from './adapters/sender.adapter';
import { EmailPort } from './ports/email.port';

@Global()
@Module({
  providers: [{ provide: EmailPort, useClass: SenderAdapter }],
  exports: [EmailPort],
})
export class EmailModule {}
