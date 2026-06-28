import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  IMAGE_CENTER_CATEGORIES,
  IMAGE_CENTER_GENERATION_MODES,
} from '../products.types';

export class RegenerateImageCategoryDto {
  @IsIn(IMAGE_CENTER_CATEGORIES)
  category!: (typeof IMAGE_CENTER_CATEGORIES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sourceImageId?: number;

  @IsOptional()
  @IsString()
  sourceSkuCode?: string;

  @IsOptional()
  @IsString()
  sourceUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  targetSlot?: number;

  @IsOptional()
  @IsIn(IMAGE_CENTER_GENERATION_MODES)
  generationMode?: (typeof IMAGE_CENTER_GENERATION_MODES)[number];
}

export class SetDefaultGeneratedImageDto {
  @IsIn(['square_main'])
  category!: 'square_main';
}

export class ManualSquareMainSlot1SkuDto {
  @IsString()
  sourceUrl!: string;

  @IsOptional()
  @IsString()
  sourceSkuCode?: string;
}

export class ManualSquareMainSlot1BackgroundDto {
  @IsString()
  sourceUrl!: string;

  @Type(() => Number)
  @IsNumber()
  offsetX!: number;

  @Type(() => Number)
  @IsNumber()
  offsetY!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  scale!: number;
}

export class ManualSquareMainSlot1SkuPanelDto {
  @Type(() => Number)
  @IsNumber()
  x!: number;

  @Type(() => Number)
  @IsNumber()
  y!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  width!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  height!: number;
}

export class ManualSquareMainSlot1Dto {
  @ValidateNested()
  @Type(() => ManualSquareMainSlot1BackgroundDto)
  background!: ManualSquareMainSlot1BackgroundDto;

  @IsArray()
  @ArrayMinSize(2, { message: 'SKU 图片至少选择 2 张' })
  @ArrayMaxSize(10, { message: 'SKU 图片最多选择 10 张' })
  @ValidateNested({ each: true })
  @Type(() => ManualSquareMainSlot1SkuDto)
  skus!: ManualSquareMainSlot1SkuDto[];

  @ValidateNested()
  @Type(() => ManualSquareMainSlot1SkuPanelDto)
  skuPanel!: ManualSquareMainSlot1SkuPanelDto;
}
