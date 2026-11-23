import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { DraftHttpExceptionFilter } from './common/filters/draft-http-exception.filter';
import { HTTP_CORS_OPTIONS } from './common/config/cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Structured error responses for all HTTP routes (T-017).
  app.useGlobalFilters(new DraftHttpExceptionFilter());

  // DTO validation (class-validator) on every route.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Local-only deployment: only the Next.js frontend origin may call the API.
  app.enableCors(HTTP_CORS_OPTIONS);

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://0.0.0.0:${port}`);
}

bootstrap();
