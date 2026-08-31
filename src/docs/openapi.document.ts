import { OpenAPIObject } from '@nestjs/swagger';
import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { appConfig } from '../config/app-config';

const orderSchema: SchemaObject = {
  type: 'object',
  properties: {
    order_id: { type: 'string', example: 'ord_a1b2c3d4e5f6' },
    sku: { type: 'string', example: 'KEY-CS2-PRIME' },
    status: {
      type: 'string',
      enum: [
        'created',
        'paid',
        'delivering',
        'delivered',
        'payment_failed',
        'out_of_stock',
        'delivery_failed',
      ],
      description:
        'created — ждёт оплаты. paid — оплата подтверждена. delivering — идёт получение кода. ' +
        'delivered и payment_failed — финальные. out_of_stock и delivery_failed — восстановимые: ' +
        'фоновая задача вернётся к заказу и доведёт его до delivered.',
    },
    amount_minor: { type: 'integer', example: 129000, description: 'Цена в копейках' },
    amount: { type: 'number', example: 1290, description: 'Цена в рублях' },
    currency: { type: 'string', example: 'RUB' },
    code: {
      type: 'string',
      nullable: true,
      example: 'LFXC-TNCS-BPCD',
      description: 'Выданный код. Заполняется один раз и больше не меняется.',
    },
    delivered_at: { type: 'string', format: 'date-time', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const productSchema: SchemaObject = {
  type: 'object',
  properties: {
    sku: { type: 'string', example: 'KEY-CS2-PRIME' },
    name: { type: 'string', example: 'CS2 Prime Status ключ' },
    type: { type: 'string', enum: ['topup', 'key', 'subscription', 'giftcard'] },
    price_minor: { type: 'integer', example: 129000 },
    price: { type: 'number', example: 1290 },
    currency: { type: 'string', example: 'RUB' },
    in_stock: { type: 'boolean' },
    stock_count: { type: 'integer', example: 42 },
    image: { type: 'string', nullable: true },
  },
};

const errorSchema: SchemaObject = {
  type: 'object',
  properties: {
    error: { type: 'string', example: 'sku_not_found' },
    details: { type: 'array', items: { type: 'object' } },
  },
};

export const openApiDocument: OpenAPIObject = {
  openapi: '3.0.3',
  info: {
    title: 'Магазин цифровых товаров — API ядра',
    version: '1.0.0',
    description:
      'Ядро площадки цифровых товаров: каталог, заказы, приём вебхуков оплаты и автоматическая ' +
      'выдача кода через двух поставщиков.\n\n' +
      'Всё построено вокруг одного требования: **код выдаётся ровно один раз** — даже при ' +
      'пятидесяти параллельных вебхуках, зависшем поставщике или перезапуске сервиса ' +
      'посреди выдачи.\n\n' +
      'Заглушки поставщиков документированы отдельно, на своих адресах по пути /docs.',
  },
  servers: [
    ...(appConfig.PUBLIC_URL ? [{ url: appConfig.PUBLIC_URL, description: 'Публичный адрес' }] : []),
    { url: '/', description: 'Тот же хост, откуда открыта документация' },
  ],
  tags: [
    { name: 'Каталог', description: 'Витрина товаров с остатками' },
    { name: 'Заказы', description: 'Создание заказа и получение его статуса' },
    { name: 'Вебхуки', description: 'Приём событий от платёжной системы' },
    { name: 'Администрирование', description: 'Сверка, аудит и восстановление' },
    { name: 'Служебное', description: 'Проверка живости' },
  ],
  paths: {
    '/products': {
      get: {
        tags: ['Каталог'],
        summary: 'Витрина товаров',
        description:
          'Keyset-пагинация: стоимость страницы не растёт с глубиной. ' +
          'Остаток берётся из денормализованного поля, к поставщикам запрос не идёт.',
        parameters: [
          {
            name: 'type',
            in: 'query',
            schema: { type: 'string', enum: ['topup', 'key', 'subscription', 'giftcard'] },
          },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 24, maximum: 100 } },
          {
            name: 'cursor',
            in: 'query',
            schema: { type: 'string' },
            description: 'Значение next_cursor из предыдущего ответа',
          },
          { name: 'in_stock', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
        ],
        responses: {
          200: {
            description: 'Страница витрины',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: productSchema },
                    next_cursor: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          400: {
            description: 'Некорректные параметры',
            content: { 'application/json': { schema: errorSchema } },
          },
        },
      },
    },
    '/products/explain': {
      get: {
        tags: ['Каталог'],
        summary: 'План выполнения горячего запроса витрины',
        description:
          'Отдаёт живой EXPLAIN (ANALYZE, BUFFERS). На каталоге в 5000+ товаров показывает ' +
          'Index Only Scan с Heap Fetches: 0 — запрос не касается таблицы.',
        parameters: [{ name: 'type', in: 'query', schema: { type: 'string', default: 'key' } }],
        responses: {
          200: {
            description: 'Строки плана',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { plan: { type: 'array', items: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
    },
    '/products/{sku}': {
      get: {
        tags: ['Каталог'],
        summary: 'Карточка товара',
        parameters: [{ name: 'sku', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Товар', content: { 'application/json': { schema: productSchema } } },
          404: { description: 'Нет такого SKU', content: { 'application/json': { schema: errorSchema } } },
        },
      },
    },
    '/orders': {
      post: {
        tags: ['Заказы'],
        summary: 'Создать заказ',
        description:
          'order_id можно задать самому — это нужно, если вебхук об оплате может прийти ' +
          'раньше создания заказа. Заголовок Idempotency-Key делает повторный вызов безопасным: ' +
          'вернётся ранее созданный заказ, а не новый.',
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: false,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sku'],
                properties: {
                  sku: { type: 'string', example: 'KEY-CS2-PRIME' },
                  order_id: { type: 'string', example: 'ord_00123' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Заказ создан', content: { 'application/json': { schema: orderSchema } } },
          404: { description: 'Нет такого SKU', content: { 'application/json': { schema: errorSchema } } },
        },
      },
    },
    '/orders/{id}': {
      get: {
        tags: ['Заказы'],
        summary: 'Статус заказа и выданный код',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Заказ', content: { 'application/json': { schema: orderSchema } } },
          404: { description: 'Заказ не найден', content: { 'application/json': { schema: errorSchema } } },
        },
      },
    },
    '/webhooks/payment': {
      post: {
        tags: ['Вебхуки'],
        summary: 'Событие от платёжной системы',
        description:
          'Доставка at-least-once и не по порядку. Обработка идемпотентна: дедупликация идёт ' +
          'по event_id (первичный ключ в таблице событий), а перевод заказа в paid — условным ' +
          'UPDATE, поэтому из пятидесяти одновременных событий сработает ровно одно.\n\n' +
          'Событие по несуществующему заказу не отвергается: оно сохраняется и применяется, ' +
          'когда заказ появится. Поле amount приходит в рублях и переводится в копейки на входе.\n\n' +
          'Ответ 5xx означает, что событие не принято — платёжной системе следует повторить доставку.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['event_id', 'order_id', 'status', 'amount', 'currency', 'created_at'],
                properties: {
                  event_id: { type: 'string', example: 'evt_a1b2c3' },
                  order_id: { type: 'string', example: 'ord_00123' },
                  status: { type: 'string', enum: ['paid', 'failed'] },
                  amount: { type: 'number', example: 500 },
                  currency: { type: 'string', example: 'RUB' },
                  created_at: { type: 'string', format: 'date-time', example: '2025-01-01T12:00:00Z' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Событие принято',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    result: {
                      type: 'string',
                      enum: [
                        'applied',
                        'duplicate',
                        'order_missing',
                        'ignored_stale',
                        'ignored_not_pending',
                        'amount_mismatch',
                      ],
                      description:
                        'applied — событие изменило заказ. duplicate — такой event_id уже обработан. ' +
                        'order_missing — заказа ещё нет, событие применится позже. ' +
                        'ignored_stale — событие старше уже применённого. ' +
                        'ignored_not_pending — заказ уже не ждёт оплаты. ' +
                        'amount_mismatch — сумма не совпала с ценой заказа.',
                    },
                  },
                },
              },
            },
          },
          400: { description: 'Некорректный payload', content: { 'application/json': { schema: errorSchema } } },
        },
      },
    },
    '/admin/reconciliation': {
      get: {
        tags: ['Администрирование'],
        summary: 'Сверка',
        description:
          'Оплаченные, но не выданные заказы; выданные без оплаты; зависшие в выдаче; ' +
          'незакрытые попытки. Плюс баланс журнала проводок: он всегда нулевой, а остаток ' +
          'на счёте deferred_revenue равен сумме заказов «оплачен, но не выдан».',
        responses: {
          200: {
            description: 'Отчёт',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    generated_at: { type: 'string', format: 'date-time' },
                    paid_not_delivered: { type: 'array', items: { type: 'object' } },
                    delivered_not_paid: { type: 'array', items: { type: 'object' } },
                    stuck_delivering: { type: 'array', items: { type: 'object' } },
                    unknown_attempts: { type: 'array', items: { type: 'object' } },
                    unapplied_events: { type: 'array', items: { type: 'object' } },
                    ledger: { type: 'object' },
                    healthy: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/admin/orders/{id}/audit': {
      get: {
        tags: ['Администрирование'],
        summary: 'История заказа',
        description: 'События оплаты, попытки выдачи и проводки по одному заказу.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'История',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    order: { type: 'object' },
                    events: { type: 'array', items: { type: 'object' } },
                    attempts: { type: 'array', items: { type: 'object' } },
                    ledger: { type: 'array', items: { type: 'object' } },
                    counters: {
                      type: 'object',
                      properties: {
                        events: { type: 'integer' },
                        successful_attempts: { type: 'integer', example: 1 },
                        delivery_issued_postings: { type: 'integer', example: 2 },
                        payment_captured_postings: { type: 'integer', example: 2 },
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
    '/admin/recovery/run': {
      post: {
        tags: ['Администрирование'],
        summary: 'Прогнать восстановление сейчас',
        description:
          'Синхронно делает то же, что фоновые задачи: обновляет остатки, применяет ' +
          'осиротевшие события, разбирается с незакрытыми попытками и добивает зависшие заказы.',
        responses: {
          200: {
            description: 'Итог прогона',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    orphan_events_applied: { type: 'integer' },
                    stuck_orders_resumed: { type: 'integer' },
                    unknown_attempts_reconciled: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/admin/orders/{id}/retry-delivery': {
      post: {
        tags: ['Администрирование'],
        summary: 'Добить заказ вручную',
        description:
          'Безопасно для уже выданного заказа: повтор не создаёт вторую выдачу и не меняет код.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Результат',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    outcome: {
                      type: 'string',
                      enum: [
                        'delivered',
                        'already_delivered',
                        'not_claimable',
                        'unknown_order',
                        'awaiting_reconcile',
                        'out_of_stock',
                        'delivery_failed',
                      ],
                    },
                    order: orderSchema,
                  },
                },
              },
            },
          },
        },
      },
    },
    '/healthz': {
      get: {
        tags: ['Служебное'],
        summary: 'Проверка живости',
        responses: {
          200: {
            description: 'Сервис и база доступны',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } },
              },
            },
          },
        },
      },
    },
  },
};
