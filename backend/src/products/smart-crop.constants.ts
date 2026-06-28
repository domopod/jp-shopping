export const SMART_CROP_CATEGORIES = [
  'square_main',
  'portrait_main',
  'long_main',
] as const;

export type SmartCropCategory = (typeof SMART_CROP_CATEGORIES)[number];

export const SMART_CROP_TARGETS: Record<
  SmartCropCategory,
  { width: number; height: number; label: string }
> = {
  square_main: { width: 1440, height: 1440, label: '1:1主图' },
  portrait_main: { width: 1440, height: 1920, label: '3:4主图' },
  long_main: { width: 1440, height: 2160, label: '宝贝长图' },
};

export const SMART_CROP_MAX_UPSCALE = 2.5;
export const SMART_CROP_JPG_QUALITY = 90;
export const SMART_CROP_PNG_COMPRESSION = 9;

export const CONTENT_AWARE_WEIGHTS = {
  PRIMARY: 100,
  SECONDARY: 70,
  TERTIARY: 40,
};

export const CROP_CANDIDATE_STEPS_H = 5;
export const CROP_CANDIDATE_STEPS_V = 5;
