import {
  SMART_CROP_CATEGORIES,
  type SmartCropCategory,
} from '../smart-crop.constants';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// 单个图片裁切项的数据结构
export class SmartCropImageItem {
  // 图片 ID（对应 productImage.id），必填且必须为整数
  @IsInt()
  @IsNotEmpty()
  id: number;

  // 图片 URL，必填字符串
  @IsString()
  @IsNotEmpty()
  imageUrl: string;

  // 可选的原始来源图片 URL（用于追溯原始图片）
  @IsString()
  @IsOptional()
  sourceImageUrl?: string;

  // 可选的 SKU 编码（对应某个 SKU 的图片）
  @IsOptional()
  sourceSkuCode?: string | null;

  // 可选的目标槽位（用于指定生成图片的排序位置）
  @IsInt()
  @IsOptional()
  targetSlot?: number | null;
}

// 智能裁切请求的整体 DTO
export class SmartCropRequestBodyDto {
  // 裁切目标类别，只能是 square_main/portrait_main/long_main
  @IsEnum(SMART_CROP_CATEGORIES)
  category: SmartCropCategory;

  // 待裁切的图片列表，嵌套验证每个子项
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SmartCropImageItem)
  images: SmartCropImageItem[];
}
