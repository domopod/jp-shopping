import { ProductTranslationService } from './product-translation.service';

describe('ProductTranslationService', () => {
  let service: ProductTranslationService;

  beforeEach(() => {
    service = new ProductTranslationService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('falls back to local glossary when remote translation fails', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'));

    await expect(service.translateText('バックプリントカラフルロゴTシャツ')).resolves.toBe('背部印花彩色logoT恤');
  });

  it('translates multiline content line by line with stable local fallback', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'));

    await expect(service.translateMultiline('サイズ: 130\nカラー: ブラック')).resolves.toEqual([
      '尺码: 130',
      '颜色: 黑色',
    ]);
  });
});
