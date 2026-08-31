import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LoggingModule } from '../logging/logging.module';
import { ReconciliationService } from './reconciliation.service';

@Module({
  imports: [ConfigModule, LoggingModule, DatabaseModule, LedgerModule],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReportingModule {}
