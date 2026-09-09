import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { PoiCatalogController } from './poi-catalog.controller';
import { PoiCatalogService } from './poi-catalog.service';

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET || 'change-me-user-secret' })],
  controllers: [PoiCatalogController],
  providers: [PoiCatalogService, PrismaService],
  exports: [PoiCatalogService],
})
export class PoiCatalogModule {}
