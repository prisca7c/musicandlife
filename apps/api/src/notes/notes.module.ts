import { Module } from '@nestjs/common';
import { NotesController } from './notes.controller';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [NotesController] })
export class NotesModule {}
