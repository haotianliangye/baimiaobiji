# Issue #001: 版本号与发布纪律

**优先级**：P0
**分支**：`feat/issue-001-versioning`
**版本号**：`0.0.0` → `0.1.0`
**预计工作量**：30 分钟
**schema 变更**：无

## 目标

建立发布纪律的最小信号。让版本号真正成为可追溯的工程信号，而不是占位符。

## 文件改动

### [package.json:3](file:///d:/baimiaobiji/package.json#L3)
- `"version": "0.0.0"` → `"version": "0.1.0"`

### [vite.config.ts](file:///d:/baimiaobiji/vite.config.ts)
在 `define` 块加：
```typescript
define: {
  ...其他 define,
  'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
}
```

### [CLAUDE.md](file:///d:/baimiaobiji/CLAUDE.md)「分支与提交」section 后追加
```markdown
### 版本号规则

- patch（0.1.x）：bug fix、不改 schema 的纯代码改动
- minor（0.x.0）：新功能、可见的 schema 迁移（db version++）
- major（x.0.0）：架构级变更、breaking change

每次合并 main 后立即 `git tag v<version>` 并推送。
```

### [src/pages/Settings.tsx](file:///d:/baimiaobiji/src/pages/Settings.tsx)
- 新增「关于」section
- 显示 `v{version}` （从 `import.meta.env.VITE_APP_VERSION` 读）
- 显示当前 db version（从 `db.verno` 读）

## TDD checklist

- [ ] 测试 version 字符串格式 `/\d+\.\d+\.\d+/`
- [ ] 测试 `import.meta.env.VITE_APP_VERSION` 能正确注入
- [ ] CI step：`git tag --list "v$VERSION"` 必须存在

## 验收标准

- [ ] `npm run build` 通过
- [ ] CI 检查版本 tag 存在
- [ ] Settings 页「关于」section 正确显示版本号
- [ ] 文档已更新（CLAUDE.md + CONTEXT.md）

## commit 后

1. 合并 main
2. `git tag v0.1.0 && git push origin v0.1.0`
3. 更新 `docs/handoff/CURRENT_STATE.md` 进度表 #001 行：⏳ → ✅

## 风险

无（纯配置 + 文档改动）。