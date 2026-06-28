# 跨境商品搬运系统第一阶段

## 技术栈
- 前端：Next.js 15 + TypeScript
- 后端：NestJS + Prisma
- 数据库：MySQL 8
- 采集器：Python 3 + requests + BeautifulSoup4

## 功能说明
- 后台页面输入商品 URL
- 后端接收 URL 并调用 Python 采集器
- 采集商品标题、价格、描述、品牌、图片、颜色、尺码、SKU
- 保存到 `products`、`product_images`、`product_skus`
- 返回商品详情页展示完整结果
- 提供商品管理后台，支持列表、详情、编辑、删除、搜索、品牌筛选、状态筛选、分页、图片预览与 SKU 编辑

## 目录结构
- `frontend`：Next.js 前端
- `backend`：NestJS 后端
- `collector`：Python 采集器
- `sql/init.sql`：数据库初始化 SQL
- `docker-compose.yml`：容器编排配置

## 本地启动
### 1. 启动 MySQL
可使用本地 MySQL 8，创建数据库后执行：

```bash
mysql -uroot -proot < sql/init.sql
```

### 2. 安装 Python 依赖
```bash
python3 -m pip install -r collector/requirements.txt
```

### 3. 启动后端
```bash
cd backend
npm install
npx prisma generate
npx prisma db push
npm run start:dev
```

### 4. 启动前端
```bash
cd frontend
npm install
npm run dev
```

### 5. 访问系统
- 前端地址：<http://localhost:3000>
- 后端健康检查：<http://localhost:3001/api/health>

## 商品管理后台
- 首页右侧提供“进入商品管理后台”入口
- 管理后台主路由为 `http://localhost:3000/products`
- 支持按关键字搜索标题、品牌、来源链接
- 支持按品牌和状态筛选，状态包括：`草稿`、`已发布`、`失败`
- 支持分页浏览、商品详情查看、商品编辑、商品删除
- 商品编辑页支持动态新增/删除 SKU，并编辑 SKU 图片 URL
- 详情页和列表页均支持商品图片与 SKU 图片预览

## Docker 启动
```bash
docker compose up --build
```

启动后访问：
- 前端：<http://localhost:3000>
- 后端：<http://localhost:3001/api/health>

## API
### 导入商品
```http
POST /api/products/import
Content-Type: application/json

{
  "url": "https://example.com/product/demo-item"
}
```

### 查询商品详情
```http
GET /api/products/:id
```

## 说明
- 采集器优先尝试解析真实页面中的 `og:*`、`JSON-LD` 与常见商品元信息
- 当目标站点无法直接访问或结构无法识别时，会自动返回可运行的演示采集结果，保证第一阶段链路完整可验证

## 前端开发说明
- 如果修改代码后遇到 `Cannot find module './xxx.js'` 或 `vendor-chunks` 相关报错，说明 Next.js 开发缓存残留
- 先停止当前前端进程，再执行下面命令重启：

```bash
cd frontend
npm run dev:reset
```

- 不要在清理 `.next` 缓存的同时并行执行 `next dev` 和 `next build`，否则可能出现临时构建异常

## 数据库同步说明
- 对已有本地数据库新增字段时，优先在 `backend` 目录执行 `npx prisma db push`
- 当前 Prisma schema 已与现有 MySQL `UNSIGNED` 主键结构对齐，可安全同步 `status` 等后台字段
