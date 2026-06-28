import { IsNotEmpty, IsUrl } from 'class-validator';

export class AddStockProductDto {
  @IsNotEmpty()
  @IsUrl()
  url: string;
}
