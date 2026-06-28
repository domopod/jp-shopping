import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const SQUARE_MAIN_WHITE_PROMPT_KEY = 'square_main_white_prompt';
export const SQUARE_MAIN_EXPAND_PROMPT_KEY = 'square_main_expand_prompt';
export const PORTRAIT_MAIN_EXPAND_PROMPT_KEY = 'portrait_main_expand_prompt';
export const LONG_MAIN_PROMPT_KEY = 'long_main_prompt_template';
export const LONG_MAIN_COMPOSE_PROMPT_KEY = 'long_main_compose_prompt';

export const DEFAULT_SQUARE_MAIN_WHITE_PROMPT =
  'Remove background and generate a clean 1440x1440 white background product image. Keep original product unchanged: color, shape, pattern, logo, fabric texture. Remove model, mannequin, hanger, props, text, watermark. Place garment centered on pure white (#FFFFFF) background. Soft natural lighting.';

export const DEFAULT_SQUARE_MAIN_EXPAND_PROMPT =
  'Outpaint the image into a clean 1440x1440 square 1:1 e-commerce image. Keep original product, colors, composition unchanged. Extend background naturally with matching lighting. No seams or artifacts.';

export const DEFAULT_PORTRAIT_MAIN_EXPAND_PROMPT =
  'Outpaint the image into a clean 1440x1920 portrait 3:4 e-commerce image. Keep original product, colors, composition unchanged. Extend background naturally with matching lighting. No seams or artifacts.';

export const DEFAULT_LONG_MAIN_PROMPT_TEMPLATE =
  'Outpaint the image into a clean 1440x2160 vertical 2:3 e-commerce image. Keep original product, colors, composition unchanged. Extend background naturally with matching lighting. No seams or artifacts.';

export const DEFAULT_LONG_MAIN_COMPOSE_PROMPT =
  'Use the provided product image as core material, expand canvas to 1440x2160 vertical 2:3 format. Keep original product unchanged: color, texture, pattern, logo, text, wrinkles. Blend background naturally with matching lighting. No seams or artifacts.';


export const MODEL_PROMPT_DEFINITIONS = {
  [SQUARE_MAIN_WHITE_PROMPT_KEY]: {
    label: '主图 1:1 白底图',
    description: '用于1:1主图第一张白底商品图的AI生成。',
    defaultValue: DEFAULT_SQUARE_MAIN_WHITE_PROMPT,
    placeholders: [],
  },
  [SQUARE_MAIN_EXPAND_PROMPT_KEY]: {
    label: '主图 1:1 扩图 (第3-5张)',
    description: '用于1:1主图第3-5张的AI扩图生成。',
    defaultValue: DEFAULT_SQUARE_MAIN_EXPAND_PROMPT,
    placeholders: [],
  },
  [PORTRAIT_MAIN_EXPAND_PROMPT_KEY]: {
    label: '主图 3:4 扩图 (第1-5张)',
    description: '用于3:4主图第1-5张的AI扩图生成。',
    defaultValue: DEFAULT_PORTRAIT_MAIN_EXPAND_PROMPT,
    placeholders: [],
  },
  [LONG_MAIN_PROMPT_KEY]: {
    label: '宝贝长图',
    description: '用于宝贝长图模型生成。',
    defaultValue: DEFAULT_LONG_MAIN_PROMPT_TEMPLATE,
    placeholders: [],
  },
  [LONG_MAIN_COMPOSE_PROMPT_KEY]: {
    label: '宝贝长图合成',
    description: '用于宝贝长图合成使用。适用于上传本地图片后进行AI合成。',
    defaultValue: DEFAULT_LONG_MAIN_COMPOSE_PROMPT,
    placeholders: [],
  },
} as const;

type ModelPromptKey = keyof typeof MODEL_PROMPT_DEFINITIONS;

@Injectable()
export class ModelPromptService {
  constructor(private readonly prismaService: PrismaService) {}

  private normalizePromptValue(key: ModelPromptKey, value?: string | null) {
    if (!value) {
      return MODEL_PROMPT_DEFINITIONS[key].defaultValue;
    }

    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return MODEL_PROMPT_DEFINITIONS[key].defaultValue;
    }

    return normalizedValue;
  }

  async listPrompts() {
    const settings = await this.prismaService.appSetting.findMany({
      where: {
        key: {
          in: Object.keys(MODEL_PROMPT_DEFINITIONS),
        },
      },
      orderBy: {
        key: 'asc',
      },
    });
    const settingMap = new Map(settings.map((item) => [item.key, item]));

    return (Object.keys(MODEL_PROMPT_DEFINITIONS) as ModelPromptKey[]).map((key) => {
      const definition = MODEL_PROMPT_DEFINITIONS[key];
      const setting = settingMap.get(key);

      return {
        key,
        label: definition.label,
        description: definition.description,
        value: this.normalizePromptValue(key, setting?.value),
        defaultValue: definition.defaultValue,
        placeholders: [...definition.placeholders],
        updatedAt: setting?.updatedAt?.toISOString() ?? null,
      };
    });
  }

  async getPromptValue(key: ModelPromptKey) {
    const setting = await this.prismaService.appSetting.findUnique({
      where: { key },
      select: { value: true },
    });

    return this.normalizePromptValue(key, setting?.value);
  }

  async updatePromptValue(key: ModelPromptKey, value: string) {
    const safeValue = this.normalizePromptValue(key, value);

    const setting = await this.prismaService.appSetting.upsert({
      where: { key },
      update: { value: safeValue },
      create: {
        key,
        value: safeValue,
      },
    });

    const definition = MODEL_PROMPT_DEFINITIONS[key];
    return {
      key,
      label: definition.label,
      description: definition.description,
      value: setting.value,
      defaultValue: definition.defaultValue,
      placeholders: [...definition.placeholders],
      updatedAt: setting.updatedAt.toISOString(),
    };
  }

  renderLongMainPrompt(input: {
    template: string;
    posePrompt: string;
    backgroundPrompt: string;
    seed: number;
  }) {
    return input.template
      .replaceAll('{{posePrompt}}', input.posePrompt)
      .replaceAll('{{backgroundPrompt}}', input.backgroundPrompt)
      .replaceAll('{{seed}}', String(input.seed));
  }
}
