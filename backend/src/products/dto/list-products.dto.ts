import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const PRODUCT_STATUSES = ['草稿', '已发布', '失败'] as const;
const IMAGE_LIST_STATUSES = ['PROCESSING', 'SUCCESS'] as const;

export class ListProductsDto {
  @IsOptional()
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value ?? 10))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 10;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: (typeof PRODUCT_STATUSES)[number];

  @IsOptional()
  @IsIn(IMAGE_LIST_STATUSES)
  imageStatus?: (typeof IMAGE_LIST_STATUSES)[number];
}

export { IMAGE_LIST_STATUSES, PRODUCT_STATUSES };
