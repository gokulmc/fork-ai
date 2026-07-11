import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Behind the EB Classic LB → read the real client IP from X-Forwarded-For.
  app.getHttpAdapter().getInstance().set('trust proxy', true);

  app.use(
    json({
      limit: '10mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(urlencoded({ limit: '10mb', extended: true }));

  // CORS_ORIGIN may be a comma-separated list (e.g. localhost + LAN IP in dev).
  // The cors middleware echoes the request origin when it matches the array.
  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : '*';
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swagger = new DocumentBuilder()
    .setTitle('fork.ai API')
    .setDescription('Branching research workspace — NestJS backend')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup('api', app, document);

  const cfg = app.get(ConfigService);
  const port = cfg.get<number>('port') ?? 3000;
  await app.listen(port);
  console.log(`fork.ai backend listening on port ${port}`);
}

bootstrap();
