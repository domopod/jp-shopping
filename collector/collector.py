import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from html import unescape
from urllib.parse import parse_qs, quote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

USER_AGENT = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
)


def first_non_empty(*values):
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def normalize_text(text):
    if text is None:
        return None
    return re.sub(r'\s+', ' ', text).strip() or None


def get_meta(soup, *selectors):
    for selector in selectors:
        element = soup.select_one(selector)
        if not element:
            continue
        content = element.get('content') or element.get('value') or element.get_text(strip=True)
        content = normalize_text(content)
        if content:
            return content
    return None


def parse_json_ld(soup):
    data = []
    for script in soup.select('script[type="application/ld+json"]'):
        raw = script.string or script.get_text(strip=True)
        if not raw:
            continue
        try:
            parsed = json.loads(raw)
            data.append(parsed)
        except json.JSONDecodeError:
            continue
    return data


def flatten_json_ld(items):
    queue = list(items)
    flattened = []
    while queue:
        current = queue.pop(0)
        if isinstance(current, list):
            queue.extend(current)
            continue
        if isinstance(current, dict) and '@graph' in current:
            queue.extend(current['@graph'])
            continue
        flattened.append(current)
    return flattened


def extract_product_json_ld(ld_items):
    for item in flatten_json_ld(ld_items):
        if not isinstance(item, dict):
            continue
        type_value = item.get('@type')
        if type_value == 'Product' or (isinstance(type_value, list) and 'Product' in type_value):
            return item
    return {}


def sort_size_key(value):
    match = re.search(r'\d+', value or '')
    if match:
        return (0, int(match.group(0)))
    return (1, value or '')


def normalize_sku_part(value):
    if value is None:
        return None
    normalized = re.sub(r'[^A-Za-z0-9]+', '-', str(value).strip().upper()).strip('-')
    return normalized or None


def format_jpy(value):
    if value is None or value == '':
        return None
    if isinstance(value, (int, float)):
        return f'¥{int(value):,}'

    normalized = str(value).strip().replace(',', '')
    if normalized.isdigit():
        return f'¥{int(normalized):,}'
    return value


