---
id: R-003
title: Desktop 与 Mobile 打包 Runbook
description: >
  记录 Telegraph 桌面端与 mobile 端当前打包入口、已验证产物、问题清单与复验步骤，
  用于后续发布或本地生成端骨架时快速定位。
category: reference
created: 2026-05-28
updated: 2026-05-28
tags: [packaging, desktop, mobile, electron, expo, release]
status: draft
---

# Desktop 与 Mobile 打包 Runbook

> 本文整理 2026-05-28 对桌面端 Electron Forge 与 mobile Expo React Native 的打包排查结论。
> 当前目标是把“能生成什么、入口命令是什么、还缺什么发布级动作”说清楚。

## 当前端形态

| 端 | 目录 | 技术栈 | 生成物 |
|---|---|---|---|
| Desktop | `apps/main` | Electron Forge + Vite + React | `apps/main/out/Telegraph-darwin-arm64/Telegraph.app`；`apps/main/out/make/zip/darwin/arm64/Telegraph-darwin-arm64-0.0.0.zip` |
| Mobile | `apps/mobile` | Expo React Native | `apps/mobile/dist` 的 iOS/Android JS/Hermes export；`apps/mobile/ios` 与 `apps/mobile/android` 原生工程骨架 |

Mobile 只通过 `MobileRemoteControlClient` 访问 remote-control HTTP relay，不承载本地 agent runtime，也不直接接入 Main/Shared/Daemon。

## 已发现并修正的问题

| 问题 | 影响 | 修正 |
|---|---|---|
| 根 `package.json` 的 `package` / `make` 使用 `pnpm --filter telegraph ...` | 当前 workspace 包名是 `@telegraph/main`，根命令不会命中任何项目 | 根脚本改为 `package:desktop` / `make:desktop`，默认 `package` 与 `make` 代理到 desktop |
| Desktop packaged app 黑屏 | `WindowManager` 在 production 加载 `../renderer/index.html`，但 Forge Vite 输出目录是 `../renderer/main_window/index.html` | packaged `loadFile` 路径改为 `../renderer/main_window/{index,setting}.html`，并补单测 |
| Mobile 只有 dev/run 脚本，没有明确的生成/打包入口 | 不清楚该用 export、prebuild 还是 release build | `apps/mobile/package.json` 增加 `package`、`export:*`、`generate:native*` 与 native release 辅助脚本 |
| Expo prebuild 会生成大量原生 scaffold | 容易把可再生成的 native 目录混入业务 diff | `.gitignore` 增加 `apps/mobile/android/` 与 `apps/mobile/ios/`，按 CNG 方式本地生成 |

## 常用命令

从仓库根目录执行：

```bash
pnpm package:desktop
pnpm make:desktop
pnpm package:mobile
pnpm generate:mobile
pnpm generate:mobile:clean
pnpm package:all
```

Mobile 包内也可单独执行：

```bash
pnpm --filter @telegraph/mobile export
pnpm --filter @telegraph/mobile export:ios
pnpm --filter @telegraph/mobile export:android
pnpm --filter @telegraph/mobile native:ios:release
pnpm --filter @telegraph/mobile native:android:release
```

`package:mobile` 当前等价于 `expo export --platform all --output-dir dist`，适合生成 iOS/Android JS/Hermes export。真正提交 App Store / Play Store 仍需要 EAS Build、Xcode archive 或 Android signing 配置。

## 2026-05-28 验证结果

| 命令 | 结果 | 备注 |
|---|---|---|
| `pnpm --filter @telegraph/main package` | 通过 | 生成 `apps/main/out/Telegraph-darwin-arm64/Telegraph.app` |
| `pnpm make:desktop` | 通过 | 生成 `apps/main/out/make/zip/darwin/arm64/Telegraph-darwin-arm64-0.0.0.zip` |
| `pnpm --filter @telegraph/mobile typecheck` | 通过 | TypeScript 无错误 |
| `pnpm --filter @telegraph/mobile test` | 通过 | 2 个测试文件，4 个测试通过 |
| `pnpm --filter @telegraph/mobile exec expo export --platform all --output-dir dist` | 通过 | 生成 iOS/Android Hermes bundle 与 `metadata.json` |
| `pnpm --filter @telegraph/mobile exec expo prebuild --no-install` | 通过 | 生成 `apps/mobile/ios` 与 `apps/mobile/android` |

Desktop package 期间有两个非阻塞 warning：

- Tailwind CSS 优化阶段提示 `.bg-[var(--...)]` 中的 `var(--...)` token 非法，需要后续清理源样式。
- `vm-browserify` 使用 `eval`，这是依赖包警告，不阻塞产物生成。

Mobile prebuild 期间提示全局 `sharp-cli` 版本偏旧，Expo 已继续完成 prebuild。若后续图片处理失败，可升级全局 `sharp-cli@^5.2.0` 或设置 `EXPO_IMAGE_UTILS_NO_SHARP=1`。

## 发布级缺口

| 缺口 | 说明 |
|---|---|
| Desktop 签名/公证 | 当前只验证 Forge package。面向分发还需要 macOS signing/notarization、Windows code signing 与 maker 产物验证 |
| Desktop 跨平台 maker smoke | 本轮只在 macOS arm64 验证 ZIP maker；Windows Squirrel、Linux RPM/DEB 仍需在对应平台验证 |
| Mobile store build | 当前 mobile 生成的是 Expo export 与 native scaffold；`.ipa` / `.apk` / `.aab` 发布包需要 signing 与 EAS/Xcode/Gradle release 流程 |
| Mobile relay 配置 | 本地调试可用 `pnpm start:mobile-gateway` 暴露 `8799/rpc`；真实设备需同网段可访问 host，或显式设置 `EXPO_PUBLIC_TELEGRAPH_REMOTE_ENDPOINT` |
| Native 目录策略 | 当前按 Expo Continuous Native Generation 处理，`ios/` 与 `android/` 为本地可再生成目录。若未来引入自定义原生代码，应取消忽略并建立 native diff review 规则 |

## 快速复验顺序

1. `pnpm package:desktop`
2. `pnpm --filter @telegraph/mobile typecheck`
3. `pnpm --filter @telegraph/mobile test`
4. `pnpm package:mobile`
5. `pnpm generate:mobile`

如果只改 UI 或 mobile 业务逻辑，优先跑第 2-4 步；如果改 Electron Forge / Vite / pagelet build entry，再跑第 1 步。
