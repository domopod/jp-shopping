import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  ValidateNested,
} from 'class-validator';

const PRODUCT_STATUSES = ['草稿', '已发布', '失败'] as const;

class UpdateProductSkuDto {
  @IsString()
  skuCode!: string;

  @IsOptional()
  @IsString()
  name?: string | null;

  @IsOptional()
  @IsString()
  color?: string | null;

  @IsOptional()
  @IsString()
  size?: string | null;

  @IsOptional()
  @IsString()
  price?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock?: number | null;

  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: 'SKU 图片地址必须是有效 URL' })
  imageUrl?: string | null;
}

class UpdateProductImageDto {
  @IsString()
  imageUrl!: string;

  @IsOptional()
  isCover?: boolean;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  price?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  sizeInfo?: string | null;

  @IsOptional()
  @IsString()
  specification?: string | null;

  @IsOptional()
  @IsString()
  brand?: string | null;

  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: '来源链接必须是有效 URL' })
  sourceUrl?: string;

  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: (typeof PRODUCT_STATUSES)[number];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateProductImageDto)
  images?: UpdateProductImageDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5, { message: '封面图最多选择 5 张' })
  @ValidateNested({ each: true })
  @Type(() => UpdateProductImageDto)
  coverImages?: UpdateProductImageDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateProductSkuDto)
  skus?: UpdateProductSkuDto[];
}
