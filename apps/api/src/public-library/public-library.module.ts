import { Module } from '@nestjs/common';
import { PublicLibraryController } from './public-library.controller';
import { PublicLibraryService } from './public-library.service';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [AuthModule, FilesModule, BillingModule],
  controllers: [PublicLibraryController],
  providers: [PublicLibraryService],
})
export class PublicLibraryModule {}
