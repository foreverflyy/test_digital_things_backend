import { Module } from '@nestjs/common';
import { LoggingModule } from '../logging/logging.module';
import { SupplierController } from './supplier.controller';
import { SupplierService } from './supplier.service';

@Module({
  imports: [LoggingModule],
  controllers: [SupplierController],
  providers: [SupplierService],
})
export class SupplierModule {}
