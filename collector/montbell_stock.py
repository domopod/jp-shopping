import json
import re
import sys
from urllib.parse import urlparse

import requests

USER_AGENT = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
)

STOCK_STATUS_MAP = {
    1: 'IN_STOCK',
    4: 'OUT_OF_STOCK',
    5: 'BACKORDER',
    6: 'BACKORDER',
    7: 'IN_STOCK',
    8: 'IN_STOCK',
}


def fetch_page(url):
    response = requests.get(url, timeout=15, headers={'User-Agent': USER_AGENT})
    response.raise_for_status()
    return response.text


def extract_product_json(html):
    m = re.search(r'var product = (\{.*?\n\});', html, re.DOTALL)
    if not m:
        m = re.search(r'var product = (\{.*?\});', html, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


def extract_enums_json(html):
    m = re.search(r'var Enums = (\{.*?\n\});', html, re.DOTALL)
    if not m:
        m = re.search(r'var Enums = (\{.*?\});', html, re.DOTALL)
    if not m:
        return {}
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return {}


def normalize_text(text):
    if text is None:
        return None
    return re.sub(r'\s+', ' ', str(text)).strip() or None


def format_restock_date(stock_date):
    """解析 MontBell 的 stock_date (格式: YYMMDD) 为人类可读格式"""
    if not stock_date:
        return None
    stock_date_str = str(stock_date)
    if len(stock_date_str) != 6:
        return None
    try:
        year = int(stock_date_str[:2])
        month = int(stock_date_str[2:4])
        day = int(stock_date_str[4:6])
        # MontBell 使用日本年号，但这里简化为公元年后两位 + 20
        full_year = 2000 + year
        return f'{full_year}/{month}/{day}'
    except (ValueError, IndexError):
        return None


def format_jpy(value):
    if value is None:
        return None
    try:
        return f'JPY{int(value):,}'
    except (ValueError, TypeError):
        return str(value)


def get_image_url(product, color_code):
    images = product.get('images', {})
    if isinstance(images, dict):
        color_img = images.get(color_code)
        if isinstance(color_img, dict):
            file_name = color_img.get('file_name')
            product_code = product.get('product_code', '')
            if file_name and product_code:
                return f'https://www.montbell.com/storage/products/images/origin/{file_name}'
    return None


def collect_montbell_stock(url):
    parsed_url = urlparse(url)
    base_url = f'{parsed_url.scheme}://{parsed_url.netloc}'

    html = fetch_page(url)
    product = extract_product_json(html)
    enums = extract_enums_json(html)

    if not product:
        raise ValueError('未找到商品数据')

    product_code = product.get('product_code', '')
    title = product.get('name') or product_code
    brand = product.get('brand', {}).get('name', 'Montbell') if isinstance(product.get('brand'), dict) else 'Montbell'

    colors = product.get('colors', {})
    skus = []
    first_color_code = None

    for color_code, color_data in colors.items():
        if first_color_code is None:
            first_color_code = color_code

        color_name = color_data.get('color_name_en') or color_data.get('color_name') or color_code
        sizes = color_data.get('sizes', {})

        for size_name, size_data in sizes.items():
            actually_stock = size_data.get('actually_stock_status', {})
            japan_stock_code = actually_stock.get('1', actually_stock.get(1, 4))
            stock_status = STOCK_STATUS_MAP.get(int(japan_stock_code), 'OUT_OF_STOCK')

            colorsize = size_data.get('colorsize', {})
            japan_colorsize = colorsize.get('1', colorsize.get(1, {}))
            price_intax = japan_colorsize.get('price_intax') if japan_colorsize else None
            price = format_jpy(price_intax)

            # 从 colorsize.stock_date 获取预计到货日期
            restock_date = None
            if stock_status == 'BACKORDER':
                stock_date = japan_colorsize.get('stock_date') if japan_colorsize else None
                restock_date = format_restock_date(stock_date)

            sku_code = f'{product_code}-{color_code}-{size_name}'

            skus.append({
                'skuCode': sku_code,
                'color': color_name,
                'colorCode': color_code,
                'size': size_name,
                'stockStatus': stock_status,
                'restockDate': restock_date,
                'price': price,
            })

    default_color = product.get('default_color_code') or first_color_code
    image_url = get_image_url(product, default_color)
    default_price = None
    if skus and skus[0].get('price'):
        default_price = skus[0]['price']

    return {
        'title': title,
        'brand': brand,
        'price': default_price,
        'imageUrl': image_url,
        'skus': skus,
    }


def main():
    if len(sys.argv) < 2:
        raise SystemExit('Usage: python montbell_stock.py <url>')

    url = sys.argv[1]

    try:
        result = collect_montbell_stock(url)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({
            'error': str(e),
            'title': 'Unknown',
            'brand': 'Montbell',
            'price': None,
            'imageUrl': None,
            'skus': [],
        }, ensure_ascii=False))
        sys.exit(1)


if __name__ == '__main__':
    main()
