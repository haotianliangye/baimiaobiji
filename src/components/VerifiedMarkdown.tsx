/**
 * VerifiedMarkdown — 引用回溯验证后的 Markdown 渲染器
 *
 * Issue #005 引入。包了 [src/lib/citationVerify.ts](file:///d:/baimiaobiji/src/lib/citationVerify.ts) +
 * [src/lib/citationWash.ts](file:///d:/baimiaobiji/src/lib/citationWash.ts) 的 pipeline：
 *   1. washCitations(markdown)         同步：把 #log_id_<UUID> 洗成 [引用](#log_id_<UUID>)
 *   2. verifyCitations(washed)         异步：查 db.raw_logs，标 broken
 *   3. 把 broken 处的 marker 替换成 <span class="citation-broken"> 文本
 *   4. ReactMarkdown 渲染（含自定义 link onClick）
 *
 * 设计权衡：
 *   - 把 marker→span 的转换放在 pipeline 阶段而非 React 阶段，避免在
 *     dangerouslySetInnerHTML / React 树里做正则替换
 *   - 第一次 useEffect 触发 verify；markdown 变化时再触发
 *   - 性能 ~2ms / 100KB（实测，见 tests/citation-verify.test.ts V8）
 *
 * 替代了原来三处裸用 ReactMarkdown + washCitations 的写法（Review / Insights / ContextChat）。
 */

import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { washCitations } from '../lib/citationWash';
import { verifyCitations, BROKEN_MARKER, type CitationVerifyResult } from '../lib/citationVerify';

interface Props {
  markdown: string;
  className?: string;
  /** 可选：自定义 link 渲染（如加上跳转 raw log 的 onClick） */
  linkRenderer?: (props: { href?: string; children: React.ReactNode }) => React.ReactNode;
  /** 可选：broken 徽标内容（默认带数量提示） */
  renderBadge?: (broken: CitationVerifyResult['broken']) => React.ReactNode;
}

/**
 * 把 broken marker 包裹的 `[引用](#log_id_xxx)` 渲染成 HTML span。
 * 因为 ReactMarkdown 会把 `[文本](href)` 渲染成 `<a href>`，我们让 broken 处
 * 的文本变成 `<span class="citation-broken">引用</span>`，再交给 ReactMarkdown
 * 处理链接的 onClick。
 *
 * 实操：把 broken 处的 `[引用](#log_id_xxx)` 整段换成 `<span class="citation-broken">引用</span>`，
 * 删掉链接部分（保留可视文本）。
 */
function convertBrokenMarkersToSpans(cleaned: string): string {
  if (!cleaned.includes(BROKEN_MARKER)) return cleaned;
  // 匹配 [<text>](#log_id_<uuid>)<!--broken-citation-->
  return cleaned.replace(
    /\[([^\]]*)\]\((#log_id_[0-9a-f-]{36})\)<!--broken-citation-->/g,
    (_, text, href) => `[<span class="citation-broken" data-broken-href="${href}">${text}</span>](${href})`
  );
}

export function VerifiedMarkdown({
  markdown,
  className,
  linkRenderer,
  renderBadge,
}: Props) {
  const [cleaned, setCleaned] = useState<string>(markdown);
  const [broken, setBroken] = useState<CitationVerifyResult['broken']>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const washed = washCitations(markdown);
    verifyCitations(washed).then(r => {
      if (cancelled) return;
      // 把 marker 转成 <span class="citation-broken">引用</span>（保留 link 语法）
      const withSpans = convertBrokenMarkersToSpans(r.cleaned);
      setCleaned(withSpans);
      setBroken(r.broken);
      setReady(true);
    });
    return () => { cancelled = true; };
  }, [markdown]);

  return (
    <>
      {ready && broken.length > 0 && (
        renderBadge ? renderBadge(broken) : (
          <div
            className="broken-citation-badge"
            title={broken.map(b => `引用 [${b.uuid.slice(0, 8)}] 无法溯源`).join('\n')}
          >
            ⚠️ {broken.length} 处引用无法溯源
          </div>
        )
      )}
      <div className={className}>
        <ReactMarkdown
          components={{
            a: ({ href, children, ...props }) => {
              if (linkRenderer) {
                return <>{linkRenderer({ href, children })}</>;
              }
              return <a href={href} {...props}>{children}</a>;
            },
          }}
        >
          {cleaned}
        </ReactMarkdown>
      </div>
    </>
  );
}

/**
 * 简化版「只 verify 不渲染」：用于日记 / 回顾 / 洞察详情页拿到 cleaned + broken 列表。
 */
export async function verifyAndClean(markdown: string): Promise<{
  cleaned: string;
  broken: CitationVerifyResult['broken'];
}> {
  const washed = washCitations(markdown);
  const r = await verifyCitations(washed);
  return { cleaned: r.cleaned, broken: r.broken };
}