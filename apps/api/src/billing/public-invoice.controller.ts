import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { BillingService } from './billing.service';

// No guards — this is the unauthenticated "pay online" link printed on invoice
// PDFs/emails. See BillingService.getPublicInvoiceSummary for what's exposed.
@Controller('public/invoices')
export class PublicInvoiceController {
  constructor(private readonly billing: BillingService) {}

  @Get(':id')
  getSummary(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.billing.getPublicInvoiceSummary(id);
  }
}
