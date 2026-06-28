#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "=== 拉取最新代码 ==="
git pull

echo ""
echo "=== 检查 package.json 变更 ==="
BACKEND_DEPS_CHANGED=$(git diff HEAD@{1} HEAD --name-only 2>/dev/null | grep -c "backend/package.json" || true)
FRONTEND_DEPS_CHANGED=$(git diff HEAD@{1} HEAD --name-only 2>/dev/null | grep -c "frontend/package.json" || true)

if [ "$BACKEND_DEPS_CHANGED" -gt 0 ]; then
  echo "检测到后端依赖变更，正在安装..."
  cd backend && npm install
  cd ..
fi

if [ "$FRONTEND_DEPS_CHANGED" -gt 0 ]; then
  echo "检测到前端依赖变更，正在安装..."
  cd frontend && npm install
  cd ..
fi

echo ""
echo "=== 同步数据库结构 ==="
cd backend && npx prisma db push
cd ..

echo ""
echo "=== 检查 schema 变更 ==="
SCHEMA_CHANGED=$(git diff HEAD@{1} HEAD --name-only 2>/dev/null | grep -c "backend/prisma/schema.prisma" || true)

if [ "$SCHEMA_CHANGED" -gt 0 ]; then
  echo ""
  echo "⚠️  注意：数据库结构已更新"
fi

echo ""
echo "✅ 更新完成！"
echo ""
echo "如果后端服务正在运行，需要重启才能生效。"
