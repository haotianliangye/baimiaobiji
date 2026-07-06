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

  // 1. 匹配标准 UUID 的正则
  const uuidPattern = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

  // 2. 将形如 `[文字](UUID)` 或 `[文字][UUID]` 但没带 `#log_id_` 前缀的超链接统一加上前缀
  let formatted = content.replace(
    /\[([^\]]+)\]\((?:#log_id_)?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g,
    "[$1](#log_id_$2)"
  );
  formatted = formatted.replace(
    /\[([^\]]+)\]\[(?:#log_id_)?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]/g,
    "[$1](#log_id_$2)"
  );

  // 3. 匹配中括号内纯裸露一个或多个 UUID 的集合，如 [UUID1, UUID2, ...]
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

  return formatted;
}

