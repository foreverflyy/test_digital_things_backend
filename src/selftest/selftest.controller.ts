import { Controller, HttpCode, Post, Query } from '@nestjs/common';
import { SCENARIO_NAMES, ScenarioName } from './selftest.types';
import { SelfTestService } from './selftest.service';

@Controller('admin/selftest')
export class SelfTestController {
  constructor(private readonly selfTest: SelfTestService) {}

  @Post('run')
  @HttpCode(200)
  async run(@Query('scenario') scenario?: string) {
    const only = SCENARIO_NAMES.includes(scenario as ScenarioName)
      ? (scenario as ScenarioName)
      : undefined;
    return this.selfTest.run(only);
  }
}
