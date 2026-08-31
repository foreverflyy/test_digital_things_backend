import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { LoggerService } from './logger.service';

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const traceId = (req.header('x-trace-id') ?? randomUUID()).slice(0, 64);
    res.setHeader('x-trace-id', traceId);
    LoggerService.runWithTrace(traceId, () => next());
  }
}
