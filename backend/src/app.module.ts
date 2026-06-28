import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';
import { ProductsModule } from './products/products.module';
import { StockMonitorModule } from './stock-monitor/stock-monitor.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ProductsModule, StockMonitorModule],
  controllers: [HealthController],
})
export class AppModule {}
