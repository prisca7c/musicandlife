import { Global, Module } from '@nestjs/common';
import { MailrelayAdapter } from './adapters/mailrelay.adapter';
import { SenderAdapter } from './adapters/sender.adapter';
import { EmailPort } from './ports/email.port';

/**
 * Pick the email provider. Set EMAIL_PROVIDER=sender | mailrelay to choose
 * explicitly; otherwise default to Sender when a SENDER_API_KEY is present,
 * falling back to Mailrelay. This lets us switch providers with just an env
 * var change.
 */
function emailAdapter() {
  const explicit = process.env.EMAIL_PROVIDER?.toLowerCase();
  if (explicit === 'mailrelay') return MailrelayAdapter;
  if (explicit === 'sender') return SenderAdapter;
  return process.env.SENDER_API_KEY ? SenderAdapter : MailrelayAdapter;
}

@Global()
@Module({
  providers: [{ provide: EmailPort, useClass: emailAdapter() }],
  exports: [EmailPort],
})
export class EmailModule {}
