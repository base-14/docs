---
title: NestJS OpenTelemetry Instrumentation - Complete APM Setup Guide | Base14 Scout
sidebar_label: NestJS
description:
  NestJS OpenTelemetry instrumentation for controllers, services, TypeORM,
  BullMQ, and WebSocket gateways with distributed tracing using Base14 Scout.
keywords:
  [
    nestjs opentelemetry instrumentation,
    nestjs monitoring,
    nestjs apm,
    nestjs distributed tracing,
    nestjs observability,
    nestjs performance monitoring,
    opentelemetry nestjs,
    nestjs telemetry,
    nestjs typeorm monitoring,
    nestjs bullmq instrumentation,
    nestjs dependency injection tracing,
    nestjs interceptor monitoring,
    nestjs guard tracing,
    nestjs websocket monitoring,
    nestjs microservices tracing,
    nestjs postgres monitoring,
    nestjs application monitoring,
    typescript nestjs observability,
    nestjs production monitoring,
    nestjs debugging performance,
    opentelemetry typescript nestjs,
    nestjs controller instrumentation,
    nestjs service tracing,
    nestjs middleware monitoring,
    nestjs graphql tracing,
    nestjs rest api monitoring,
    nestjs enterprise monitoring,
    nestjs decorator instrumentation,
    nestjs async tracing,
    nestjs background jobs tracing,
    nestjs queue monitoring,
  ]
sidebar_position: 7
---

## Introduction

Implement OpenTelemetry instrumentation for NestJS applications to enable
comprehensive application performance monitoring (APM), distributed tracing, and
observability across your enterprise Node.js applications. This guide shows you
how to auto-instrument NestJS controllers, services, guards, interceptors,
TypeORM queries, BullMQ background jobs, and WebSocket gateways using the
OpenTelemetry Node.js SDK.

NestJS applications benefit from automatic instrumentation of the dependency
injection container, decorators, HTTP endpoints, TypeORM database queries,
Redis operations, BullMQ job processing, WebSocket connections, GraphQL
resolvers, and microservice communication. With OpenTelemetry, you can trace
requests through the entire dependency injection hierarchy, monitor async
context propagation, identify N+1 query problems, debug background job
failures, and track distributed transactions across microservices without
significant code changes.

Whether you're implementing observability for the first time, migrating from
New Relic or Datadog, troubleshooting performance issues in production, or
building enterprise-grade monitoring for microservices, this guide provides
production-ready configurations and best practices for NestJS OpenTelemetry
instrumentation with Base14 Scout.

## Who This Guide Is For

This documentation is designed for:

- **NestJS developers**: implementing observability and distributed tracing for
  enterprise applications with dependency injection
- **Backend engineers**: deploying NestJS microservices with comprehensive
  production monitoring requirements
- **DevOps teams**: standardizing observability across multiple NestJS services
  in Kubernetes environments
- **Enterprise architects**: building observable systems with GraphQL,
  WebSockets, message queues, and microservices
- **Full-stack developers**: debugging TypeORM queries, BullMQ jobs, and async
  operations in production NestJS apps

## Prerequisites

Before starting, ensure you have:

- **Node.js 18.x or later** (20.x LTS recommended for production)
- **NestJS 10.x or later** installed (`@nestjs/core`, `@nestjs/common`)
- **TypeScript 4.9+** (5.x recommended)
- **Scout Collector** configured and accessible
  - See
    [Docker Compose Setup](../../collector-setup/docker-compose-example.md) for
    local development
  - See [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md)
    for production
- Basic understanding of OpenTelemetry concepts (traces, spans, attributes)
- Familiarity with NestJS dependency injection and decorators

### Compatibility Matrix

| Component                     | Minimum Version | Recommended Version |
| ----------------------------- | --------------- | ------------------- |
| Node.js                       | 18.0.0          | 20.x LTS            |
| NestJS                        | 9.0.0           | 10.3.0+             |
| @opentelemetry/sdk-node       | 0.40.0          | 0.54.0+             |
| @opentelemetry/auto-inst...   | 0.40.0          | 0.54.0+             |
| TypeORM (if used)             | 0.3.0           | 0.3.20+             |
| BullMQ (if used)              | 4.0.0           | 5.x                 |
| @nestjs/websockets (optional) | 10.0.0          | 10.3.0+             |
| TypeScript                    | 4.9.0           | 5.3.0+              |

