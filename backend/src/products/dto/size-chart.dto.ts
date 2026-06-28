import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class SizeChartTableRow {
  @IsArray()
  @IsString({ each: true })
  cells!: string[];
}

export class UpdateSizeChartRequest {
  @IsArray()
  @IsString({ each: true })
  headers!: string[];

  @IsArray()
  @Type(() => SizeChartTableRow)
  @ValidateNested()
  rows!: SizeChartTableRow[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  productId?: number;
}
