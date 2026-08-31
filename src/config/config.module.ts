import { Global, Module } from '@nestjs/common';
import { CONFIG, appConfig } from './app-config';

@Global()
@Module({
  providers: [{ provide: CONFIG, useValue: appConfig }],
  exports: [CONFIG],
})
export class ConfigModule {}
