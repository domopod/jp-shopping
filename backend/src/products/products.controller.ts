import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DeleteProductsDto } from './dto/delete-products.dto';
import { ImportProductDto } from './dto/import-product.dto';
import { RegenerateImageCategoryDto, SetDefaultGeneratedImageDto, ManualSquareMainSlot1Dto } from './dto/image-center.dto';
import { ListProductsDto } from './dto/list-products.dto';
import { ModelPromptParamDto, UpdateModelPromptDto } from './dto/model-prompt.dto';
import { PublishProductsDto } from './dto/publish-products.dto';
import { SaveTaobaoCookiesDto } from './dto/save-taobao-cookies.dto';
import { SmartCropRequestBodyDto } from './dto/smart-crop.dto';
import { ManualCropRequestBodyDto } from './dto/manual-crop.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AiComposeLongMainDto } from './dto/ai-compose-long-main.dto';
import { UpdateSizeChartRequest } from './dto/size-chart.dto';
import { ProductsService } from './products.service';

interface UploadedImageFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

@Controller('api/products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post('import')
  importProduct(@Body() body: ImportProductDto) {
    return this.productsService.importByUrl(body.url);
  }

  @Get('import/tasks')
  listImportTasks() {
    return this.productsService.listImportTasks();
  }

  @Get('import/tasks/:taskId')
  getImportTask(@Param('taskId', ParseIntPipe) taskId: number) {
    return this.productsService.getImportTask(taskId);
  }

  @Get()
  listProducts(@Query() query: ListProductsDto) {
    return this.productsService.listProducts(query);
  }

  @Get('model-prompts')
  listModelPrompts() {
    return this.productsService.listModelPrompts();
  }

  @Patch('model-prompts/:key')
  updateModelPrompt(
    @Param() params: ModelPromptParamDto,
    @Body() body: UpdateModelPromptDto,
  ) {
    return this.productsService.updateModelPrompt(params.key, body.value);
  }

  @Get('publish/session')
  getTaobaoSessionStatus() {
    return this.productsService.getTaobaoSessionStatus();
  }

  @Post('publish/session/cookies')
  saveTaobaoCookies(@Body() body: SaveTaobaoCookiesDto) {
    return this.productsService.saveTaobaoCookies(body);
  }

  @Post('publish/session/validate')
  validateTaobaoSession() {
    return this.productsService.validateTaobaoSession();
  }

  @Post('publish/batch')
  publishProducts(@Body() body: PublishProductsDto) {
    return this.productsService.publishProducts(body.productIds);
  }

  @Get(':id/image-center')
  getImageCenter(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.getImageCenter(id);
  }

  @Post(':id/image-center/ensure')
  ensureImageCenter(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.ensureImageCenter(id);
  }

  @Post(':id/image-center/regenerate')
  regenerateImageCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RegenerateImageCategoryDto,
  ) {
    return this.productsService.regenerateImageCategory(id, body);
  }

  @Post(':id/image-center/square-main/slot1')
  regenerateSquareMainSlot1(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.regenerateSquareMainSlot1(id);
  }

  @Post(':id/image-center/square-main/slot1/manual')
  generateSquareMainSlot1Manual(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ManualSquareMainSlot1Dto,
  ) {
    return this.productsService.generateSquareMainSlot1Manual(id, body);
  }

  @Post(':id/image-center/raw-images/upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadImageCenterRawImage(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file?: UploadedImageFile,
  ) {
    return this.productsService.uploadImageCenterRawImage(id, file);
  }

  @Post(':id/image-center/tasks/:taskId/retry')
  retryImageCenterTask(
    @Param('id', ParseIntPipe) id: number,
    @Param('taskId', ParseIntPipe) taskId: number,
  ) {
    return this.productsService.retryImageCenterTask(id, taskId);
  }

  @Post(':id/image-center/generated-images/:assetId/default')
  setDefaultGeneratedImage(
    @Param('id', ParseIntPipe) id: number,
    @Param('assetId', ParseIntPipe) assetId: number,
    @Body() body: SetDefaultGeneratedImageDto,
  ) {
    return this.productsService.setDefaultGeneratedImage(id, assetId, body.category);
  }

  @Get(':id/image-center/download')
  downloadProductImageCenter(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.downloadImageCenterProduct(id);
  }

  @Get(':id/image-center/download/:category')
  downloadImageCenterCategory(
    @Param('id', ParseIntPipe) id: number,
    @Param('category') category: RegenerateImageCategoryDto['category'],
  ) {
    return this.productsService.downloadImageCenterCategory(id, category);
  }

  // 智能裁切：批量立即处理图片（同步，用于前端点击按钮即时响应）
  @Post(':id/smart-crop')
  processSmartCropBatch(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SmartCropRequestBodyDto,
  ) {
    return this.productsService.processSmartCropBatch(id, body);
  }

  // 手动裁切：根据用户指定的 offset 和 scale 裁切图片（同步）
  @Post(':id/manual-crop')
  processManualCrop(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ManualCropRequestBodyDto,
  ) {
    return this.productsService.processManualCrop(id, body);
  }

  // 智能裁切：查询异步任务的处理状态
  @Get(':id/smart-crop/tasks/:taskId')
  getSmartCropTaskStatus(
    @Param('id', ParseIntPipe) id: number,
    @Param('taskId', ParseIntPipe) taskId: number,
  ) {
    return this.productsService.getSmartCropTaskStatus(id, taskId);
  }

  @Get(':id')
  getProductDetail(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.findDetail(id);
  }

  @Get(':id/taobao')
  getTaobaoProduct(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.getTaobaoProduct(id);
  }

  @Patch(':id')
  updateProduct(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateProductDto,
  ) {
    return this.productsService.updateProduct(id, body);
  }

  @Delete('batch')
  deleteProducts(@Body() body: DeleteProductsDto) {
    return this.productsService.deleteProducts(body.productIds);
  }

  @Delete(':id')
  deleteProduct(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.deleteProduct(id);
  }

  @Post(':id/ai/retry')
  retryAiProcessing(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.retryAiProcessing(id);
  }

  @Post(':id/images/retry')
  retryImageProcessing(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.retryImageProcessing(id);
  }

  @Post(':id/publish')
  publishProduct(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.publishProduct(id);
  }

  @Post(':id/publish/retry')
  retryPublish(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.retryPublish(id);
  }

  @Post(':id/publish/resume')
  resumePublish(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.resumePublish(id);
  }

  @Get(':id/image-center/size-chart')
  getSizeChartTable(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.getSizeChartTable(id);
  }

  @Post(':id/image-center/size-chart')
  updateSizeChart(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateSizeChartRequest,
  ) {
    const rows = body.rows.map((row) => row.cells);
    return this.productsService.updateSizeChart(id, {
      headers: body.headers,
      rows,
    });
  }

  @Post(':id/ai-compose-long-main')
  aiComposeLongMain(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AiComposeLongMainDto,
  ) {
    return this.productsService.aiComposeLongMain(
      id,
      body.productImageUrl,
      body.modelImageUrl,
    );
  }
}
