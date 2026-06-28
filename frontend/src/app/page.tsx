import { AdminShell } from '@/components/admin-shell';
import { ImportPanel } from '@/components/import-panel';

export default function HomePage() {
  return (
    <AdminShell title="抓取商品">
      <div className="admin-import-wrap">
        <ImportPanel />
      </div>
    </AdminShell>
  );
}
