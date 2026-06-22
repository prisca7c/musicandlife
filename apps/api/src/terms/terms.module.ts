import { Module } from '@nestjs/common';
import { TermsController } from './terms.controller';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [TermsController] })
export class TermsModule {}
