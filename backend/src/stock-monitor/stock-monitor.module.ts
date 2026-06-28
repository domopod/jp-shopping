import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MontbellCollectorService } from './montbell-collector.service';
import { StockMonitorController } from './stock-monitor.controller';
import { StockMonitorService } from './stock-monitor.service';

@Module({
  controllers: [StockMonitorController],
  providers: [StockMonitorService, PrismaService, MontbellCollectorService],
})
export class StockMonitorModule {}
