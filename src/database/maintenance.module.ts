import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { LoggingModule } from '../logging/logging.module';
import { DatabaseModule } from './database.module';

@Module({ imports: [ConfigModule, LoggingModule, DatabaseModule] })
export class MaintenanceModule {}
