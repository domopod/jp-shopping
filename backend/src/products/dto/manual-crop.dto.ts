import {
  SMART_CROP_CATEGORIES,
  type SmartCropCategory,
} from '../smart-crop.constants';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ManualCropImageItem {
  @IsInt()
  @IsNotEmpty()
  id: number;

  @IsString()
  @IsNotEmpty()
  imageUrl: string;

  @IsString()
  @IsOptional()
  sourceImageUrl?: string;

  @IsOptional()
  sourceSkuCode?: string | null;

  @IsInt()
  @IsOptional()
  targetSlot?: number | null;

  @IsNumber()
  @IsNotEmpty()
  offsetX: number;

  @IsNumber()
  @IsNotEmpty()
  offsetY: number;

  @IsNumber()
  @IsNotEmpty()
  scale: number;
}

export class ManualCropRequestBodyDto {
  @IsEnum(SMART_CROP_CATEGORIES)
  category: SmartCropCategory;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualCropImageItem)
  images: ManualCropImageItem[];
}
