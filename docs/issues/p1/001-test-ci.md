# Issue P1-001 (MoN-7): 测试接 CI

**优先级**：P1
**分支**：`feat/p1-001-test-ci`
**版本号**：0.3.0 → 0.3.0（patch 都不需要，纯加 workflow 文件）
**预计工作量**：30-60 分钟
**schema 变更**：无

## 目标

每次 push / PR 时自动跑 16 个单测，失败时阻塞合并。**纯基础设施加固，不加任何新功能**。

## 当前问题

- 仓库目前**没有 CI**（`.github/workflows` 目录不存在）
- 16 个测试文件只能本地手动 `npx tsx tests/*.test.ts` 跑
- P0 #001「版本纪律」规格里提到"CI step / CI 检查版本 tag"，**但当时没真建**——这是遗留
- 风险：合并 PR 时如果忘了跑测试，可能引入回归

## 文件改动

### 新建 [`.github/workflows/test.yml`](file:///d:/baimiaobiji/.github/workflows/test.yml)

```yaml
name: Test

on:
  push:
    branches: [main, 'refactor/*']
  pull_request:
    branches: [main, 'refactor/*']
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run build
      - name: Run all tests
        env: { CI: 'true', PORT: '4178' }
        run: |
          for f in tests/*.test.ts; do
            echo "▶ $f"
            npx tsx "$f" || { echo "❌ FAILED: $f"; exit 1; }
          done
```

### 不动其他文件

- ❌ 不改 `package.json`（不需要新 dep；`npm ci` 装已有的）
- ❌ 不改任何业务代码
- ❌ 不改任何测试文件
- ❌ 不动 P0 已交付的 8 个模块

## 设计取舍

| 决策 | 理由 |
|------|------|
| **不用 matrix / 多 OS** | 单一 ubuntu-latest 已够（仓库 target 是 web，单一 OS 跑通即可）|
| **不用 npm cache** | 简单优先，跑通再优化。第一次 cache 写错反而难排查 |
| **不装 puppeteer 显式 Chrome** | puppeteer@25 自带 chromium download |
| **不并行跑 16 个测试** | 串行避免 IndexedDB / port 冲突。本地测 5 分钟，CI 给 15 分钟 |
| **不自动 tag / 发布** | P0 #001 沉淀的纪律：人工 `git tag v$VERSION` + 人工 push tag |
| **触发 `refactor/*`** | 当前工作分支是 `refactor/mingwu-to-insight`，要能被 CI 监控 |
| **触发 `workflow_dispatch`** | 可手动再跑一次（调试用）|

## TDD checklist

不是 TDD issue（**纯加设施，无业务逻辑**），但有验收：
- [ ] `.github/workflows/test.yml` 在本地能 yaml-parse（`python -c "import yaml; yaml.safe_load(open('.github/workflows/test.yml'))"`）
- [ ] 文件能 push 到 GitHub（不需要在 CI 跑通才合并，可以先 commit 再观察 CI 跑）
- [ ] 第一次 CI 跑应该 16/16 通过（基于本地测试已全过）

## 验收标准

- [ ] `.github/workflows/test.yml` 文件存在
- [ ] push 到 `feat/p1-001-test-ci` 分支后，GitHub Actions 触发
- [ ] CI 跑通：16 个测试全过 + tsc + build
- [ ] 在 PR 中能看见 CI 状态 badge

## commit 后

1. 合并到 `refactor/mingwu-to-insight`
2. **不打 tag**（无版本变更）
3. 更新 `docs/handoff/CURRENT_STATE.md` P1 进度表
4. 复盘：是否值得继续 P1-002（健康检查端点）

## 风险

**极低**。原因：
- 单文件改动，diff < 100 行
- 不动业务代码
- 不引入新依赖
- 失败最差结果：CI 跑不通，回滚 commit

## 后续

P1 阶段候选（按价值/风险排序）：
- P1-002 MoN-8：健康检查端点（扩 `/api/health` 已有，#002 沉淀）
- P1-003 ADR-0003：API Key 真隔离（localStorage → IndexedDB）
- P1-004 ADR-0004：长期记忆 facts 表（v17 schema）
- Jag-3 反馈闭环：跳过（加新功能）
- Jag-4 多通道一致性：跳过（加新功能）

每个 P1 走 8 步流程（与 P0 同），做完 1 个复盘 1 次。