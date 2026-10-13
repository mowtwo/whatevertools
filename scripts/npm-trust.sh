#!/usr/bin/env bash
# 给所有已发布的 @whatevertools/* 包配置 npm 可信发布者（GitHub Actions 的 release.yml）。
# 新增包时：先手动发布一次，再跑这个脚本。已经配置过的包 npm 会报错，忽略即可。
set -u
cd "$(dirname "$0")/.."
for f in packages/*/package.json; do
  name=$(node -p "require('./$f').name")
  [ "$(node -p "require('./$f').private === true")" = "true" ] && continue
  echo "== $name"
  npm trust github "$name" --repo mowtwo/whatevertools --file release.yml --allow-publish --yes || echo "   （跳过：$name）"
done
