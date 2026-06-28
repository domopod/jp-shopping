import { IsUrl } from 'class-validator';

export class ImportProductDto {
  @IsUrl({ require_protocol: true }, { message: '请输入有效的商品 URL' })
  url!: string;
}
