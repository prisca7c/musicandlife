import { Module } from '@nestjs/common';
import { NewsController } from './news.controller';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [NewsController] })
export class NewsModule {}