## Installation

Install the OpenTelemetry SDK and auto-instrumentation packages:

```bash showLineNumbers title="Install OpenTelemetry for NestJS"
npm install --save \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
  @opentelemetry/api
```

Install NestJS-specific packages if not already installed:

```bash showLineNumbers
npm install --save \
  @nestjs/core \
  @nestjs/common \
  @nestjs/platform-express
```

## Configuration

### Approach 1: Dedicated Instrumentation Module (Recommended)

Create a NestJS module for OpenTelemetry initialization:

```typescript showLineNumbers title="src/tracing/tracing.module.ts"
import { Module, OnModuleInit } from '@nestjs/common';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';

@Module({})
export class TracingModule implements OnModuleInit {
  private sdk: NodeSDK;

  onModuleInit() {
    this.sdk = new NodeSDK({
      resource: new Resource({
        [SEMRESATTRS_SERVICE_NAME]:
          process.env.OTEL_SERVICE_NAME || 'nestjs-api',
        [SEMRESATTRS_SERVICE_VERSION]:
          process.env.npm_package_version || '1.0.0',
        [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]:
          process.env.NODE_ENV || 'development',
      }),
      traceExporter: new OTLPTraceExporter({
        url:
          process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
          'http://localhost:4318/v1/traces',
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': {
            enabled: false,
          },
          '@opentelemetry/instrumentation-http': {
            ignoreIncomingRequestHook: (req) => {
              const ignorePaths = ['/health', '/metrics'];
              return ignorePaths.some((path) => req.url?.includes(path));
            },
          },
        }),
      ],
    });

    this.sdk.start();
  }

  async onModuleDestroy() {
    await this.sdk.shutdown();
  }
}
```

Import the module in your root AppModule:

```typescript showLineNumbers title="src/app.module.ts"
import { Module } from '@nestjs/common';
import { TracingModule } from './tracing/tracing.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    TracingModule, // Import FIRST for proper initialization
    UsersModule,
    // ... other modules
  ],
})
export class AppModule {}
```

### Approach 2: Standalone Instrumentation File

Create instrumentation file loaded before application bootstrap:

```typescript showLineNumbers title="instrumentation.ts"
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: 'nestjs-api',
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV,
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

process.on('SIGTERM', async () => {
  await sdk.shutdown();
  process.exit(0);
});

export default sdk;
```

Update `main.ts`:

```typescript showLineNumbers title="src/main.ts"
// Import instrumentation FIRST
import './instrumentation';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

### Approach 3: Environment Variables Configuration

For containerized deployments:

```bash showLineNumbers title=".env"
# Service identification
OTEL_SERVICE_NAME=nestjs-api
OTEL_SERVICE_VERSION=1.0.0
NODE_ENV=production

# Exporter configuration
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318

# Resource attributes
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.namespace=backend

# Performance tuning
OTEL_BSP_MAX_QUEUE_SIZE=2048
OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512
OTEL_BSP_SCHEDULE_DELAY=5000
```

Run with Node.js instrumentation:

```bash showLineNumbers
node --require ./instrumentation.js dist/main.js
```

## Production Configuration

For production deployments with BatchSpanProcessor and resource attributes:

```typescript showLineNumbers title="src/tracing/tracing.production.ts"
import { Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
  SEMRESATTRS_SERVICE_INSTANCE_ID,
} from '@opentelemetry/semantic-conventions';

@Module({})
export class TracingModule implements OnModuleInit, OnModuleDestroy {
  private sdk: NodeSDK;

