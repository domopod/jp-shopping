import type { Metadata } from 'next';
import 'antd/dist/reset.css';
import './globals.css';

export const metadata: Metadata = {
  title: '跨境商品搬运系统',
  description: '输入商品 URL，抓取商品并落库。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
