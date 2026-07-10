/**
 * 字数统计工具
 * 规则：去除 Markdown 标记与空白后的纯文本字符数
 */

/**
 * 移除 Markdown 常见标记，保留可见文本
 */
export function stripMarkdown(text: string | undefined | null): string {
  if (!text) return "";

  return (
    text
      // 图片与链接只保留显示文字
      .replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1")
      // 引用式链接 [text][ref]
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      // 标题 #、列表 -/*/+、引用 >、强调 * / _ / ~ / `
      .replace(/^[\s]*[#\-\*\+>\`]+\s?/gm, "")
      // 行内格式符号 **、__、*、_、~~、`
      .replace(/(\*\*|__|\*|_|~~|`)/g, "")
      // 分隔线 ---、***、___
      .replace(/^[\s]*[-\*_]{3,}[\s]*$/gm, "")
      // 块状引用 >
      .replace(/^\s*>\s?/gm, "")
      // 表格竖线
      .replace(/\|/g, "")
      .trim()
  );
}

/**
 * 计算有效字符数（去除 Markdown 与空白）
 */
export function countChars(text: string | undefined | null): number {
  if (!text) return 0;
  return stripMarkdown(text).replace(/\s/g, "").length;
}

/**
 * 对一组文本条目求总字数
 */
export function sumChars(items: Array<{ text?: string | null }>): number {
  return items.reduce((sum, item) => sum + countChars(item.text), 0);
}
