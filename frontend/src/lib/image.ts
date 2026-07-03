export function normalizeImageUrl(url: string | null | undefined): string {
  if (!url) return '';

  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }

  if (url.startsWith('/uploads/')) {
    return url;
  }

  if (url.startsWith('uploads/')) {
    return '/' + url;
  }

  if (url.startsWith('relative/uploads/')) {
    return url.replace('relative/uploads/', '/uploads/');
  }

  if (url.startsWith('/')) {
    return url;
  }

  return '/' + url;
}
