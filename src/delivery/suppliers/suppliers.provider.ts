import { Provider } from '@nestjs/common';
import { AppConfig, CONFIG } from '../../config/app-config';
import { LoggerService } from '../../logging/logger.service';
import { SUPPLIERS, SupplierClient } from './supplier.client';

export const suppliersProvider: Provider = {
  provide: SUPPLIERS,
  inject: [CONFIG, LoggerService],
  useFactory: (config: AppConfig, logger: LoggerService): SupplierClient[] => {
    const options = {
      timeoutMs: config.SUPPLIER_TIMEOUT_MS,
      retries: config.SUPPLIER_RETRIES,
      backoffBaseMs: config.SUPPLIER_BACKOFF_BASE_MS,
    };
    return [
      new SupplierClient('A', config.SUPPLIER_A_URL, options, logger),
      new SupplierClient('B', config.SUPPLIER_B_URL, options, logger),
    ];
  },
};
