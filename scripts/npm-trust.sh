#!/usr/bin/env bash
# 给所有 @whatevertools/* 包配置 npm 可信发布者（GitHub Actions 的 release.yml）。
# 已经配置过的包跳过；包还没发布过也可以先配（配完 2 天内要有一次成功发布）。
set -u
cd "$(dirname "$0")/.."
for f in packages/*/package.json; do
  [ "$(node -p "require('./$f').private === true")" = "true" ] && continue
  name=$(node -p "require('./$f').name")
  if npm trust list "${name}" --json 2>/dev/null | grep -q 'release.yml'; then
    echo "== ${name}：已配置，跳过"
    continue
  fi
  echo "== ${name}"
  npm trust github "${name}" --repo mowtwo/whatevertools --file release.yml --allow-publish --yes || echo "   （没有配置成功：${name}）"
done
