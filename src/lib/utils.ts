import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateUUID() {
  return crypto.randomUUID();
}

export function formatDiaryMarkdown(content: string | undefined): string {
  if (!content) return "";

  // UUID 格式正则
  const uuidPattern = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

  // 1. 将所有已经规范书写的标准 markdown 链接 [文字](#log_id_UUID) 暂时提取出来存入数组中，用占位符置换保护
  const preservedLinks: string[] = [];
  let formatted = content.replace(
    /\[([^\]]+)\]\(#log_id_([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g,
    (match) => {
      preservedLinks.push(match);
      return `__PRESERVED_LINK_PLACEHOLDER_${preservedLinks.length - 1}__`;
    }
  );

  // 2. 对其它非标准超链接写法（如未加 #log_id_ 前缀的）做容错并拼装为标准格式，然后同样加入占位保护
  formatted = formatted.replace(
    /\[([^\]]+)\]\((?:#log_id_)?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g,
    "[$1](#log_id_$2)"
  );
  formatted = formatted.replace(
    /\[([^\]]+)\]\[(?:#log_id_)?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]/g,
    "[$1](#log_id_$2)"
  );
  
  // 将新转好的标准链接也提取保护起来
  formatted = formatted.replace(
    /\[([^\]]+)\]\(#log_id_([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g,
    (match) => {
      preservedLinks.push(match);
      return `__PRESERVED_LINK_PLACEHOLDER_${preservedLinks.length - 1}__`;
    }
  );

  // 3. 此时，文本中剩余的所有的 UUID 序列均是非标或裸露的。
  // 我们依次清理所有未被保护的非标模式：

  // 模式 A：匹配反单引号或直接裸露的 #log_id_UUID，如 `#log_id_UUID` 或者是 `#log_id_UUID`
  // 匹配：`?#log_id_UUID`?
  formatted = formatted.replace(
    /`?#log_id_([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})`?/g,
    "[引用](#log_id_$1)"
  );

  // 模式 B：匹配中括号内纯裸露一个或多个 UUID 的集合，如 [UUID1, UUID2, ...]
  // 使用否定顺序环视 (?!\(|\[) 确保其后不能紧跟圆括号 `(` 或中括号 `[`，彻底避免误杀已有格式的 Markdown 超链接。
  formatted = formatted.replace(/\[([^\]]+)\](?!\(|\[)/g, (match, innerText) => {
    uuidPattern.lastIndex = 0;
    if (uuidPattern.test(innerText)) {
      const uuids = innerText.match(uuidPattern);
      if (uuids && uuids.length > 0) {
        // 清理出除去 UUID 字符串、逗号及空格之外的自定义描述文本
        const cleanedText = innerText.replace(uuidPattern, "").replace(/[,\s]/g, "");
        if (cleanedText.length > 0) {
          // 如果用户或大模型提供了自定义引用文字，保留它作为跳转链接文字
          return uuids.map((id: string) => `[${cleanedText}](#log_id_${id})`).join(" ");
        } else {
          // 否则（纯裸 UUID），为了视觉美观收拢为“引用”字眼
          return uuids.map((id: string) => `[引用](#log_id_${id})`).join(" ");
        }
      }
    }
    return match;
  });

  // 模式 C：匹配纯裸露、无任何标记包裹的 UUID
  // 仅在非单词边界且未被其他标记占领时匹配
  formatted = formatted.replace(
    /(?<![0-9a-fA-F\-]|[a-zA-Z_])([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?![0-9a-fA-F\-]|[a-zA-Z_])/g,
    "[引用](#log_id_$1)"
  );

  // 4. 最后，把我们占位保护起来的标准 Markdown 链接 100% 还原回来
  formatted = formatted.replace(/__PRESERVED_LINK_PLACEHOLDER_(\d+)__/g, (match, index) => {
    const idx = parseInt(index, 10);
    return preservedLinks[idx] || match;
  });

  return formatted;
}

