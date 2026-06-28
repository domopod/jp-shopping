import { IsIn, IsString } from 'class-validator';
import {
  LONG_MAIN_COMPOSE_PROMPT_KEY,
  LONG_MAIN_PROMPT_KEY,
  SQUARE_MAIN_WHITE_PROMPT_KEY,
  SQUARE_MAIN_EXPAND_PROMPT_KEY,
  PORTRAIT_MAIN_EXPAND_PROMPT_KEY,
} from '../model-prompt.service';

export const MODEL_PROMPT_KEYS = [
  SQUARE_MAIN_WHITE_PROMPT_KEY,
  SQUARE_MAIN_EXPAND_PROMPT_KEY,
  PORTRAIT_MAIN_EXPAND_PROMPT_KEY,
  LONG_MAIN_PROMPT_KEY,
  LONG_MAIN_COMPOSE_PROMPT_KEY,
] as const;

export class UpdateModelPromptDto {
  @IsString()
  value!: string;
}

export class ModelPromptParamDto {
  @IsIn(MODEL_PROMPT_KEYS)
  key!: (typeof MODEL_PROMPT_KEYS)[number];
}
