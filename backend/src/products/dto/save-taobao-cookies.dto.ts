import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class TaobaoCookieDto {
  @IsString()
  name!: string;

  @IsString()
  value!: string;

  @IsString()
  domain!: string;

  @IsString()
  path!: string;

  @IsOptional()
  expires?: number;

  @IsOptional()
  httpOnly?: boolean;

  @IsOptional()
  secure?: boolean;

  @IsOptional()
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export class SaveTaobaoCookiesDto {
  @IsOptional()
  @IsString()
  cookieJson?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaobaoCookieDto)
  cookies?: TaobaoCookieDto[];
}
