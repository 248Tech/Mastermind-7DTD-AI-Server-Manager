import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  getHealth() {
    return { status: 'ok', service: 'control-plane', at: new Date().toISOString() };
  }

  @Get('docs')
  getDocs() {
    return { message: 'API docs (Swagger/OpenAPI) — add @nestjs/swagger for full spec', health: '/health' };
  }
}
