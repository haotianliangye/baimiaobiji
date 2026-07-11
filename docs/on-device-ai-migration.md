# 端侧 AI 迁移方案

## 目标

在保留现有**云端主路径**（PWA + 本地 Express 代理 `server.ts` + 云端 Gemini/豆包等）的前提下，为白描笔记增加一个**端侧离线模式**：

- 按需开启、断网可用；
- 手机独立运行，零外部依赖；
- 目标机：小米 12S Ultra（骁龙 8+ Gen1 / Adreno 730 / 12GB RAM）。

## 关键决策

### 决策 1：放弃纯 PWA 端侧 AI

早期假设端侧推理可以跑在纯浏览器 PWA 内（通过 transformers.js / web-llm 加载 Gemma 4 E2B）。经调研与真机验证，该路径存在硬约束：

| 约束 | 说明 |
|---|---|
| 浏览器内存墙 | 手机浏览器单 tab 上限约 2GB，Gemma 4 E2B 的 128K KV cache 单独就约 2GB |
| 可用上下文 | 纯 PWA 只能跑到 4K–8K 上下文，128K 优势无法兑现 |
| 推理速度 | 持续热降频后 tok/s 仅 1–3，生成一次日记需数分钟 |
| WebGPU 稳定性 | 移动端存在"特性检测通过但推理崩溃"的问题 |
| 格式限制 | QAT 2-bit（唯一能塞进 tab 的量化）无 ONNX 版，transformers.js 无法直接加载 |

### 决策 2：采用原生混合应用（ADR-0001）

最终方案：**用 Capacitor 将现有 PWA 打包为原生应用，端侧 AI 能力通过原生插件/bridge 调用 LiteRT-LM 或 MediaPipe 运行时**。

- 用户在 Google AI Edge Gallery app（LiteRT-LM 原生运行时）上已验证 Gemma 4 E2B 可在小米 12S Ultra 跑通，最大约 9.99K 上下文可用；
- 原生内存预算远高于浏览器 tab，可兑现 128K 上下文；
- 规避 WebGPU 移动端稳定性风险；
- UI、状态、存储、RAG 检索等核心逻辑继续用现有 React + Dexie 实现。

云端 AI 继续通过现有 provider 抽象运行；在原生应用中，JS 直接调用云端 API，不再需要 `server.ts` 本地代理。

## 端侧模型选型（调研结论）

| 能力 | 推荐模型 | 说明 |
|---|---|---|
| Chat LLM | Gemma 4 E2B-it | 原生运行时；128K 上下文；约 2.5–3GB |
| ASR | Whisper small via transformers.js（浏览器）或原生 Whisper / Vosk | 中文 CER ~8–12%，自带标点；Whisper small 约 466MB |
| Embedding | **bge-small-zh-v1.5** | 中文专项优化，C-MTEB 检索 61.77，INT8 仅 24MB，512 维 |

> 早期方案文档推荐的 `all-MiniLM-L6-v2` **不支持中文**，必须弃用。

## 洞察（长上下文）处理

端侧 8K 上下文无法直接处理周/月级原始日志。方案：

- **分层 Map-Reduce**：复用已有的每日日记/回顾做分层聚合，避免直接喂 raw_logs；
- **云端洞察也改用每日摘要做输入**：既验证分层聚合质量，又为端侧铺路，还能省云端 token；
- **双轨定位**：云端洞察保留主路径，端侧洞察作为离线兜底。

## 待确认事项

1. **双目标还是单目标**：桌面/浏览器侧是否继续保留纯 PWA + 云端模式，移动端以原生应用为载体同时支持云端和端侧？
2. **原生运行时/bridge 选型**：LiteRT-LM vs MediaPipe，Capacitor 插件实现细节。
3. **模型分发策略**：首次启动下载 2–3GB 模型 vs Play Asset Delivery / App Store on-demand resource。
4. **向量空间版本管理**：端侧 `bge-small-zh-v1.5` 与云端 `gemini-embedding-2` 生成不同向量空间，需按 `embedding_version` 过滤检索，并设计渐进式重嵌入迁移。

## 相关资料

- 原始调研资料已迁移至：`D:\DProjects\bytenote\docs\前期调研\`
  - `00-项目背景.md`
  - `01-端侧AI应用解决方案指南（初始方案）.md`
  - `02-端侧AI可行性调研报告.md`
  - `03-端侧速度与洞察方案调研补充.md`
  - `04-ADR-0001-端侧AI采用原生混合应用.md`
