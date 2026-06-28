import { Database, ImageIcon, Tags } from 'lucide-react';

const cards = [
  {
    title: '采集字段',
    value: '8 项核心信息',
    description: '标题、价格、描述、品牌、图片、颜色、尺码、SKU。',
    icon: Tags,
  },
  {
    title: '落库结构',
    value: '3 张业务表',
    description: 'products、product_images、product_skus。',
    icon: Database,
  },
  {
    title: '图片处理',
    value: '多图画廊',
    description: '采集结果会按顺序展示并持久化排序信息。',
    icon: ImageIcon,
  },
];

export function StatusCards() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {cards.map(({ title, value, description, icon: Icon }) => (
        <div key={title} className="surface rounded-[24px] border border-white/10 p-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-white/60">{title}</p>
            <Icon className="h-5 w-5 text-accent" />
          </div>
          <p className="mt-8 text-2xl font-semibold text-white">{value}</p>
          <p className="mt-3 text-sm leading-6 text-slate-300">{description}</p>
        </div>
      ))}
    </div>
  );
}
