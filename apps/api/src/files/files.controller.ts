import { Controller, Post, Get, Param, Body, UseGuards } from '@nestjs/common';
import { FilesService } from './files.service';
import { SignUploadDto } from './dto/sign-upload.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('sign-upload')
  signUpload(@CurrentUser() user: RequestUser, @Body() body: SignUploadDto) {
    return this.files.signUpload({
      orgId: user.orgId,
      ownerId: user.userId,
      mime: body.mime,
      size: body.size,
      originalName: body.originalName,
      expiring: body.expiring,
    });
  }

  @Get(':id/sign-download')
  signDownload(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.files.signDownload(id, user.orgId);
  }
}
