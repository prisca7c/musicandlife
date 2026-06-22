import { Global, Module } from '@nestjs/common';
import { ResendAdapter } from './adapters/resend.adapter';
import { EmailPort } from './ports/email.port';

@Global()
@Module({
  providers: [{ provide: EmailPort, useClass: ResendAdapter }],
  exports: [EmailPort],
})
export class EmailModule {}
