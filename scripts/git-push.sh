#!/bin/bash
set -e

cd "$(dirname "$0")/.."

if [ -z "$(git status --porcelain)" ]; then
  echo "没有需要提交的更改。"
  exit 0
fi

echo "=== 检测到以下更改 ==="
git status --short
echo ""

echo "=== 正在添加所有更改 ==="
git add .

echo "=== 生成提交信息 ==="
CHANGED_FILES=$(git diff --cached --name-only)
COMMIT_MSG=""

FRONTEND_CHANGES=()
BACKEND_CHANGES=()
DB_CHANGES=()
COLLECTOR_CHANGES=()
OTHER_CHANGES=()

for file in $CHANGED_FILES; do
  case "$file" in
    frontend/*)
      BASENAME=$(basename "$file")
      FRONTEND_CHANGES+=("$BASENAME")
      ;;
    backend/src/*)
      BASENAME=$(basename "$file")
      BACKEND_CHANGES+=("$BASENAME")
      ;;
    backend/prisma/*)
      BASENAME=$(basename "$file")
      DB_CHANGES+=("$BASENAME")
      ;;
    collector/*)
      BASENAME=$(basename "$file")
      COLLECTOR_CHANGES+=("$BASENAME")
      ;;
    *)
      BASENAME=$(basename "$file")
      OTHER_CHANGES+=("$BASENAME")
      ;;
  esac
done

if [ ${#DB_CHANGES[@]} -gt 0 ]; then
  COMMIT_MSG="${COMMIT_MSG}feat(db): 数据库结构更新 (${DB_CHANGES[*]})"$'\n'
fi

if [ ${#FRONTEND_CHANGES[@]} -gt 0 ]; then
  FILE_LIST=$(IFS='、'; echo "${FRONTEND_CHANGES[*]}")
  if [ ${#FRONTEND_CHANGES[@]} -gt 3 ]; then
    FILE_LIST="${FRONTEND_CHANGES[0]}、${FRONTEND_CHANGES[1]} 等${#FRONTEND_CHANGES[@]}个文件"
  fi
  COMMIT_MSG="${COMMIT_MSG}feat(frontend): 前端功能更新 - ${FILE_LIST}"$'\n'
fi

if [ ${#BACKEND_CHANGES[@]} -gt 0 ]; then
  FILE_LIST=$(IFS='、'; echo "${BACKEND_CHANGES[*]}")
  if [ ${#BACKEND_CHANGES[@]} -gt 3 ]; then
    FILE_LIST="${BACKEND_CHANGES[0]}、${BACKEND_CHANGES[1]} 等${#BACKEND_CHANGES[@]}个文件"
  fi
  COMMIT_MSG="${COMMIT_MSG}feat(backend): 后端功能更新 - ${FILE_LIST}"$'\n'
fi

if [ ${#COLLECTOR_CHANGES[@]} -gt 0 ]; then
  FILE_LIST=$(IFS='、'; echo "${COLLECTOR_CHANGES[*]}")
  COMMIT_MSG="${COMMIT_MSG}feat(collector): 采集器更新 - ${FILE_LIST}"$'\n'
fi

if [ ${#OTHER_CHANGES[@]} -gt 0 ]; then
  FILE_LIST=$(IFS='、'; echo "${OTHER_CHANGES[*]}")
  COMMIT_MSG="${COMMIT_MSG}chore: 其他更新 - ${FILE_LIST}"$'\n'
fi

if [ -z "$COMMIT_MSG" ]; then
  COMMIT_MSG="chore: 更新代码"
fi

FIRST_LINE=$(echo "$COMMIT_MSG" | head -1)
echo "提交信息: $FIRST_LINE"
echo ""

git commit -m "$COMMIT_MSG"

echo ""
echo "=== 正在推送到远程仓库 ==="
git push

echo ""
echo "✅ 推送完成！"
