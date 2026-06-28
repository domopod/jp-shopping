import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { AddStockProductDto } from './dto/add-stock-product.dto';
import { StockMonitorService } from './stock-monitor.service';

@Controller('api/stock-monitor')
export class StockMonitorController {
  constructor(private readonly stockMonitorService: StockMonitorService) {}

  @Post('products')
  addProduct(@Body() body: AddStockProductDto) {
    return this.stockMonitorService.addProduct(body);
  }

  @Get('products')
  listProducts() {
    return this.stockMonitorService.listProducts();
  }

  @Delete('products/:id')
  deleteProduct(@Param('id', ParseIntPipe) id: number) {
    return this.stockMonitorService.deleteProduct(id);
  }

  @Post('products/:id/refresh')
  refreshProduct(@Param('id', ParseIntPipe) id: number) {
    return this.stockMonitorService.refreshProduct(id);
  }

  @Post('products/:id/pin')
  togglePin(@Param('id', ParseIntPipe) id: number) {
    return this.stockMonitorService.togglePin(id);
  }

  @Post('refresh-all')
  refreshAllProducts() {
    return this.stockMonitorService.refreshAllProducts();
  }
}
