# 白描笔记 (Baimiao Notes) — AI 规约与开发指南

本文档记录了「白描笔记」的专有开发规约、核心技术架构以及接口契约，供未来的 AI 协作助手快速获取上下文，避免重复摸索或偏离既定设计。

---

## 📌 项目定位与红线规约

1. **隐私优先与本地全掌控**：
   - 所有的录音文件、解析文本、生成的日记及反思数据**必须默认存储在用户本地的 IndexedDB 中**。
   - 严禁在未经用户授权的前提下将数据自动上传至外部云盘或数据库。
2. **大模型配置完全通过前端透传**：
   - 后端 Express 服务与 Vercel API 均充当**安全代理层**，其接口鉴权所需的 API Key、Base URL 及 Model 必须通过请求体中的 `settings` 对象由前端安全注入。
   - 严禁在后端配置或硬编码个人 API Key 等机密信息。
3. **提示词四通道设计（默认 + 自定义 1/2/3）**：
   - “日记生成”、“统计回顾”和“生命洞察”三个模块的提示词配置均采用 4 元素数组存储结构（索引 0 为只读系统默认值，1-3 为用户自定义槽位）。
   - 在设置页面中，当用户切换至 `默认` 时，对应的输入框必须是置灰且只读状态（`readOnly`），只有切换至 `自定义 1/2/3` 时才允许编辑。
4. **统计回顾与日记生成逻辑完全解耦**：
   - “日记”选项卡和“统计回顾”选项卡的数据和 Prompt 相互独立。日记展示 `ai_editorial`，回顾展示 `ai_review`。
5. **回顾与日记按所属日期对齐过滤**：
   - 无论何时重新生成、补发或查看日记与回顾，数据必须以日志所属日期（`diary_date === dateStr`）为唯一对齐轴，过滤并展示在对应的日期面板中。严禁在当前选择 A 日时，展示 B 日或其它日期的回顾内容。

---

## 🏗️ 项目结构与文件指南

- `/server.ts`：Express 本地开发服务端，融合了 Vite 开发中间件以提供一体化开发服务。
- `/api/index.ts`：Vercel Serverless API 部署文件，结构与 `server.ts` 保持高度同步。
- `/src/db/db.ts`：本地 IndexedDB (Dexie) 数据库实例声明与类型定义。
- `/src/store/`：
  - `app.store.ts`：负责控制 AI 接口的请求调用、生成状态（`isProcessingDiary`、`isProcessingReviewMap`）以及将结果写回本地 IndexedDB。
  - `settings.store.ts`：负责大模型服务商配置及多套自定义提示词模板（包含版本迁移逻辑）的持久化存储。
- `/src/pages/`：
  - `Record.tsx`：碎屑记录与语音录入（iOS/Safari 深度音频兼容转录）。
  - `Diary.tsx`：AI 日记整合编辑页面。
  - `Review.tsx`：统计回顾时间轴，支持局部展开、一键补发、独立重新生成回顾。
  - `Insights.tsx`：生命洞察与多天习惯 AI 分析。
  - `Settings.tsx`：大模型连接与 Prompt 按钮组配置页。

---

## 🗄️ 数据库存储模型 (IndexedDB)

项目基于 **Dexie.js** 对浏览器本地 IndexedDB 数据库 `whitewash_diary` 进行管理，定义了以下三张数据表：

### 1. `raw_logs` (碎屑记录表)
* **索引键**：`id, created_at`
* **接口定义**：
  ```typescript
  export interface RawLog {
    id: string;          // UUID 唯一标识
    content: string;     // 转写后的文本内容
    created_at: number;  // 毫秒级时间戳
    timezone: string;    // 生成记录时的系统时区
    audioBlob?: Blob;    // 录音音频二进制块
    audioDuration?: number; // 录音时长(秒)
  }
  ```

### 2. `daily_diaries` (整合日记与回顾表)
* **索引键**：`id, diary_date`
* **接口定义**：
  ```typescript
  export interface DailyDiary {
    id: string;
    diary_date: string;    // YYYY-MM-DD
    raw_log_ids: string[]; // 整合进此日记的原始 logs id 列表
    timeline_json: string; // 序列化后的内容概要数据
    ai_editorial: string;  // [日记 Prompt] 生成的连贯日记 markdown
    ai_review?: string;    // [回顾 Prompt] 生成的反思回顾 markdown
    updated_at: number;    // 更新时间戳
  }
  ```

### 3. `insights` (洞察缓存表)
* **索引键**：`id, range_type, created_at`
* **接口定义**：
  ```typescript
  export interface Insight {
    id?: string;
    range_type: string;   // 周期类型（如 weekly, monthly 等）
    range_label: string;  // 周期标签（如 2026-W24）
    start_date: string;   // 开始日期
    end_date: string;     // 结束日期
    content: string;      // AI 分析报告 markdown
    created_at: number;
  }
  ```

---

## 🔌 后端 API 路由契约

后端运行于本地 `PORT: 3000` 或 Vercel Serverless Function 托管路径 `/api/*`。

### 1. `POST /api/generate-timeline` (日记双轨同步生成)
* **用途**：在生成时间轴日记的同时，自动调用反思 Prompt 进行第二次生成，一同保存或返回。
* **Payload**：
  ```json
  {
    "date": "YYYY-MM-DD",
    "timezone": "Asia/Shanghai",
    "logs": [{"id": "...", "content": "...", "created_at": 12345}],
    "settings": { ... }
  }
  ```
* **Response** (200)：
  ```json
  {
    "timeline": "",
    "ai_editorial": "日记 Markdown 内容",
    "ai_summary": "一句话诗意摘要",
    "ai_review": "反思回顾 Markdown 内容"
  }
  ```

### 2. `POST /api/generate-review` (独立回顾生成)
* **用途**：当历史遗留日记缺少 `ai_review` 时，或者用户触发“重新生成回顾”时调用，不影响已生成的日记内容。
* **Payload**：
  ```json
  {
    "date": "YYYY-MM-DD",
    "timezone": "Asia/Shanghai",
    "logs": [...],
    "diaryContent": "已有的日记文本",
    "settings": { ... }
  }
  ```
* **Response** (200)：
  ```json
  {
    "ai_review": "独立生成的反思回顾内容"
  }
  ```

### 3. `POST /api/generate-insights` (生命周期洞察分析)
* **用途**：分析给定时间范围内的碎屑日志。
* **Payload**：
  ```json
  {
    "logs": [...],
    "timeRange": "weekly",
    "timeRangeLabel": "最近一周",
    "settings": { ... }
  }
  ```
* **Response** (200)：
  ```json
  {
    "content": "深度洞察 Markdown 报告"
  }
  ```

### 4. `POST /api/transcribe` (语音转写代理)
* **用途**：对音频进行转写。当服务商为火山引擎时，若音频是 iOS 输出的 mp4/m4a 等格式，后端将自动使用 ffmpeg 转化为 mp3 后再提交。
* **Payload**：
  ```json
  {
    "audio_base64": "...",
    "mime_type": "audio/mp4",
    "settings": { ... }
  }
  ```
* **Response** (200)：
  ```json
  {
    "text": "转写文本"
  }
  ```
