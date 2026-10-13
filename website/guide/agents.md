# 给 AI Agent

whatevertools 为 AI 编程 Agent（Claude Code 等）准备了两样东西：

## Agent skill

一份 skill：什么时候该看哪份参考、动手前要知道的核心概念、工作规则（先查支持程度、不编造 API、凭据只走环境变量……），以及移植、宿主、打包、API 支持表四份参考。

```bash
npx whatevertools skill                 # 装进当前项目的 .claude/skills/whatevertools
npx whatevertools skill --dir ~/.claude/skills   # 装成全局 skill
```

也可以直接下载：[SKILL.md](/skills/whatevertools/SKILL.md) · [porting.md](/skills/whatevertools/references/porting.md) · [hosts.md](/skills/whatevertools/references/hosts.md) · [packaging.md](/skills/whatevertools/references/packaging.md) · [api-support.md](/skills/whatevertools/references/api-support.md)

## llms.txt

- [/llms.txt](/llms.txt)：站点索引，按 [llms.txt 约定](https://llmstxt.org/) 列出每篇文档的地址和一句话说明。
- [/llms-full.txt](/llms-full.txt)：所有文档合成的一个纯文本文件，直接塞进 Agent 的上下文。

## 给 Agent 的提示

> 用 whatevertools 把 ./dist 里的 uTools 插件打成 Electron 安装包和网页版。先运行 `npx whatevertools check ./dist` 看兼容报告，网页不支持的 API 用 `supports()` 降级；只在桌面成立的功能在 whatevertools.json 里用 targets 排除 web。
