import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt } from 'class-validator';

export class DeleteProductsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @Type(() => Number)
  @IsInt({ each: true })
  productIds!: number[];
}