  onModuleInit() {
    const traceExporter = new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      headers: {
        // Optional: Add authentication for Scout
        // 'Authorization': `Bearer ${process.env.SCOUT_API_KEY}`,
      },
      timeoutMillis: 15000,
    });

    this.sdk = new NodeSDK({
      resource: new Resource({
        [SEMRESATTRS_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME,
        [SEMRESATTRS_SERVICE_VERSION]: process.env.npm_package_version,
        [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV,
        [SEMRESATTRS_SERVICE_INSTANCE_ID]: process.env.HOSTNAME || process.pid.toString(),
        'service.namespace': process.env.SERVICE_NAMESPACE || 'default',
        'container.id': process.env.CONTAINER_ID,
        'k8s.pod.name': process.env.K8S_POD_NAME,
        'k8s.namespace.name': process.env.K8S_NAMESPACE,
      }),
      spanProcessor: new BatchSpanProcessor(traceExporter, {
        maxQueueSize: 2048,
        maxExportBatchSize: 512,
        scheduledDelayMillis: 5000,
        exportTimeoutMillis: 30000,
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': {
            enabled: false,
          },
          '@opentelemetry/instrumentation-http': {
            ignoreIncomingRequestHook: (req) => {
              return ['/health', '/metrics', '/ready'].some((path) =>
                req.url?.includes(path),
              );
            },
          },
        }),
      ],
    });

    this.sdk.start();
    console.log('OpenTelemetry SDK initialized');
  }

  async onModuleDestroy() {
    console.log('Shutting down OpenTelemetry SDK...');
    await this.sdk.shutdown();
  }
}
```

### Docker Deployment

```dockerfile showLineNumbers title="Dockerfile"
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

ENV NODE_ENV=production
ENV OTEL_SERVICE_NAME=nestjs-api

EXPOSE 3000

CMD ["node", "dist/main.js"]
```

```yaml showLineNumbers title="docker-compose.yml"
version: '3.8'

services:
  nestjs-api:
    build: .
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=production
      - OTEL_SERVICE_NAME=nestjs-api
      - OTEL_SERVICE_VERSION=1.0.0
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318
      - DATABASE_URL=postgres://user:pass@postgres:5432/nestjs
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres
      - redis
      - scout-collector

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: nestjs
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    ports:
      - '5432:5432'

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'

  scout-collector:
    image: otel/opentelemetry-collector-contrib:latest
    command: ['--config=/etc/otel-collector-config.yaml']
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml
    ports:
      - '4318:4318'
```

## NestJS-Specific Instrumentation

### Controllers and Routes

NestJS controllers are automatically instrumented via HTTP instrumentation:

```typescript showLineNumbers title="src/users/users.controller.ts"
import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Automatically traced as "GET /users"
  @Get()
  async findAll() {
    return this.usersService.findAll();
  }

  // Automatically traced as "GET /users/:id"
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.usersService.findOne(+id);
  }

  // Automatically traced as "POST /users"
  @Post()
  async create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }
}
```

Traces show:

- HTTP method and route pattern
- Response status codes
- Request/response headers (configurable)
- Timing for entire request lifecycle

### Services with Dependency Injection

Services are traced when called from instrumented controllers:

```typescript showLineNumbers title="src/users/users.service.ts"
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  // Database queries automatically traced by TypeORM instrumentation
  async findAll(): Promise<User[]> {
    return this.usersRepository.find();
  }

  async findOne(id: number): Promise<User> {
    return this.usersRepository.findOne({ where: { id } });
  }

  async create(createUserDto: CreateUserDto): Promise<User> {
    const user = this.usersRepository.create(createUserDto);
    return this.usersRepository.save(user);
  }
}
```

### TypeORM Database Instrumentation

TypeORM queries are automatically instrumented:

```typescript showLineNumbers title="src/users/entities/user.entity.ts"
import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { Order } from '../../orders/entities/order.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  email: string;

  @Column()
  name: string;

  @OneToMany(() => Order, (order) => order.user)
  orders: Order[];
}
```

TypeORM Module configuration:

```typescript showLineNumbers title="src/app.module.ts"
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TracingModule } from './tracing/tracing.module';

