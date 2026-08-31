import { Module } from '@nestjs/common';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { SelfTestController } from './selftest.controller';
import { SelfTestService } from './selftest.service';

@Module({
  imports: [ReconciliationModule],
  controllers: [SelfTestController],
  providers: [SelfTestService],
})
export class SelfTestModule {}