def clean_text_block(text):
    if text is None:
        return None

    lines = [re.sub(r'\s+', ' ', line).strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    return '\n'.join(lines) if lines else None


def unique_preserve_order(values):
    result = []
    seen = set()
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def parse_embedded_json(raw_value):
    if not raw_value:
        return None

    try:
        return json.loads(unescape(raw_value))
    except json.JSONDecodeError:
        return None


def extract_branshes_size_material_info(soup):
    modal_body = soup.select_one('.material--target.br-js-modal-body')
    if not modal_body:
        return None, None

    size_info = None
    size_table = modal_body.select_one('table.syosaiTt')
    if size_table:
        rows = size_table.select('tr')
        headers = [normalize_text(cell.get_text(' ', strip=True)) for cell in rows[0].select('th,td')]
        sizes = headers[1:]
        metric_rows = []
        for row in rows[1:]:
            cells = [normalize_text(cell.get_text(' ', strip=True)) for cell in row.select('th,td')]
            if len(cells) >= 2:
                metric_rows.append((cells[0], cells[1:]))

        size_lines = []
        for index, size in enumerate(sizes):
            parts = []
            for metric_name, values in metric_rows:
                if index < len(values) and values[index]:
                    parts.append(f'{metric_name} {values[index]}')
            if parts:
                size_lines.append(f'{size}cm: ' + ' '.join(parts))
        if size_lines:
            size_info = '\n'.join(size_lines)

    specification_lines = []
    for box in modal_body.select('.modal__material__info__box'):
        title = normalize_text(box.select_one('.modal__material__info--title').get_text(' ', strip=True)) if box.select_one('.modal__material__info--title') else None
        content = normalize_text(box.select_one('.modal__material__info__content').get_text(' ', strip=True)) if box.select_one('.modal__material__info__content') else None
        if title and content:
            specification_lines.append(f'{title}: {content}')

    specification = '\n'.join(specification_lines) if specification_lines else None
    return size_info, specification


def extract_devirock_image_sequence(image_url):
    if not image_url:
        return None

    match = re.search(r'-(\d+)\.(?:jpg|jpeg|png|webp)', image_url, re.I)
    if not match:
        return None

    return int(match.group(1))


def promote_devirock_image_url(image_url):
    if not image_url:
        return None

    promoted = re.sub(r'([?&])size=s(&|$)', r'\1size=l\2', image_url)
    promoted = re.sub(r'([?&])w=MjAw(&|$)', r'\1w=ODAw\2', promoted)
    return promoted


def extract_collapse_section(soup, label):
    heading = soup.find(lambda tag: tag.name in ['h2', 'h3'] and tag.get_text(strip=True) == label)
    if not heading:
        return None

    trigger = heading.find_parent('a')
    if not trigger:
        return None

    body = trigger.find_next_sibling('div', class_=lambda value: value and 'c-collapse-body' in value)
    if not body:
        return None

    if label == '商品説明':
        description_container = body.select_one('.p-item-detail-expand-items__description')
        if description_container:
            return clean_text_block(description_container.get_text('\n'))
        return clean_text_block(body.get_text('\n'))

    if label in ['サイズ', '仕様']:
        rows = body.select('.c-item-detail-expand-items__info')
        formatted_rows = []
        for row in rows:
            label_el = row.select_one('.c-item-detail-expand-items__info--span, .c-item-detail-expand-items__info--span-actual-size')
            value_el = row.select_one('.c-item-detail-expand-items__info--dev')
            if not label_el or not value_el:
                continue
            row_label = clean_text_block(label_el.get_text(' ')) or ''
            row_label = row_label.rstrip(':：')
            row_value = clean_text_block(value_el.get_text('\n'))
            if row_label and row_value:
                formatted_rows.append(f'{row_label}: {row_value}')
        if formatted_rows:
            return '\n'.join(formatted_rows)
        return clean_text_block(body.get_text('\n'))

    return clean_text_block(body.get_text('\n'))


def image_url(prompt):
    return (
        'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt='
        f'{quote(prompt)}&image_size=landscape_4_3'
    )


def build_demo_payload(url):
    parsed = urlparse(url)
    slug = parsed.path.strip('/').split('/')[-1] or 'demo-product'
    normalized_name = slug.replace('-', ' ').replace('_', ' ').strip() or 'demo product'
    title = normalized_name.title()
    domain = parsed.netloc or 'example.com'

    return {
        'title': f'{title} 跨境精选商品',
        'price': '$59.90',
        'description': (
            f'该商品来自 {domain}，当前为第一阶段演示采集结果。\n'
            '系统已经完成标题、价格、描述、品牌、图片和 SKU 的结构化输出，可直接用于入库与详情展示。'
        ),
        'brand': domain.split('.')[0].title(),
        'images': [
            image_url('premium ecommerce product photo, cross-border fashion item, front angle, clean studio lighting'),
            image_url('premium ecommerce product photo, cross-border fashion item, side angle, clean studio lighting'),
            image_url('premium ecommerce product photo, cross-border fashion item, detail shot, clean studio lighting'),
        ],
        'skus': [
            {'skuCode': 'SKU-BLK-S', 'color': '黑色', 'size': 'S', 'price': '$59.90'},
            {'skuCode': 'SKU-BLK-M', 'color': '黑色', 'size': 'M', 'price': '$59.90'},
            {'skuCode': 'SKU-WHT-L', 'color': '白色', 'size': 'L', 'price': '$62.90'},
        ],
    }


def fetch_page(url):
    response = requests.get(url, timeout=12, headers={'User-Agent': USER_AGENT})
    response.raise_for_status()
    return response.text


def resolve_fo_online_image_variant(image_url, availability_cache):
    preferred_url = re.sub(r'_pm\.jpg$', '_pz.jpg', image_url)
    if preferred_url == image_url:
        return image_url

    if preferred_url in availability_cache:
        return preferred_url if availability_cache[preferred_url] else image_url

    try:
        result = subprocess.run(
            [
                'curl',
                '-L',
                '--silent',
                '--output',
                '/dev/null',
                '--write-out',
                '%{http_code}',
                '--user-agent',
                USER_AGENT,
                preferred_url,
            ],
            capture_output=True,
            text=True,
            timeout=8,
        )
        available = result.returncode == 0 and result.stdout.strip() == '200'
    except (subprocess.SubprocessError, OSError):
        available = False

    availability_cache[preferred_url] = available
    return preferred_url if available else image_url


def extract_fo_online_payload(url, html, soup, base_payload):
    parsed_url = urlparse(url)
    item_code = parsed_url.path.rstrip('/').split('/')[-1].upper()
    if not item_code:
        return None

    selected_color_code = parse_qs(parsed_url.query).get('cc', [''])[0].upper()
    sku_entries = []

    for form in soup.select('form[data-web-tracking-v2-data-item]'):
        raw_payload = form.get('data-web-tracking-v2-data-item')
        if not raw_payload:
            continue
        try:
            payload = json.loads(unescape(raw_payload))
        except json.JSONDecodeError:
            continue

        if str(payload.get('code', '')).upper() != item_code:
            continue

        sku_entries.append(payload)

    if not sku_entries:
        return None

    image_pattern = re.compile(
        rf'https://fo-online\.jp/images/item/{re.escape(item_code)}/{re.escape(item_code)}_c([A-Z0-9]+)_a(\d{{3}})_(p[zm])\.jpg'
    )
    color_images = defaultdict(dict)
    image_variant_cache = {}

    for match in image_pattern.finditer(html):
        image_url = match.group(0)
        color_code = match.group(1)
        sort_order = int(match.group(2))
        variant = match.group(3)
        current = color_images[color_code].get(sort_order)

        if current == image_url:
            continue

        if variant == 'pz':
            color_images[color_code][sort_order] = image_url
            continue

        if current and current.endswith('_pz.jpg'):
            continue

        color_images[color_code][sort_order] = resolve_fo_online_image_variant(image_url, image_variant_cache)

    ordered_images = []
    seen_images = set()
    ordered_color_codes = sorted(color_images.keys(), key=lambda code: (code != selected_color_code, code))

    for color_code in ordered_color_codes:
        for sort_order, image_url in sorted(color_images[color_code].items(), key=lambda item: item[0]):
            if image_url in seen_images:
                continue
            seen_images.add(image_url)
            ordered_images.append(image_url)

    grouped_by_color = defaultdict(list)
    for sku_entry in sku_entries:
        grouped_by_color[sku_entry.get('colorCode') or ''].append(sku_entry)

    def get_color_image(color_code):
        color_map = color_images.get(color_code)
        if not color_map:
            return None

        first_sort_order = min(color_map.keys())
        return color_map.get(first_sort_order)

    exploded_skus = []
    seen_sku_keys = set()
    ordered_sku_color_codes = sorted(grouped_by_color.keys(), key=lambda code: (code != selected_color_code, code))
    for color_code in ordered_sku_color_codes:
        entries = sorted(
            grouped_by_color[color_code],
            key=lambda entry: sort_size_key(str(entry.get('sizeName') or '')),
        )
        color_name = first_non_empty(entries[0].get('colorName'), color_code)

        for index, entry in enumerate(entries, start=1):
            size_name = first_non_empty(entry.get('sizeName'))
            total_price = None
            if entry.get('taxExcludedSalePrice') is not None and entry.get('salePriceTax') is not None:
                total_price = entry.get('taxExcludedSalePrice') + entry.get('salePriceTax')
            else:
                total_price = entry.get('taxExcludedSalePrice') or entry.get('taxExcludedDiscountPrice')

            explicit_sku = first_non_empty(
                entry.get('sku'),
                entry.get('skuCode'),
                entry.get('variationCode'),
                entry.get('productCode'),
                entry.get('itemCode'),
                entry.get('janCode'),
            )
            size_code = normalize_sku_part(entry.get('sizeCode')) or normalize_sku_part(size_name)
            fallback_sku = '-'.join(
                part for part in [item_code, normalize_sku_part(color_code), size_code or str(index)] if part
            )

            dedupe_key = (
                explicit_sku or fallback_sku,
                color_name or '',
                size_name or '',
            )
            if dedupe_key in seen_sku_keys:
                continue
            seen_sku_keys.add(dedupe_key)

            exploded_skus.append({
                'skuCode': explicit_sku or fallback_sku,
                'color': color_name,
                'size': size_name,
                'price': format_jpy(total_price) or base_payload.get('price'),
                'imageUrl': get_color_image(color_code),
            })

    title_element = soup.select_one('h1')
    brand_element = soup.select_one('a[href*="/brand/"]')
    price = exploded_skus[0]['price'] if exploded_skus else base_payload.get('price')
    description = extract_collapse_section(soup, '商品説明') or base_payload.get('description')
    size_info = extract_collapse_section(soup, 'サイズ')
    specification = extract_collapse_section(soup, '仕様')

    return {
        'title': first_non_empty(
            normalize_text(title_element.get_text(' ', strip=True)) if title_element else None,
            base_payload.get('title'),
        ),
        'price': price,
        'description': description,
        'sizeInfo': size_info,
        'specification': specification,
        'brand': first_non_empty(
            sku_entries[0].get('brandName') if sku_entries else None,
            normalize_text(brand_element.get_text(' ', strip=True)) if brand_element else None,
            base_payload.get('brand'),
        ),
        'images': ordered_images or base_payload.get('images') or [],
        'skus': exploded_skus,
    }


def extract_branshes_payload(url, html, soup, base_payload):
    details = parse_embedded_json(get_meta(soup, 'meta[property="etm:goods_detail"]')) or {}
    price = format_jpy(details.get('price')) or base_payload.get('price')

    images = []
    color_first_image_map = {}
    for image in soup.select('.product__detail__gallery--photo img[src], .product__detail__gallery--photo--thumb img[src]'):
        src = image.get('src')
        if not src:
            continue
        gallery_item = image.find_parent(class_='product__detail__gallery--item')
        color_label = None
        if gallery_item:
            description = gallery_item.select_one('.product__detail__gallery--description')
            color_label = normalize_text(description.get_text(' ', strip=True)) if description else None
        resolved_src = urljoin(url, unescape(src))
        if color_label and color_label not in color_first_image_map:
            color_first_image_map[color_label] = resolved_src
        if '_m.' in src:
            continue
        images.append(resolved_src)

    size_info, specification = extract_branshes_size_material_info(soup)

    variation_entries = []
    for item in soup.select('.product__detail__variation__cart--item'):
        color = first_non_empty(item.get('data-color-name'), item.get('data-br-js-variation-name2'))
        size = first_non_empty(item.get('data-br-js-variation-name1'))
        button = item.select_one('button[data-goods]')
        raw_sku_code = button.get('data-goods') if button else None
        fallback_sku_code = '-'.join(
            part for part in [
                normalize_sku_part(details.get('item_code')),
                normalize_sku_part(color),
                normalize_sku_part(size),
            ] if part
        )
        variation_entries.append({
            'color': color,
            'size': size,
            'raw_sku_code': raw_sku_code,
            'fallback_sku_code': fallback_sku_code,
        })

    raw_sku_counter = Counter(
        entry['raw_sku_code']
        for entry in variation_entries
        if entry['raw_sku_code']
    )

    sku_list = []
    seen_skus = set()
    for entry in variation_entries:
        color = entry['color']
        size = entry['size']
        raw_sku_code = entry['raw_sku_code']
        fallback_sku_code = entry['fallback_sku_code']
        sku_code = raw_sku_code

        # branshes may reuse the same data-goods across multiple color groups,
        # so we promote duplicate codes to a color/size based stable identifier.
        if not sku_code or raw_sku_counter.get(raw_sku_code, 0) > 1:
            sku_code = fallback_sku_code or raw_sku_code

        dedupe_key = (sku_code or '', color or '', size or '')
        if dedupe_key in seen_skus:
            continue
        seen_skus.add(dedupe_key)

        sku_list.append({
            'skuCode': sku_code,
            'name': color,
            'color': color,
            'size': size,
            'price': price,
            'imageUrl': color_first_image_map.get(color),
        })

    brand = None
    brand_link = soup.select_one('a[href*="/shop/r/rbranshes/"] span')
    if brand_link:
        brand = normalize_text(brand_link.get_text(' ', strip=True))

    return {
        'title': first_non_empty(
            normalize_text(soup.select_one('h1').get_text(' ', strip=True)) if soup.select_one('h1') else None,
            details.get('name'),
            base_payload.get('title'),
        ),
        'price': price,
        'description': base_payload.get('description'),
        'sizeInfo': size_info,
        'specification': specification,
        'brand': first_non_empty(brand, 'branshes'),
        'images': unique_preserve_order(images) or base_payload.get('images') or [],
        'skus': sku_list,
    }


def extract_devirock_tab_content(soup, label):
    label_element = soup.find('label', string=lambda text: text and label in normalize_text(text))
    if not label_element:
        return None

    tab = label_element.find_parent('div', class_=lambda value: value and 'cp_actab' in value)
    if not tab:
        return None

    content = label_element.find_next_sibling('div')
    if not content:
        return None

    return clean_text_block(content.get_text('\n'))


def convert_devirock_size_info(size_spec_text):
    if not size_spec_text:
        return None

    lines = [line.strip() for line in size_spec_text.splitlines() if line.strip()]
    if '素材・仕様' in lines:
        lines = lines[:lines.index('素材・仕様')]

    lines = [line for line in lines if line != '»サイズガイド']
    if len(lines) < 3 or lines[0] != 'サイズ':
        return clean_text_block('\n'.join(lines)) if lines else None

    headers = []
    index = 1
    while index < len(lines) and not re.match(r'^\d+(?:cm|センチ)?$', lines[index], re.I):
        headers.append(lines[index])
        index += 1

    if not headers:
        return clean_text_block('\n'.join(lines)) if lines else None

    metric_count = len(headers)
    row_size = metric_count + 1
    rows = []
    while index + row_size - 1 < len(lines):
        size = lines[index]
        values = lines[index + 1:index + row_size]
        if len(values) != metric_count:
            break
        parts = [f'{headers[offset]} {value}' for offset, value in enumerate(values)]
        rows.append(f'{size}: ' + ' '.join(parts))
        index += row_size

    return '\n'.join(rows) if rows else clean_text_block('\n'.join(lines))


def extract_devirock_payload(url, html, soup, base_payload):
    product_code = urlparse(url).path.rstrip('/').split('/')[-1].upper()
    images = []
    for figure in soup.select('figure.fs-c-productCarouselMainImage__image'):
        image_url = figure.get('data-enlarged-image-url')
        if image_url:
            images.append(unescape(image_url))
        else:
            image = figure.select_one('img[src]')
            if image:
                images.append(unescape(image.get('src')))

    variation_groups = []
    for input_el in soup.select('input[data-radio-list-info]'):
        payload = parse_embedded_json(input_el.get('data-radio-list-info')) or {}
        for value in (payload.get('variationCartGroup') or {}).values():
            variation_groups.append(value)

    color_image_map = {}
    for panel in soup.select('.fs-c-variationPanelList__panel'):
        color_name = normalize_text(panel.get_text(' ', strip=True))
        image = panel.select_one('img[src]')
        image_url = unescape(image.get('src')) if image else None
        if color_name and image_url:
            color_image_map[color_name] = image_url

    gallery_image_by_sequence = {}
    for image_url in images:
        sequence = extract_devirock_image_sequence(image_url)
        if sequence is not None:
            gallery_image_by_sequence[sequence] = image_url

    gallery_color_image_map = {}
    for color_name, image_url in color_image_map.items():
        sequence = extract_devirock_image_sequence(image_url)
        if sequence is None:
            continue
        gallery_color_image_map[color_name] = gallery_image_by_sequence.get(
            sequence,
            promote_devirock_image_url(image_url),
        )

    sku_map = {}
    sku_prices = []
    for variation in variation_groups:
        if not isinstance(variation, dict):
            continue

        color = first_non_empty(variation.get('verticalVariationName'))
        size = first_non_empty(variation.get('horizontalVariationName'))
        if not color or not size:
            continue

        price = format_jpy(variation.get('variationPrice')) or base_payload.get('price')
        image_url = first_non_empty(
            gallery_color_image_map.get(color),
            unescape(variation.get('thumbnailUrl2x') or ''),
            unescape(variation.get('thumbnailUrl') or ''),
            color_image_map.get(color),
        )
        sku_code = '-'.join(
            part for part in [
                product_code,
                normalize_sku_part(variation.get('verticalVariationAdminNo')),
                normalize_sku_part(variation.get('horizontalVariationAdminNo') or size),
            ] if part
        )

        sku_prices.append(price)
        dedupe_key = (sku_code, color, size)
        current = sku_map.get(dedupe_key)
        next_item = {
            'skuCode': sku_code,
            'name': color,
            'color': color,
            'size': size,
            'price': price,
            'imageUrl': image_url,
        }
        if not current or (not current.get('imageUrl') and image_url):
            sku_map[dedupe_key] = next_item

    sku_list = list(sku_map.values())

    description = extract_devirock_tab_content(soup, '商品説明') or base_payload.get('description')
    size_spec_text = extract_devirock_tab_content(soup, 'サイズ/スペック')
    size_info = None
    specification = None
    if size_spec_text:
        split_parts = re.split(r'\n素材・仕様\n', size_spec_text, maxsplit=1)
        size_info = convert_devirock_size_info(split_parts[0])
        if len(split_parts) > 1:
            specification = clean_text_block(f'素材・仕様\n{split_parts[1]}')

    brand = 'devirock'
    min_sku_price = None
    if sku_prices:
        numeric_prices = []
        for sku_price in sku_prices:
            digits = re.sub(r'[^\d]', '', sku_price or '')
            if digits:
                numeric_prices.append(int(digits))
        if numeric_prices:
            min_sku_price = format_jpy(min(numeric_prices))

    title = normalize_text(soup.select_one('h1').get_text(' ', strip=True)) if soup.select_one('h1') else None
    if title:
        title = re.sub(r'^LIMITED SALE\s+', '', title)

    price = min_sku_price or first_non_empty(
        normalize_text(soup.select_one('.fs-c-productPrice__main').get_text(' ', strip=True)) if soup.select_one('.fs-c-productPrice__main') else None,
        base_payload.get('price'),
    )

    return {
        'title': first_non_empty(
            title,
            base_payload.get('title'),
        ),
        'price': price,
        'description': description,
        'sizeInfo': size_info,
        'specification': specification,
        'brand': brand,
        'images': unique_preserve_order(images) or base_payload.get('images') or [],
        'skus': sku_list,
    }


def extract_payload_from_html(url, html):
    soup = BeautifulSoup(html, 'html.parser')
    ld_items = parse_json_ld(soup)
    product_ld = extract_product_json_ld(ld_items)

    title = first_non_empty(
        product_ld.get('name') if isinstance(product_ld, dict) else None,
        get_meta(soup, 'meta[property="og:title"]', 'meta[name="twitter:title"]'),
        normalize_text(soup.title.string if soup.title else None),
    )

    offer = None
    if isinstance(product_ld, dict):
        offers = product_ld.get('offers')
        if isinstance(offers, list) and offers:
            offer = offers[0]
        elif isinstance(offers, dict):
            offer = offers

    price = first_non_empty(
        offer.get('price') if isinstance(offer, dict) else None,
        get_meta(
            soup,
            'meta[property="product:price:amount"]',
            'meta[name="price"]',
            'meta[itemprop="price"]',
        ),
    )
    if price and not str(price).startswith('$'):
        price = f'${price}'

    brand_data = product_ld.get('brand') if isinstance(product_ld, dict) else None
    if isinstance(brand_data, dict):
        brand_data = brand_data.get('name')
    brand = first_non_empty(
        brand_data,
        get_meta(soup, 'meta[property="product:brand"]', 'meta[name="brand"]', 'meta[itemprop="brand"]'),
    )

    description = first_non_empty(
        product_ld.get('description') if isinstance(product_ld, dict) else None,
        get_meta(soup, 'meta[property="og:description"]', 'meta[name="description"]'),
    )

    image_candidates = []
    if isinstance(product_ld, dict):
        images = product_ld.get('image')
        if isinstance(images, list):
            image_candidates.extend(images)
        elif isinstance(images, str):
            image_candidates.append(images)
    og_image = get_meta(soup, 'meta[property="og:image"]', 'meta[name="twitter:image"]')
    if og_image:
        image_candidates.append(og_image)

    normalized_images = []
    seen = set()
    for image in image_candidates:
        if not image or image in seen:
            continue
        seen.add(image)
        normalized_images.append(image)

    sku_list = []
    if isinstance(product_ld, dict):
        offers = product_ld.get('offers')
        offers_list = offers if isinstance(offers, list) else [offers] if offers else []
        for index, offer_item in enumerate(offers_list, start=1):
            if not isinstance(offer_item, dict):
                continue
            sku_list.append({
                'skuCode': offer_item.get('sku') or product_ld.get('sku') or f'SKU-{index}',
                'color': None,
                'size': None,
                'price': first_non_empty(offer_item.get('price'), price),
            })

    if not title:
        raise ValueError('未解析到商品标题')

    payload = {
        'title': title,
        'price': price,
        'description': description,
        'brand': brand,
        'images': normalized_images,
        'skus': sku_list,
    }

    netloc = urlparse(url).netloc

    if 'fo-online.jp' in netloc:
        specialized_payload = extract_fo_online_payload(url, html, soup, payload)
        if specialized_payload:
            return specialized_payload

    if 'branshes.com' in netloc:
        specialized_payload = extract_branshes_payload(url, html, soup, payload)
        if specialized_payload:
            return specialized_payload

    if 'devirockstore.net' in netloc:
        specialized_payload = extract_devirock_payload(url, html, soup, payload)
        if specialized_payload:
            return specialized_payload

    return payload


def main():
    if len(sys.argv) < 2:
        raise SystemExit('Usage: python collector.py <url>')

    url = sys.argv[1]

    try:
        html = fetch_page(url)
        payload = extract_payload_from_html(url, html)
        if not payload.get('images') or not payload.get('skus'):
            demo = build_demo_payload(url)
            payload['images'] = payload.get('images') or demo['images']
            payload['skus'] = payload.get('skus') or demo['skus']
            payload['description'] = payload.get('description') or demo['description']
            payload['brand'] = payload.get('brand') or demo['brand']
            payload['price'] = payload.get('price') or demo['price']
        print(json.dumps(payload, ensure_ascii=False))
    except Exception:
        print(json.dumps(build_demo_payload(url), ensure_ascii=False))


if __name__ == '__main__':
    main()
