import { Controller, Get } from '@nestjs/common';
import { GameTypesService } from './game-types.service';

/**
 * Capability registry: list game types and their supported adapter capabilities.
 * UI uses this to render only supported actions (start, stop, send_command, etc.).
 */
@Controller('api/game-types')
export class GameTypesController {
  constructor(private readonly gameTypesService: GameTypesService) {}

  /** List all game types with capabilities. No auth required for read (public registry). */
  @Get()
  async list() {
    return this.gameTypesService.findAll();
  }
}
