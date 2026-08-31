import { OpenAPIObject } from '@nestjs/swagger';
import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { appConfig } from '../config/app-config';

const controlSchema: SchemaObject = {
  type: 'object',
  properties: {
    failure_rate: { type: 'number', minimum: 0, maximum: 1, description: 'Доля ответов с ошибкой 500' },
    timeout_rate: { type: 'number', minimum: 0, maximum: 1, description: 'Доля зависаний без ответа' },
    latency_ms: { type: 'integer', description: 'Искусственная задержка ответа' },
    hard_down: { type: 'boolean', description: 'Всегда отвечать 503' },
    force_out_of_stock: { type: 'boolean', description: 'Всегда отвечать «нет в наличии»' },
    issue_then_hang: {
      type: 'boolean',
      description: 'Выдать код и не ответить — воспроизводит ловушку таймаута',
    },
  },
};

export const supplierOpenApiDocument: OpenAPIObject = {
  openapi: '3.0.3',
  info: {
    title: `Заглушка поставщика ${appConfig.SUPPLIER_ID} — API`,
    version: '1.0.0',
    description:
      'Изображает внешнего поставщика кодов. Состояние (пул кодов, журнал выданного, ' +
      'настройки сбоев) живёт в памяти процесса — базы у заглушки нет.\n\n' +
      'Главное свойство по контракту: **повтор с тем же request_id возвращает тот же код**. ' +
      'Именно это делает безопасным повтор после таймаута.',
  },
  servers: [{ url: '/', description: 'Тот же хост, откуда открыта документация' }],
  tags: [
    { name: 'Выдача', description: 'Контрактные ручки поставщика' },
    { name: 'Управление', description: 'Настройка поведения для тестов' },
    { name: 'Состояние', description: 'Что поставщик выдал на самом деле' },
  ],
  paths: {
    '/issue': {
      post: {
        tags: ['Выдача'],
        summary: 'Получить код',
        description:
          'Повторный запрос с тем же request_id возвращает ранее выданный код и не расходует пул.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['request_id', 'sku', 'order_id'],
                properties: {
                  request_id: { type: 'string', example: 'req_ord_00123_A_1' },
                  sku: { type: 'string', example: 'STEAM-TOPUP-500' },
                  order_id: { type: 'string', example: 'ord_00123' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Код выдан',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    request_id: { type: 'string' },
                    code: { type: 'string', example: 'LFXC-TNCS-BPCD' },
                  },
                },
              },
            },
          },
          409: {
            description: 'Нет в наличии',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'error' },
                    reason: { type: 'string', example: 'out_of_stock' },
                  },
                },
              },
            },
          },
          500: { description: 'Случайный сбой поставщика' },
          503: { description: 'Поставщик недоступен (hard_down)' },
          504: { description: 'Зависание: ответ приходит спустя 60 секунд' },
        },
      },
    },
    '/stock': {
      get: {
        tags: ['Выдача'],
        summary: 'Остатки по SKU',
        description: 'Ядро опрашивает эту ручку фоновой задачей и складывает результат к себе.',
        responses: {
          200: {
            description: 'Остатки',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    provider: { type: 'string', example: 'A' },
                    stock: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          sku: { type: 'string' },
                          available: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/_control': {
      get: {
        tags: ['Управление'],
        summary: 'Текущие настройки',
        responses: {
          200: { description: 'Настройки', content: { 'application/json': { schema: controlSchema } } },
        },
      },
      post: {
        tags: ['Управление'],
        summary: 'Изменить поведение',
        description:
          'Частичное обновление: переданные поля меняются, остальные сохраняются. ' +
          'Чтобы сбросить всё разом, используйте /_control/reset.',
        requestBody: { required: true, content: { 'application/json': { schema: controlSchema } } },
        responses: {
          200: { description: 'Новые настройки', content: { 'application/json': { schema: controlSchema } } },
        },
      },
    },
    '/_control/reset': {
      post: {
        tags: ['Управление'],
        summary: 'Вернуть исходное поведение',
        responses: {
          200: { description: 'Настройки сброшены', content: { 'application/json': { schema: controlSchema } } },
        },
      },
    },
    '/_control/restock': {
      post: {
        tags: ['Управление'],
        summary: 'Пополнить пул кодов',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sku', 'count'],
                properties: {
                  sku: { type: 'string', example: 'KEY-EFT' },
                  count: { type: 'integer', example: 10 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Сколько добавлено',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { added: { type: 'integer' } } },
              },
            },
          },
        },
      },
    },
    '/_state/issued/{requestId}': {
      get: {
        tags: ['Состояние'],
        summary: 'Что выдано по request_id',
        description: 'Позволяет убедиться, что после таймаута код всё-таки был выдан.',
        parameters: [{ name: 'requestId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Запись или null' } },
      },
    },
    '/_state/order/{orderId}': {
      get: {
        tags: ['Состояние'],
        summary: 'Что выдано по заказу',
        description: 'В корректном сценарии здесь ровно одна запись на заказ.',
        parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Список выданного' } },
      },
    },
    '/healthz': {
      get: { tags: ['Состояние'], summary: 'Проверка живости', responses: { 200: { description: 'ok' } } },
    },
  },
};
