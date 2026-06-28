'use client';

import { AppstoreOutlined, InboxOutlined, SearchOutlined, SettingOutlined, StockOutlined } from '@ant-design/icons';
import { Layout, Typography } from 'antd';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const { Header, Content, Sider } = Layout;

interface AdminShellProps {
  title: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}

export function AdminShell({ title, extra, children }: AdminShellProps) {
  const pathname = usePathname();
  const navItems = [
    {
      key: '/',
      href: '/',
      icon: <SearchOutlined />,
      label: '抓取商品',
    },
    {
      key: '/products',
      href: '/products',
      icon: <InboxOutlined />,
      label: '商品管理',
    },
    {
      key: '/stock-monitor',
      href: '/stock-monitor',
      icon: <StockOutlined />,
      label: '库存看板',
    },
    {
      key: '/model-prompts',
      href: '/model-prompts',
      icon: <SettingOutlined />,
      label: '模型提示词',
    },
  ];

  return (
    <Layout className="admin-layout">
      <Sider breakpoint="lg" collapsedWidth="0" width={190} className="admin-sider">
        <div className="admin-brand">小人鱼妈妈日本代购</div>
        <nav className="admin-nav">
          {navItems.map((item) => {
            const active = item.key === '/' ? pathname === '/' : pathname.startsWith(item.key);
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`admin-nav-item${active ? ' admin-nav-item-active' : ''}`}
              >
                <span className="admin-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </Sider>
      <Layout className="admin-main">
        <Header className="admin-header">
          <div className="admin-header-title">
            <AppstoreOutlined className="admin-header-icon" />
            <Typography.Title level={4} style={{ margin: 0, color: '#f6fbff' }}>
              {title}
            </Typography.Title>
          </div>
          {extra}
        </Header>
        <Content className="admin-content">{children}</Content>
      </Layout>
    </Layout>
  );
}
