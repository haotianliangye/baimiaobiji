---
id: "009"
title: "Seam 8：TTS 外部 API 配置（Gemini / 火山引擎）"
status: "ready-for-agent"
labels:
  - "ready-for-agent"
  - "seam"
  - "settings"
  - "tts"
  - "api"
created: "2026-07-14"
parent_issue: "docs/issues/001-ui-ux-restructure.md"
related_prd: "docs/prd-ui-ux-2026-07-13.md"
related_alignment: "docs/requirement-alignment-2026-07-13.md"
---

# Seam 8：TTS 外部 API 配置（Gemini / 火山引擎）

## Problem Statement

TTS 仅支持浏览器内置 Web Speech，音质与语言支持有限，无法接入 Gemini / 火山引擎等外部 API。

## Solution

在系统设置新增“语音朗读”独立菜单项，支持二选一：
- 浏览器内置（Web Speech）
- 外部 TTS API（Gemini / 火山引擎）

选择外部 API 时填写 Provider / API Key / Base URL / Model / Voice / 默认语言 / 语速。后端新增 `/api/tts` 端点，前端根据 Provider 调用对应后端逻辑。

## User Stories

1. 作为用户，我希望 TTS 支持选择“浏览器内置”或“外部 TTS API”，以便根据网络与音质需求切换。
2. 作为用户，我希望选择外部 API 时填写 Provider / API Key / Base URL / Model / Voice / 默认语言 / 语速，以便使用 Gemini 或火山引擎朗读。
3. 作为用户，我希望选择浏览器内置时隐藏外部 API 字段，以免界面冗余。
4. 作为用户，我希望配置外部 TTS 后，朗读请求能正确携带 Provider/Key/Model 等参数。

## Implementation Decisions

- 系统设置新增“语音朗读”独立菜单项，位于“对话模型”之后（见 Seam 2）。
- 语音朗读服务二选一：浏览器内置（Web Speech）/ 外部 TTS API。
- 选择浏览器内置时隐藏外部 API 字段；选择外部 API 时展开：
  - Provider：Gemini / 火山引擎（暂时）。
  - API Key
  - Base URL
  - Model
  - Voice / Speaker ID
  - 默认朗读语言
  - 朗读语速
- UI 样式参考对话模型当前配置卡片。
- 后端 `/api/tts` 端点接收 `{ text, lang }` 并返回音频 blob；前端根据 Provider 调用对应后端逻辑。
- 保留现有 Web Speech 调用路径作为默认 fallback。
- Settings store 版本升级到 v12 时初始化 TTS 外部配置字段。

## Testing Decisions

- 验证选择外部 API 后展开配置字段，选择浏览器内置后隐藏。
- 验证保存配置后，TTS 朗读请求正确携带 Provider/Key/Model 等参数。
- 验证后端 `/api/tts` 返回音频 blob，前端可正常播放。
- 验证 Web Speech fallback 在浏览器内置模式下仍可用。
- 验证切换 Provider 时字段提示与校验符合对应 API 要求。

## Out of Scope

- 不新增除 Gemini / 火山引擎之外的 TTS Provider。
- 不改动现有 Web Speech 核心调用逻辑。
- 设置页布局重构见 Seam 2。