@Module({
  imports: [
    TracingModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: process.env.NODE_ENV !== 'production',
      logging: process.env.NODE_ENV === 'development',
    }),
    // ... other modules
  ],
})
export class AppModule {}
```

Traces show:

- SQL queries with parameters
- Query execution time
- Connection pool metrics
- Transaction boundaries

### Guards and Authentication

Guards are traced as part of the request lifecycle:

```typescript showLineNumbers title="src/auth/guards/jwt-auth.guard.ts"
import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { trace } from '@opentelemetry/api';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const tracer = trace.getTracer('auth-guard');

    return tracer.startActiveSpan('JwtAuthGuard.canActivate', async (span) => {
      try {
        const result = (await super.canActivate(context)) as boolean;
        span.setAttribute('auth.success', result);
        span.setStatus({ code: 1 }); // OK
        return result;
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: 2, message: error.message });
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
```

### Interceptors for Custom Tracing

Add custom attributes using interceptors:

```typescript showLineNumbers title="src/common/interceptors/tracing.interceptor.ts"
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { trace, context } from '@opentelemetry/api';

@Injectable()
export class TracingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const activeSpan = trace.getActiveSpan();

    if (activeSpan) {
      // Add custom attributes
      activeSpan.setAttribute('user.id', request.user?.id);
      activeSpan.setAttribute('tenant.id', request.headers['x-tenant-id']);
      activeSpan.setAttribute('request.path', request.path);
    }

    return next.handle().pipe(
      tap(() => {
        if (activeSpan) {
          activeSpan.setAttribute('response.status', 'success');
        }
      }),
    );
  }
}
```

Apply globally:

```typescript showLineNumbers title="src/main.ts"
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TracingInterceptor } from './common/interceptors/tracing.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalInterceptors(new TracingInterceptor());
  await app.listen(3000);
}
bootstrap();
```

### BullMQ Background Jobs

Instrument BullMQ job processing:

```typescript showLineNumbers title="src/jobs/email.processor.ts"
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { trace } from '@opentelemetry/api';

@Processor('email')
export class EmailProcessor {
  @Process('send-welcome')
  async handleWelcomeEmail(job: Job) {
    const tracer = trace.getTracer('email-processor');

    return tracer.startActiveSpan('EmailProcessor.sendWelcome', async (span) => {
      try {
        span.setAttributes({
          'job.id': job.id.toString(),
          'job.name': job.name,
          'job.attempts': job.attemptsMade,
          'user.email': job.data.email,
        });

        // Simulate email sending
        await this.sendEmail(job.data.email, job.data.name);

        span.setStatus({ code: 1 }); // OK
        return { sent: true };
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: 2, message: error.message });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private async sendEmail(email: string, name: string) {
    // Email sending logic
    console.log(`Sending welcome email to ${email}`);
  }
}
```

Queue module setup:

```typescript showLineNumbers title="src/jobs/jobs.module.ts"
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { EmailProcessor } from './email.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'email',
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
      },
    }),
  ],
  providers: [EmailProcessor],
})
export class JobsModule {}
```

### WebSocket Gateway Instrumentation

Trace WebSocket connections and messages:

```typescript showLineNumbers title="src/chat/chat.gateway.ts"
import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { trace } from '@opentelemetry/api';

@WebSocketGateway({ cors: true })
export class ChatGateway implements OnGatewayConnection {
  private tracer = trace.getTracer('chat-gateway');

  handleConnection(client: Socket) {
    const span = this.tracer.startSpan('ChatGateway.handleConnection');
    span.setAttributes({
      'websocket.client.id': client.id,
      'websocket.event': 'connection',
    });
    span.end();
  }

