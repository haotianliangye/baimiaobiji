/**
 * #4 全局标签系统 -- 标签路径解析、别名映射、树形构建等纯函数。
 * 标签以 `/` 分隔的完整路径字符串存储，支持层级 `parent/child`。
 */

/** 树形节点（供 TagManagement 页面展示）。 */
export interface TreeNode {
  path: string;
  name: string;
  children: TreeNode[];
}

/**
 * 归一化标签路径：trim、统一 `/` 分隔、去首尾 `/`。
 * 也接受 `\` 分隔符（用户可能误输）。
 */
export function normalizeTagPath(path: string): string {
  return path
    .trim()
    .replace(/[\\/]+/g, '/')   // 统一斜杠（连续多个也合并）
    .replace(/^\/+|\/+$/g, ''); // 去首尾斜杠
}

/**
 * 从文本中提取 `#标签`，支持层级 `#工作/项目A`。
 * `#` 后到空白或中英文标点为止。返回去重路径数组（已去掉 `#`、已归一化）。
 */
export function parseTagsFromText(text: string): string[] {
  // 匹配 # 后面的非空白、非标点字符序列；`/` 允许出现在中间表示层级。
  // 终止符：空格、制表符、换行、以及常见中英文标点。
  const regex = /#([^\s#，。！？、；：""''（）()【】\[\]{},.!?;:|\\]+)/g;
  const result: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const normalized = normalizeTagPath(match[1]);
    if (normalized && !result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result;
}

/**
 * 解析别名：若 path 是某 alias 的键，返回对应 target；递归处理传递链
 * （A->B, B->C 则 A->C）。防循环（visited 集合）。
 */
export function resolveAlias(path: string, aliases: Record<string, string>): string {
  const normalized = normalizeTagPath(path);
  const visited = new Set<string>();
  let current = normalized;
  while (aliases[current] && !visited.has(current)) {
    visited.add(current);
    current = normalizeTagPath(aliases[current]);
  }
  return current;
}

/**
 * 返回路径的所有祖先路径。
 * `工作/项目A/子` -> `['工作', '工作/项目A']`（不含自身）。
 */
export function getAncestors(path: string): string[] {
  const normalized = normalizeTagPath(path);
  if (!normalized) return [];
  const parts = normalized.split('/');
  const ancestors: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    ancestors.push(parts.slice(0, i).join('/'));
  }
  return ancestors;
}

/**
 * 前缀匹配：搜索 `#工作` 时，`工作/A`、`工作/A/B` 都命中（自身也命中）。
 */
export function matchesByPrefix(tagPath: string, queryPath: string): boolean {
  const normalizedTag = normalizeTagPath(tagPath);
  const normalizedQuery = normalizeTagPath(queryPath);
  if (!normalizedQuery) return true;
  if (normalizedTag === normalizedQuery) return true;
  return normalizedTag.startsWith(normalizedQuery + '/');
}

/**
 * 构建树形结构。返回虚拟根节点（path='', name=''），其 children 为顶级标签。
 */
export function buildTagTree(paths: string[]): TreeNode {
  const root: TreeNode = { path: '', name: '', children: [] };
  const nodeMap = new Map<string, TreeNode>();

  for (const rawPath of paths) {
    const path = normalizeTagPath(rawPath);
    if (!path) continue;
    const parts = path.split('/');
    let currentPath = '';
    let parent = root;

    for (let i = 0; i < parts.length; i++) {
      currentPath = i === 0 ? parts[i] : `${currentPath}/${parts[i]}`;

      let node = nodeMap.get(currentPath);
      if (!node) {
        node = { path: currentPath, name: parts[i], children: [] };
        nodeMap.set(currentPath, node);
        parent.children.push(node);
      }
      parent = node;
    }
  }

  return root;
}
