import { Global, Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FileStoragePort } from './ports/file-storage.port';
import { StubFileStorageAdapter } from './adapters/stub-file-storage.adapter';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [FilesController],
  providers: [
    FilesService,
    { provide: FileStoragePort, useClass: StubFileStorageAdapter },
  ],
  exports: [FilesService, FileStoragePort],
})
export class FilesModule {}