  @SubscribeMessage('message')
  async handleMessage(
    @MessageBody() data: { room: string; message: string },
    @ConnectedSocket() client: Socket,
  ) {
    return this.tracer.startActiveSpan('ChatGateway.handleMessage', async (span) => {
      try {
        span.setAttributes({
          'websocket.client.id': client.id,
          'websocket.room': data.room,
          'message.length': data.message.length,
        });

        // Broadcast message to room
        client.to(data.room).emit('message', {
          sender: client.id,
          message: data.message,
        });

        span.setStatus({ code: 1 });
        return { status: 'sent' };
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: 2, message: error.message });
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
```

## Custom Instrumentation

For business logic and application-specific operations:

```typescript showLineNumbers title="src/orders/orders.service.ts"
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { Order } from './entities/order.entity';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  private tracer = trace.getTracer('orders-service');

  constructor(
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
  ) {}

  async createOrder(userId: number, createOrderDto: CreateOrderDto) {
    return this.tracer.startActiveSpan('OrdersService.createOrder', async (span) => {
      try {
        span.setAttributes({
          'user.id': userId,
          'order.items.count': createOrderDto.items.length,
          'order.total': this.calculateTotal(createOrderDto.items),
        });

        // Validate inventory
        await this.tracer.startActiveSpan('validateInventory', async (validateSpan) => {
          const available = await this.checkInventory(createOrderDto.items);
          validateSpan.setAttribute('inventory.available', available);
          if (!available) {
            throw new Error('Insufficient inventory');
          }
          validateSpan.end();
        });

        // Create order
        const order = await this.tracer.startActiveSpan('saveOrder', async (dbSpan) => {
          const newOrder = this.ordersRepository.create({
            userId,
            items: createOrderDto.items,
            total: this.calculateTotal(createOrderDto.items),
          });
          const saved = await this.ordersRepository.save(newOrder);
          dbSpan.setAttribute('order.id', saved.id);
          dbSpan.end();
          return saved;
        });

        // Process payment
        await this.tracer.startActiveSpan('processPayment', async (paymentSpan) => {
          await this.processPayment(order.id, order.total);
          paymentSpan.setAttribute('payment.status', 'completed');
          paymentSpan.end();
        });

        span.setStatus({ code: SpanStatusCode.OK });
        return order;
      } catch (error) {
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private calculateTotal(items: any[]): number {
    return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  private async checkInventory(items: any[]): Promise<boolean> {
    // Inventory check logic
    return true;
  }

  private async processPayment(orderId: number, amount: number): Promise<void> {
    // Payment processing logic
  }
}
```

## Running Your Application

### Development Mode

```bash showLineNumbers
# With console output for debugging
export OTEL_TRACES_EXPORTER=console
npm run start:dev
```

### Production Mode

```bash showLineNumbers
export NODE_ENV=production
export OTEL_SERVICE_NAME=nestjs-api
export OTEL_EXPORTER_OTLP_ENDPOINT=https://scout.yourdomain.com/v1/traces
npm run start:prod
```

### Using PM2

```javascript showLineNumbers title="ecosystem.config.js"
module.exports = {
  apps: [
    {
      name: 'nestjs-api',
      script: 'dist/main.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        OTEL_SERVICE_NAME: 'nestjs-api',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://scout-collector:4318',
      },
    },
  ],
};
```

Start with PM2:

```bash showLineNumbers
pm2 start ecosystem.config.js
pm2 logs nestjs-api
```

## Troubleshooting

### Issue: No Traces from NestJS Controllers

**Solutions:**

1. Ensure TracingModule is imported first in AppModule:

```typescript
@Module({
  imports: [
    TracingModule, // MUST be first
    TypeOrmModule.forRoot(/*...*/),
    // other modules
  ],
})
export class AppModule {}
```

1. Verify HTTP instrumentation is enabled:

```typescript
instrumentations: [
  getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-http': {
      enabled: true, // Explicitly enable
    },
  }),
];
```

### Issue: TypeORM Queries Not Appearing in Traces

**Solutions:**

1. Install TypeORM instrumentation explicitly if needed:

```bash
npm install @opentelemetry/instrumentation-typeorm
```

1. Verify database connection is established after SDK initialization

2. Check TypeORM logging is enabled in development:

```typescript
TypeOrmModule.forRoot({
  // ...
  logging: true, // See queries in console
});
```

### Issue: Missing Context in Async Operations

**Solutions:**

Use async/await instead of callbacks:

```typescript
// WRONG - loses context
setTimeout(() => {
  const span = trace.getActiveSpan(); // undefined
}, 1000);

// CORRECT - preserves context
await new Promise((resolve) => setTimeout(resolve, 1000));
const span = trace.getActiveSpan(); // Works!
```

### Issue: Guard/Interceptor Spans Not Showing

**Solutions:**

Guards and interceptors need manual span creation. Add custom tracing as shown
in the Guards and Interceptors sections above.

## Security Considerations

### Sensitive Data Protection

Avoid capturing passwords, tokens, and PII in spans:

```typescript showLineNumbers
// BAD - Exposes sensitive data
span.setAttributes({
  'user.password': password,
  'user.email': email,
  'credit_card': cardNumber,
});

// GOOD - Use safe identifiers
span.setAttributes({
  'user.id': userId,
  'user.type': 'customer',
  'payment.method': 'credit_card',
});
```

### HTTP Header Filtering

Configure header filtering to exclude authentication tokens:

```typescript showLineNumbers
'@opentelemetry/instrumentation-http': {
  headersToSpanAttributes: {
    requestHeaders: ['content-type', 'user-agent'],
    responseHeaders: ['content-type'],
  },
},
```

### Database Query Sanitization

TypeORM automatically sanitizes parameters, but verify in traces:

```typescript
// Parameters are automatically sanitized
const user = await this.usersRepository.findOne({
  where: { email: userEmail }, // Safe - uses parameterized query
});
```

### Environment Variable Security

Never log sensitive environment variables:

```typescript showLineNumbers
// BAD
console.log('DB_PASSWORD:', process.env.DB_PASSWORD);

// GOOD - Use configuration service
@Injectable()
export class ConfigService {
  get(key: string): string {
    const value = process.env[key];
    if (!value && this.isProduction()) {
      throw new Error(`Missing required config: ${key}`);
    }
    return value;
  }
}
```

## Performance Considerations

OpenTelemetry adds minimal overhead to NestJS applications:

**Expected Impact:**

- **Latency**: +0.5-2ms per request with auto-instrumentation
- **CPU**: +2-5% in production with BatchSpanProcessor
- **Memory**: +15-35MB for trace buffers and SDK
- **Throughput**: &lt;1% reduction in requests/second

### Optimization Best Practices

#### 1. Use BatchSpanProcessor in Production

```typescript showLineNumbers
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

spanProcessor: new BatchSpanProcessor(traceExporter, {
  maxQueueSize: 2048,
  maxExportBatchSize: 512,
  scheduledDelayMillis: 5000,
});
```

#### 2. Skip Health Check Endpoints

```typescript showLineNumbers
'@opentelemetry/instrumentation-http': {
  ignoreIncomingRequestHook: (req) => {
    return ['/health', '/metrics', '/ready'].some((path) =>
      req.url?.includes(path),
    );
  },
},
```

#### 3. Disable Filesystem Tracing

```typescript showLineNumbers
'@opentelemetry/instrumentation-fs': {
  enabled: false,
},
```

#### 4. Use Sampling for High-Traffic Endpoints

```typescript showLineNumbers
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';

const sdk = new NodeSDK({
  sampler: new TraceIdRatioBasedSampler(0.1), // Sample 10% of traces
});
```

#### 5. Optimize TypeORM Queries

Use query builder for complex queries to reduce overhead:

```typescript showLineNumbers
// Efficient - single query with joins
const users = await this.usersRepository
  .createQueryBuilder('user')
  .leftJoinAndSelect('user.orders', 'order')
  .where('user.active = :active', { active: true })
  .getMany();

// Inefficient - N+1 queries
const users = await this.usersRepository.find({ where: { active: true } });
for (const user of users) {
  user.orders = await this.ordersRepository.find({ where: { userId: user.id } });
}
```

## FAQ

### Does OpenTelemetry work with NestJS dependency injection?

Yes, OpenTelemetry fully supports NestJS DI. TracingModule can be imported and
services are automatically traced when called from instrumented controllers.

### What's the performance impact on NestJS applications?

With BatchSpanProcessor, expect +0.5-2ms latency per request, +2-5% CPU, and
+15-35MB memory. Minimal impact for most production workloads.

### Can I trace TypeORM, Prisma, and Sequelize?

Yes, auto-instrumentation includes TypeORM, Prisma, Sequelize, and other ORMs.
Database queries are automatically traced with parameters.

### How do I trace BullMQ background jobs?

BullMQ jobs are automatically traced. Add custom spans in processors using
`trace.getTracer()` for detailed business logic tracing.

### Does it work with WebSocket gateways?

WebSocket connections and messages require manual instrumentation. Use
`trace.getTracer()` in gateway methods as shown in the WebSocket section.

### How do I trace GraphQL resolvers?

GraphQL queries are traced via HTTP instrumentation. Add custom spans in
resolvers for field-level tracing using decorators or interceptors.

### Can I use it with NestJS microservices?

Yes, OpenTelemetry traces distributed microservices automatically. Context
propagates across HTTP, gRPC, and message queue boundaries.

### How do I handle multi-tenant applications?

Add tenant ID as span attribute in guards or interceptors:
`span.setAttribute('tenant.id', tenantId)` and filter in Scout Dashboard.

### What's the difference between traces and metrics?

Traces show request flow and timing through your NestJS app (spans). Metrics
aggregate performance data (counters, histograms). Both are supported.

### How do I reduce trace volume in production?

Use sampling (`TraceIdRatioBasedSampler`), ignore health check endpoints,
disable filesystem tracing, and sample high-volume endpoints.

### Can I trace custom decorators and metadata?

Yes, use interceptors or method decorators to add custom spans. Access metadata
using `Reflector` and add attributes to active spans.

## What's Next?

### Framework-Specific Guides

- **[Express.js Instrumentation](./express.md)** - Express framework patterns
- **[Node.js Overview](./nodejs.md)** - General Node.js instrumentation guide
- **[FastAPI Instrumentation](./fast-api.md)** - Python async framework

### Advanced Topics

- [Custom Node.js Instrumentation](../custom-instrumentation/javascript-node.md)
  \- Manual spans, context propagation, and advanced patterns
- [Celery Background Jobs](./celery.md) - Distributed task queue tracing

### Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - Set up
  alerts for API latency, errors, and database queries
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - Build
  custom dashboards for NestJS metrics

### Deployment and Operations

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development environment with PostgreSQL and Redis
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Production deployment on Kubernetes

## Complete Example

Here's a complete working NestJS application with OpenTelemetry instrumentation:

### package.json

```json showLineNumbers title="package.json"
{
  "name": "nestjs-otel-example",
  "version": "1.0.0",
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/platform-express": "^10.3.0",
    "@nestjs/typeorm": "^10.0.1",
    "@nestjs/bull": "^10.0.1",
    "@opentelemetry/sdk-node": "^0.54.0",
    "@opentelemetry/auto-instrumentations-node": "^0.54.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.54.0",
    "@opentelemetry/resources": "^1.28.0",
    "@opentelemetry/semantic-conventions": "^1.28.0",
    "@opentelemetry/api": "^1.9.0",
    "typeorm": "^0.3.20",
    "pg": "^8.11.0",
    "bull": "^4.12.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.3.0",
    "@types/node": "^20.10.0",
    "typescript": "^5.3.0"
  }
}
```

### Environment Variables

```bash showLineNumbers title=".env.production"
NODE_ENV=production
OTEL_SERVICE_NAME=nestjs-api
OTEL_SERVICE_VERSION=1.0.0
OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318

DATABASE_URL=postgres://user:pass@postgres:5432/nestjs
REDIS_URL=redis://redis:6379
```

### GitHub Repository

Complete working example:
[GitHub: base-14/examples/nodejs/nestjs-postgres](https://github.com/base-14/examples/tree/main/nodejs/nestjs-postgres)

## References

- [Official OpenTelemetry Node.js Documentation](https://opentelemetry.io/docs/languages/js/)
- [NestJS Documentation](https://docs.nestjs.com/)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
- [TypeORM Documentation](https://typeorm.io/)

## Related Guides

- [Express.js Instrumentation](./express.md) - Express framework guide
- [Node.js Overview](./nodejs.md) - General Node.js instrumentation
- [Custom Node.js Instrumentation](../custom-instrumentation/javascript-node.md)
  \- Advanced patterns
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development setup
- [Kubernetes Deployment](../../collector-setup/kubernetes-helm-setup.md) -
  Production deployment
