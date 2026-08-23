import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { IsString, IsUUID, IsOptional, MaxLength } from 'class-validator';
import { ReconciliationService } from './reconciliation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

export class ImportStatementDto {
  // The raw CSV text. Sent as JSON rather than multipart so the client can show
  // a preview of what will be imported before committing.
  @IsString()
  @MaxLength(5_000_000)
  csv!: string;
}

export class AssignTransactionDto {
  @IsUUID()
  familyId!: string;
}

export class RejectClaimDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

@Controller('reconciliation')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReconciliationController {
  constructor(private readonly recon: ReconciliationService) {}

  // ─── Claims ────────────────────────────────────────────────────────────────

  @Get('claims')
  @Roles('admin')
  listClaims(@CurrentUser() u: RequestUser, @Query('status') status?: 'pending' | 'confirmed' | 'rejected') {
    return this.recon.listClaims(u.orgId, status);
  }

  @Post('claims/:id/confirm')
  @Roles('admin')
  confirmClaim(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.recon.confirmClaim(u.orgId, id, u.userId);
  }

  @Post('claims/:id/reject')
  @Roles('admin')
  rejectClaim(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: RejectClaimDto) {
    return this.recon.rejectClaim(u.orgId, id, u.userId, dto.reason);
  }

  // ─── Statement import ──────────────────────────────────────────────────────

  /**
   * Dry run: parse the CSV and report what would be imported, without writing
   * anything. Uploading the wrong file is the obvious way to make a mess here.
   */
  @Post('import/preview')
  @Roles('admin')
  preview(@CurrentUser() _u: RequestUser, @Body() dto: ImportStatementDto) {
    const { rows, skipped, headers } = this.recon.parseCsv(dto.csv);
    return {
      headers,
      creditRows: rows.length,
      skippedRows: skipped,
      total: rows.reduce((s, r) => s + r.amount, 0),
      sample: rows.slice(0, 10),
    };
  }

  @Post('import')
  @Roles('admin')
  async importStatement(@CurrentUser() u: RequestUser, @Body() dto: ImportStatementDto) {
    const { rows, skipped } = this.recon.parseCsv(dto.csv);
    const summary = await this.recon.importStatement(u.orgId, rows);
    return { ...summary, skippedNonCreditRows: skipped };
  }

  // ─── Exceptions ────────────────────────────────────────────────────────────

  @Get('unmatched')
  @Roles('admin')
  unmatched(@CurrentUser() u: RequestUser) {
    return this.recon.listUnmatchedTransactions(u.orgId);
  }

  @Post('unmatched/:id/assign')
  @Roles('admin')
  assign(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: AssignTransactionDto) {
    return this.recon.assignTransaction(u.orgId, id, dto.familyId);
  }

  @Post('unmatched/:id/ignore')
  @Roles('admin')
  ignore(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.recon.ignoreTransaction(u.orgId, id);
  }
}
