import { IsString } from 'class-validator';

export class AiComposeLongMainDto {
  @IsString()
  productImageUrl!: string;

  @IsString()
  modelImageUrl!: string;
}
