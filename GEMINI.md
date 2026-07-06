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
6. **移动端 WebView 锁定与防回弹规约**：
   - 全局最基础容器（`html, body, #root`）必须强制设为 `overflow: hidden` 及 `overscroll-behavior: none`。
   - 严禁允许底层 body 原生滚动，以防在手机端（iOS/Safari 等）下拉刷新或滑动边界时引发 WebView 底座物理偏移导致页面被截断。所有页面的滚动手势必须收拢在其内部的子滚动容器（`overflow-y-auto`）中。
7. **多 Prompt 后台自动生成队列**：
   - 自动生成必须采用基于 LocalStorage 的持久化任务队列（Task Queue）管理机制。
   - 这可以抵御移动端锁屏、切后台或网络波动造成的中断。
   - 自动触发的检测必须采用“7 天滑动窗口历史检测”并支持手动触发“30 天补全”。
   - 判断存在性时禁止依靠日期进行简易的“有无”检测。
   - 必须通过当前启用的所有 Prompt 索引集与数据库现有记录的 Prompt 索引进行差集对比，实现精确的增量补全。
8. **Noto Serif 衬线体 Logo 垂直对齐微调**：
   - 顶部品牌 Logo 在使用 `font-serif` 衬线大方字（Noto Serif SC）且不加粗（`font-normal`）时，其视觉几何重心天然略微偏上。必须在 class 中显式声明 `translate-y-[2px]` 下移补偿，以保障其视觉中线与右侧动作图标绝对平齐。
9. **气泡卡片文字悬浮防抖动与虚化**：
   - 针对包裹有小字号文本的时光碎屑等自适应气泡卡片，为了避免合成层（Composited Layer）与普通排版层切换引发的文字重新栅格化，**禁止在 hover 态下使用 transform 物理位移**。悬浮与激活反馈应仅通过 `box-shadow` 投影和 `border-color` 颜色过渡平滑展现。
10. **中文排版两端对齐与短行防拉伸规约**：
    - 全局应用 `justify` 两端对齐时，必须配置 `text-align-last: left !important;` 以防尾行或单行标题文字被强行拉开。
    - 在正文 Markdown 解析容器中，必须显式重写首个段落（`p:first-of-type`）为左对齐，防止非标文字标题被拉伸对齐。
11. **移动端键盘 Enter 换行防拦截**：
    - 当检测到是移动端（`isMobile`）时，绝对禁止在文本框中拦截 Enter 键执行表单提交，必须允许虚拟键盘自然换行以保护输入连贯性。
12. **非标超链接占位符保护清洗契约**：
    - 前端在 ReactMarkdown 渲染前，必须通过“占位符隔离保护算法”提取并锁死正规超链接（如 `[文字](#log_id_UUID)`），然后再使用正则将所有非标 UUID（如裸 `#log_id_UUID` 或是被反引号/中括号包裹的形式）统一容错格式化为超链接，最后还原占位符。这能 100% 避免链接誤伤和括号暴露渲染故障。


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
    ai_review?: string;    // 废弃，仅用于历史数据迁移
    updated_at: number;    // 更新时间戳
    prompt_index?: number; // 关联的日记 Prompt 索引
    prompt_name?: string;  // 关联的日记 Prompt 名称
  }
  ```

### 3. `daily_reviews` (独立回顾表)
* **索引键**：`id, review_date`
* **接口定义**：
  ```typescript
  export interface DailyReview {
    id: string;
    review_date: string;          // YYYY-MM-DD
    raw_log_ids: string[];        // 生成此回顾所关联的碎屑 logs ID 列表
    ai_review: string;            // [回顾 Prompt] 生成的反思回顾 markdown
    ai_summary: string;           // 一句话诗意摘要内容
    review_prompt_index?: number; // 关联的回顾 Prompt 索引
    review_prompt_name?: string;  // 关联的回顾 Prompt 名称
    updated_at: number;           // 更新毫秒级时间戳
  }
  ```

### 4. `insights` (洞察缓存表)
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
