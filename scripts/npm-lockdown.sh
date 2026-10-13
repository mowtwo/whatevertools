#!/usr/bin/env bash
# 发布权限收紧 + 清理占位版本（需要 2FA，在本机登录后手动跑）：
#   1. 每个包设为「必须 2FA、禁止 token 发布」，之后只能走 GitHub Actions 的可信发布（OIDC）
#   2. 把配置可信发布者时留下的 0.0.0-stage 占位版本标记为废弃
set -u
cd "$(dirname "$0")/.."
for f in packages/*/package.json; do
  [ "$(node -p "require('./$f').private === true")" = "true" ] && continue
  name=$(node -p "require('./$f').name")
  echo "== ${name}"
  npm access set mfa=publish "$name" || echo "   （设置发布权限失败：${name}）"
  if npm view "$name@0.0.0-stage" version >/dev/null 2>&1; then
    npm deprecate "$name@0.0.0-stage" "占位版本，请使用最新版" || echo "   （标记废弃失败：${name}）"
  fi
done
