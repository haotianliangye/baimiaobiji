# Progress - Seam 8: TTS 外部 API 配置 (#009)

## 改动摘要

在系统设置「语音朗读」独立菜单项中新增外部 TTS API 配置：二选一 浏览器内置 / 外部 API，选外部展开 Provider(Gemini/火山引擎) / APIKey / BaseURL / Model / Voice 等字段。后端新增 `/api/tts` 端点按 Provider 调用对应 TTS 服务并返回音频 blob，前端 `tts.ts` 携带 Provider/Key/Model 等参数请求后端。Web Speech 调用路径保留为 fallback。

### settings.store.ts

- 新增 `DEFAULT_TTS_PROVIDER_CONFIGS`（gemini / volcengine 默认 apiKey/baseUrl/model），与后端 `/api/tts` 约定保持一致。
- `SettingsState` 接口新增字段：`ttsProvider: 'gemini' | 'volcengine'`、`ttsApiKey`、`ttsBaseUrl`、`ttsModel`、`ttsConfigs`（per-provider 配置缓存）。
  - 设计说明：`ttsService: 'webspeech' | 'external'`（#10 已有）为浏览器/外部总开关；`ttsProvider` 为外部子服务商选择器，二者层级不同、不冲突。
- 默认 state 初始化上述字段（沿用 Gemini 默认值）。
- `setSettings` 新增 TTS provider config 缓存逻辑（镜像 embed provider 模式）：切换 provider 时从 `ttsConfigs` 或默认配置回填 apiKey/baseUrl/model；Chat/Embed provider 切换的 return 也补上 `ttsConfigs` 透传，避免缓存丢失。
- `merge` 阶段为老用户（v12 未保存这些字段）显式回填默认值；**不升 version**（已在 12），靠 merge 的 currentState spread + 显式兜底补默认。

### Settings.tsx

- 从 store 解构 `ttsProvider/ttsApiKey/ttsBaseUrl/ttsModel`，新增 `showTtsApiKey` 显隐状态。
- 在「语音朗读」tab（seam 2 已建独立菜单项）的朗读服务选择下方，当 `ttsService === 'external'` 时展开「外部 TTS API 配置」卡片，UI 参考对话模型/向量配置卡片样式：
  - Provider 选择（Gemini / 火山引擎，按钮组）
  - API Key（密码框 + 显隐切换 + 格式提示）
  - Base URL
  - Model（+ 提示：Gemini 填模型名 / 火山引擎填发音人 ID）
  - Voice（+ 提示：Gemini 预置音色 / 火山引擎留空）
- 原有「默认朗读语言」「朗读语速」作为通用字段保留（Web Speech 与外部均使用）。
- model tab 内无残留 TTS 配置（#10/seam2 已迁移至独立 tab），无需移除。
- 全部新增文案走 i18n `t()`，未硬编码中英文。

### tts.ts

- `TTSSpeakOptions` 扩展 `ttsProvider/ttsApiKey/ttsBaseUrl/ttsModel` 字段。
- `speakExternal` 签名增加 opts 参数，请求体由 `{text, lang}` 扩展为 `{text, lang, settings: {provider, apiKey, baseUrl, model, voice, rate}}`，使朗读请求正确携带 Provider/Key/Model 等参数。
- `useTTS()` hook 读取 store 的 `ttsProvider/ttsApiKey/ttsBaseUrl/ttsModel` 并传入 `speak()`。
- Web Speech 调用路径（`speakWebSpeech`）保持不变，作为 fallback。

### 后端 server.ts + api/index.ts（镜像）

- 新增 `pcmToWav(pcm, sampleRate, channels, bitsPerSample)` 辅助函数（44 字节 WAV 头 + PCM 数据）。
- 新增 `app.post('/api/tts')` 端点，接收 `{text, lang, settings}`，按 `settings.provider` 分发：
  - **Gemini**：用 `@google/genai` SDK 调 TTS 模型（`responseModalities: ['AUDIO']` + 可选 `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`），取返回的 PCM L16（24kHz/16-bit/mono）base64，包装为 WAV 返回 `audio/wav`。
  - **火山引擎**：调 openspeech HTTP API（`/api/v1/tts`）。apiKey 约定 `appid:access_token` 格式（冒号分割）；model = voice_type（如 `BV001_streaming`）；rate 映射为 `speed_ratio`；cluster 固定 `volcano_tts`。返回 `audio/mp3`。
  - 两端点代码完全镜像（与现有 `buildGeminiClient`/`sendLLMRequest` 的重复模式一致）。

### i18n（zh.ts + en.ts 各新增 10 条）

`settings.ttsExternalConfig` / `ttsProvider` / `ttsApiKey` / `ttsApiKeyHint` / `ttsBaseUrlLabel` / `ttsModelLabel` / `ttsModelHint` / `ttsVoiceLabel` / `ttsVoiceHint`（`ttsApiKey` 复用通用标签文案）。

## Lint / Build 结果

- `npm run lint`（tsc --noEmit）：**通过**（首次即过）
- `npm run build`（vite build + esbuild server.ts）：**通过**（首次即过；仅有既有的 storage.ts 动态导入警告与 chunk 体积警告，非本次引入）

## 变更文件

- `src/store/settings.store.ts` - 新增 TTS 外部配置字段/默认值/缓存/merge 兜底
- `src/pages/Settings.tsx` - 语音朗读 tab 新增外部 API 配置卡片
- `src/lib/tts.ts` - speakExternal 携带 provider 设置，useTTS 透传新字段
- `server.ts` - 新增 `/api/tts` 端点 + pcmToWav
- `api/index.ts` - 镜像新增 `/api/tts` 端点 + pcmToWav
- `src/i18n/zh.ts` / `src/i18n/en.ts` - 新增 10 条 TTS 外部配置文案

## 遗留问题

1. **火山引擎 TTS appid 来源**：火山引擎 openspeech API 需要 appid + access_token 两个凭证。当前约定 apiKey 填 `appid:access_token`（冒号分割），cluster 固定 `volcano_tts`。这是一种妥协的 UX，未单独开 appid 字段。后续如需更友好可加独立 appid 输入。
2. **Gemini TTS 语速**：Gemini 预置 TTS 模型不支持直接调整语速（`ttsRate` 对 Gemini 外部路径无效，仅 Web Speech 与火山引擎生效）。语速滑块仍对两种服务统一展示。
3. **火山引擎 TTS 未实测**：Gemini 路径基于 `@google/genai` SDK 标准用法实现；火山引擎路径按 openspeech HTTP API 文档实现但未做端到端实测（需有效 appid/access_token）。端点结构与错误处理已就绪。
4. **开始前清理**：开工时发现 `settings.store.ts` 有上次中断残留的半成品（仅改了 store 一个文件，且用了 `ttsProvider: 'gemini'|'volcengine'` 与任务描述的 `browser|external` 表述不一），已按硬约束 #7 `git checkout --` 清理后重新实现。最终设计澄清：`ttsService`(webspeech|external) 为总开关，`ttsProvider`(gemini|volcengine) 为外部子服务商，二者并存无冲突。
