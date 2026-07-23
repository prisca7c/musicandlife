import { Module } from '@nestjs/common';
import { RepertoireController } from './repertoire.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [RepertoireController],
})
export class RepertoireModule {}
