import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface GameTypeDto {
  id: string;
  slug: string;
  name: string;
  capabilities: string[];
}

@Injectable()
export class GameTypesService {
  constructor(private readonly prisma: PrismaService) {}

  /** List all game types with capabilities for UI capability registry. */
  async findAll(): Promise<GameTypeDto[]> {
    const list = await this.prisma.gameType.findMany({
      orderBy: { slug: 'asc' },
    });
    return list.map((gt) => ({
      id: gt.id,
      slug: gt.slug,
      name: gt.name,
      capabilities: this.parseCapabilities(gt.capabilities),
    }));
  }

  /** Get one by slug (e.g. for server instance validation). */
  async findBySlug(slug: string): Promise<GameTypeDto | null> {
    const gt = await this.prisma.gameType.findUnique({
      where: { slug },
    });
    if (!gt) return null;
    return {
      id: gt.id,
      slug: gt.slug,
      name: gt.name,
      capabilities: this.parseCapabilities(gt.capabilities),
    };
  }

  private parseCapabilities(cap: unknown): string[] {
    if (!Array.isArray(cap)) return [];
    return cap.filter((c): c is string => typeof c === 'string');
  }
}
