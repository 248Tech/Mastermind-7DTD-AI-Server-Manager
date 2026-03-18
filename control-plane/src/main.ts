import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as net from 'net';
import { AppModule } from './app.module';

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '0.0.0.0');
  });
}

async function findAvailablePort(preferred: number, maxAttempts = 10): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = preferred + i;
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port in range ${preferred}–${preferred + maxAttempts - 1}`);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: '*' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  const preferred = parseInt(process.env.PORT ?? '3001', 10);
  const port = await findAvailablePort(preferred);
  if (port !== preferred) {
    console.warn(`Port ${preferred} in use — using port ${port} instead`);
  }
  await app.listen(port);
  console.log(`Control plane listening on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
