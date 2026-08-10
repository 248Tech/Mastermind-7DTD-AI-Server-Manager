import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class HealthMonitorService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(orgId: string, minutes = 60) {
    const since = new Date(Date.now() - Math.min(Math.max(minutes, 5), 1440) * 60_000);
    const [hosts, samples, org] = await Promise.all([
      this.prisma.host.findMany({ where: { orgId }, select: { id: true, name: true, status: true, lastHeartbeatAt: true, lastMetrics: true } }),
      this.prisma.healthSample.findMany({ where: { orgId, createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, take: 5000 }),
      this.prisma.org.findUnique({ where: { id: orgId }, select: { healthIntervalSec: true } }),
    ]);
    return { hosts, samples, intervalSec: org?.healthIntervalSec ?? 10 };
  }

  async updateInterval(orgId: string, intervalSec: number) {
    if (![5, 10, 30, 60].includes(intervalSec)) throw new BadRequestException('Interval must be 5, 10, 30, or 60 seconds');
    const org = await this.prisma.org.findUnique({ where: { id: orgId }, select: { id: true } });
    if (!org) throw new NotFoundException('Organization not found');
    return this.prisma.org.update({ where: { id: orgId }, data: { healthIntervalSec: intervalSec }, select: { healthIntervalSec: true } });
  }
}
