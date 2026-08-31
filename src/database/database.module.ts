import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { MigrationRunner } from './migration.runner';
import { SeedService } from './seed.service';

@Global()
@Module({
  providers: [DatabaseService, MigrationRunner, SeedService],
  exports: [DatabaseService, MigrationRunner, SeedService],
})
export class DatabaseModule {}
