import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

function validateProductionConfiguration() {
  if (process.env.NODE_ENV !== 'production') return;
  for (const key of ['JWT_SECRET', 'JWT_AGENT_SECRET', 'EMAIL_VERIFICATION_SECRET', 'OPENAI_KEY_ENCRYPTION_SECRET']) {
    const value = process.env[key] || '';
    if (value.length < 32 || /change-me|changeme/i.test(value)) {
      throw new Error(`${key} must be a non-default secret of at least 32 characters`);
    }
  }
  const publicUrl = process.env.PUBLIC_WEB_URL || '';
  if (!publicUrl.startsWith('https://')) throw new Error('PUBLIC_WEB_URL must use HTTPS in production');
}

async function bootstrap() {
  validateProductionConfiguration();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.useBodyParser('json', { limit: '256kb' });
  app.useBodyParser('urlencoded', { limit: '256kb', extended: true });
  const allowedOrigins = new Set([process.env.PUBLIC_WEB_URL?.replace(/\/$/, '')].filter(Boolean));
  if (process.env.NODE_ENV !== 'production') allowedOrigins.add('http://localhost:3000');
  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) =>
      callback(null, !origin || allowedOrigins.has(origin)),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false,
    maxAge: 600,
  });
  app.use((_req: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('X-XSS-Protection', '0');
    next();
  });
  // Several legacy DTOs are intentionally still plain TypeScript shapes. Keep
  // decorator validation active without stripping those request bodies until
  // every endpoint has been migrated to decorated DTOs.
  app.useGlobalPipes(new ValidationPipe({ transform: true, forbidUnknownValues: false }));
  const port = parseInt(process.env.PORT ?? '3001', 10);
  await app.listen(port, '0.0.0.0');
  console.log(`Control plane listening on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
