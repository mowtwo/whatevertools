// whatevertools init：生成配置文件，可选生成 CI 模板（GitHub Actions 三平台矩阵，签名凭据从 secrets 注入）
import fs from 'node:fs'
import path from 'node:path'

const CONFIG = (plugin: string, name: string) => `import { defineConfig } from '@whatevertools/cli'

export default defineConfig({
  // 插件目录（构建产物，含 plugin.json 或 whatevertools.json）或插件包（.upx / .asar / .zip），可以多个
  plugins: ${JSON.stringify(plugin)},
  // 默认目标；命令行 --target 或环境变量 WT_TARGET 可以覆盖
  targets: ['utools', 'electron', 'web'],
  out: 'release',
  productName: ${JSON.stringify(name)},
  electron: {
    // 出安装包：whatevertools build --target electron --binary
    binary: {
      formats: { mac: ['dmg', 'zip'], win: ['nsis'], linux: ['AppImage'] },
      // arch: ['arm64', 'x64'],
      // icon: 'build/icon.png', // 至少 512×512
    },
    // 证书和密码只从环境变量读：
    //   mac：CSC_LINK + CSC_KEY_PASSWORD（或钥匙串里的 Developer ID），公证用 APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER
    //   win：WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD，或 Azure Trusted Signing（AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET + 下面的 azure）
    sign: {
      // mac: { identity: false }, // 不签名
      // win: { mode: 'azure', azure: { endpoint: 'https://eus.codesigning.azure.net', certificateProfileName: '...', codeSigningAccountName: '...' } },
    },
  },
})
`

const WORKFLOW = `# 由 whatevertools init --ci github 生成：推送 v* 标签时在三个平台出安装包，挂到 GitHub Release
name: build-apps

on:
  push:
    tags: ['v*']
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: \${{ matrix.os }}
    # 签名凭据：在仓库 Settings → Secrets 里配置，没配的平台就不签名（doctor 会提示）
    env:
      CSC_LINK: \${{ matrix.os == 'macos-latest' && secrets.MAC_CSC_LINK || '' }}
      CSC_KEY_PASSWORD: \${{ matrix.os == 'macos-latest' && secrets.MAC_CSC_KEY_PASSWORD || '' }}
      APPLE_API_KEY_ID: \${{ secrets.APPLE_API_KEY_ID }}
      APPLE_API_ISSUER: \${{ secrets.APPLE_API_ISSUER }}
      WIN_CSC_LINK: \${{ secrets.WIN_CSC_LINK }}
      WIN_CSC_KEY_PASSWORD: \${{ secrets.WIN_CSC_KEY_PASSWORD }}
      AZURE_TENANT_ID: \${{ secrets.AZURE_TENANT_ID }}
      AZURE_CLIENT_ID: \${{ secrets.AZURE_CLIENT_ID }}
      AZURE_CLIENT_SECRET: \${{ secrets.AZURE_CLIENT_SECRET }}
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
      - run: npm ci
      - run: npm run build --if-present
      # 公证用的 .p8：secret 里放文件内容，这里写成文件
      - name: Apple API key
        if: runner.os == 'macOS'
        shell: bash
        env:
          APPLE_API_KEY_CONTENT: \${{ secrets.APPLE_API_KEY_CONTENT }}
        run: |
          if [ -n "$APPLE_API_KEY_CONTENT" ]; then
            echo "$APPLE_API_KEY_CONTENT" > "$RUNNER_TEMP/AuthKey.p8"
            echo "APPLE_API_KEY=$RUNNER_TEMP/AuthKey.p8" >> "$GITHUB_ENV"
          fi
      - run: npx whatevertools doctor --target electron --binary
      - run: npx whatevertools build --target electron --binary --json > build-result.json
      - uses: actions/upload-artifact@v4
        with:
          name: apps-\${{ matrix.os }}
          path: release/binaries/*
      - uses: softprops/action-gh-release@v2
        if: startsWith(github.ref, 'refs/tags/')
        with:
          files: release/binaries/*
`

export function init(o: { cwd: string; ci?: string; force?: boolean; log?: (s: string) => void }) {
  const log = o.log ?? console.log
  const written: string[] = []
  const write = (rel: string, content: string) => {
    const p = path.join(o.cwd, rel)
    if (fs.existsSync(p) && !o.force) {
      log(`跳过：${rel} 已存在（--force 覆盖）`)
      return
    }
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
    written.push(rel)
    log(`已生成 ${rel}`)
  }
  const plugin = ['dist', 'build', 'public', '.'].find((d) => fs.existsSync(path.join(o.cwd, d, 'plugin.json')) || fs.existsSync(path.join(o.cwd, d, 'whatevertools.json'))) ?? 'dist'
  let name = path.basename(o.cwd)
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(o.cwd, 'package.json'), 'utf8'))
    name = pkg.productName ?? pkg.name ?? name
  } catch {}
  write('whatevertools.config.ts', CONFIG(`./${plugin}`.replace('/./', '/').replace(/\/\.$/, ''), name))
  if (o.ci === 'github') write('.github/workflows/build-apps.yml', WORKFLOW)
  else if (o.ci) throw new Error(`不支持的 CI 模板：${o.ci}（目前有 github）`)
  return written
}
