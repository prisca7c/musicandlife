import { Module } from '@nestjs/common';
import { InstrumentsController, PublicInstrumentsController } from './instruments.controller';
import { InstrumentsService } from './instruments.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [PublicInstrumentsController, InstrumentsController],
  providers: [InstrumentsService],
  exports: [InstrumentsService],
})
export class InstrumentsModule {}
