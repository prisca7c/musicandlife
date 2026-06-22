import { Module } from '@nestjs/common';
import { RoomsController } from './rooms.controller';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [RoomsController] })
export class RoomsModule {}
