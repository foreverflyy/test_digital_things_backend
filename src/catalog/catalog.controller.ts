import { Controller, Get, Param, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { z } from 'zod';
import { CatalogService } from './catalog.service';

const showcaseQuerySchema = z.object({
  type: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  in_stock: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

@Controller('products')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  async showcase(
    @Query(new ZodValidationPipe(showcaseQuerySchema)) parsed: z.infer<typeof showcaseQuerySchema>,
  ) {
    return this.catalog.showcase({
      type: parsed.type,
      cursor: parsed.cursor,
      limit: parsed.limit,
      inStockOnly: parsed.in_stock,
    });
  }

  @Get('explain')
  async explain(@Query('type') type = 'key') {
    const plan = await this.catalog.explainShowcase(type);
    return { plan: plan.map((row) => row['QUERY PLAN']) };
  }

  @Get(':sku')
  async findOne(@Param('sku') sku: string) {
    return this.catalog.findBySku(sku);
  }
}
