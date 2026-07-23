---
id: "004"
title: "Seam 3：RAG+CHAT（Copilot）导航重构"
status: "done"
labels:
  - "done"
  - "seam"
  - "ui"
  - "rag"
  - "chat"
created: "2026-07-14"
parent_issue: "docs/issues/001-ui-ux-restructure.md"
related_prd: "docs/prd-ui-ux-2026-07-13.md"
related_alignment: "docs/requirement-alignment-2026-07-13.md"
---

# Seam 3：RAG+CHAT（Copilot）导航重构

## Problem Statement

RAG+CHAT（Copilot）板块使用“对话 / 历史会话”二级标签 + “RAG 问答 / 通用 Chat”模式切换，导航层级冗余，用户需要在两层标签间切换才能找到所需视图。

## Solution

将页面内导航扁平化为一行：`RAG → CHAT → 历史`。
- `RAG`：原 RAG 问答模式（基于本地向量检索 + LLM）。
- `CHAT`：原通用 Chat 模式（纯 LLM 对话）。
- `历史`：原历史会话列表。

保留 RAG 模式下原有的筛选胶囊、日期筛选、日记模板筛选；切换 RAG/CHAT 时仍按现有逻辑清空当前会话并新建会话。

## User Stories

1. 作为用户，我希望 Copilot 页面顶部只有一行 `RAG → CHAT → 历史` 导航，以便快速切换三种对话视图。
2. 作为用户，我希望 RAG 模式下原有的记录/日记/回顾/洞察筛选胶囊、日期筛选、日记模板筛选全部保留，以便继续按条件检索本地知识。
3. 作为用户，我希望从任意主 Tab 点击 RAG+CHAT 入口都能进入该板块，并看到统一的顶部栏规则（见 Seam 1）。
4. 作为用户，我希望历史列表项继续显示每条会话的 mode 标签（RAG/CHAT），以便区分会话类型。

## Implementation Decisions

- 移除页面内原有的“对话 / 历史会话”顶部标签切换。
- 在页面顶部引入一行横向导航：`RAG`、`CHAT`、`历史`。
- 导航映射：
  - `RAG`：原 RAG 问答模式（基于本地向量检索 + LLM）。
  - `CHAT`：原通用 Chat 模式（纯 LLM 对话）。
  - `历史`：原历史会话列表。
- 切换 `RAG`/`CHAT` 时仍按现有逻辑清空当前会话并新建会话（mode per conversation）。
- 历史列表项继续显示每条会话的 mode 标签（RAG/CHAT）。
- `RAG` 模式下保留原有筛选胶囊行（记录 / 日记 / 回顾 / 洞察、日期、日记模板），内容保持不变。
- 全局顶部栏规则仍适用于该页面：左侧 `[≡] {标题}`，右侧搜索/RAG+CHAT/灯泡。

## Testing Decisions

- 验证 `RAG / CHAT / 历史` 导航切换后显示对应内容。
- 验证 RAG 模式下筛选胶囊、日期筛选、日记模板筛选继续工作。
- 验证切换 RAG/CHAT 会新建会话，历史列表保留原 mode 标签。
- 验证从其他主 Tab 进入 Copilot 后顶部栏规则与 Seam 1 一致。

## Out of Scope

- 不改动底层 RAG/Chat LLM 调用逻辑。
- 不改动历史会话的数据模型与存储。
- 顶部栏统一规则见 Seam 1。
