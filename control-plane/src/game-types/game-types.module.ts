import { Module } from '@nestjs/common';
import { GameTypesController } from './game-types.controller';
import { GameTypesService } from './game-types.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [GameTypesController],
  providers: [GameTypesService, PrismaService],
  exports: [GameTypesService],
})
export class GameTypesModule {}
