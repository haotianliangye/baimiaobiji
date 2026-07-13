// #14 统一分块与向量化 pipeline -- 文本分块模块
//
// 职责：把一段清洗后的文本按 token 预算切成可被 embedding 的分块。
// 只做「分块」，不做清洗、不做向量生成（那些归 embedding.ts 的 pipeline）。
//
// Token 估算用轻量启发式，避免引入 tiktoken 等大型依赖：
//   - CJK 字符（中日韩）按 ~1.5 token/字 估算（BPE 常把一个汉字拆成 1-3 token）；
//   - 拉丁文按 ~1.3 token/词 估算；
//   - 其余字符（标点 / 空格 / emoji）已被词/字覆盖，不再额外计。
// 估算偏保守（略高），保证分块不会超出 embedding 模型的输入上限。

// CJK 统一表意文字 + 扩展 A + 日文假名 + 韩文音节
const CJK_REGEX = /[一-鿿㐀-䶿぀-ヿ가-힯]/g;

/**
 * 估算文本的 token 数（轻量启发式，非精确）。
 * 用于决定分块边界，不依赖 tiktoken 等外部 tokenizer。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkMatches = text.match(CJK_REGEX);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  // 剥掉 CJK 后按空白切词，统计拉丁/数字词数
  const nonCjk = text.replace(CJK_REGEX, ' ');
  const words = nonCjk.match(/\S+/g);
  const wordCount = words ? words.length : 0;
  return Math.ceil(cjkCount * 1.5 + wordCount * 1.3);
}

export interface ChunkOptions {
  /** 单块 token 上限，超出则切分。默认 512。 */
  maxTokens: number;
  /** 相邻块之间的重叠 token 数，避免语义在边界被切断。默认 64。 */
  overlapTokens: number;
  /** 尾块过短时合并入上一块的最小阈值。默认 32。 */
  minChunkTokens: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxTokens: 512,
  overlapTokens: 64,
  minChunkTokens: 32,
};

export interface ChunkSlice {
  /** 分块文本 */
  text: string;
  /** 分块序号（0-based） */
  index: number;
}

/**
 * 按句末标点（中日韩 + 拉丁）与换行把文本拆成「句子」单元，保留分隔符。
 * 落在块边界时尽量不切断句子，保证语义完整。
 */
function splitIntoUnits(text: string): string[] {
  const parts = text.split(/(?<=[。！？；…\n.!?;])/);
  return parts
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 从文本末尾向前取约 targetTokens 个 token 的尾部文本，用作下一块的重叠前缀。
 */
function takeTailByText(text: string, targetTokens: number): string {
  if (targetTokens <= 0 || !text) return '';
  const chars = Array.from(text);
  let acc = '';
  for (let i = chars.length - 1; i >= 0; i--) {
    const candidate = chars[i] + acc;
    if (estimateTokens(candidate) > targetTokens) break;
    acc = candidate;
  }
  return acc;
}

/**
 * 将文本切分为多个分块。
 *
 * 策略：
 *   1. 短文本（<= maxTokens）直接作为单块返回——这是 raw_logs / thoughts 的常见情况。
 *   2. 长文本先按句子拆分，贪心填充至 maxTokens；超出时落块，并携带上一块尾部
 *      overlapTokens 作为下一块前缀，保证边界语义连续。
 *   3. 单个句子本身超限时，按字符硬切。
 *   4. 尾块过短（< minChunkTokens）合并入上一块，避免碎屑。
 *
 * 返回的 ChunkSlice 数组始终按 index 升序；空文本返回空数组。
 */
export function chunkText(text: string, opts?: Partial<ChunkOptions>): ChunkSlice[] {
  const o = { ...DEFAULT_CHUNK_OPTIONS, ...opts };
  const cleaned = text.trim();
  if (!cleaned) return [];

  // 短文本：单块（最常见路径，行为与重构前一致）
  if (estimateTokens(cleaned) <= o.maxTokens) {
    return [{ text: cleaned, index: 0 }];
  }

  const units = splitIntoUnits(cleaned);
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = '';
  };

  for (const unit of units) {
    const unitTokens = estimateTokens(unit);

    if (unitTokens > o.maxTokens) {
      // 单句超长：先落当前块，再按字符硬切该句
      flush();
      const chars = Array.from(unit);
      let buf = '';
      for (const ch of chars) {
        buf += ch;
        if (estimateTokens(buf) >= o.maxTokens) {
          chunks.push(buf.trim());
          buf = takeTailByText(buf, o.overlapTokens);
        }
      }
      if (buf.trim()) current = buf;
      continue;
    }

    const currentTokens = estimateTokens(current);
    if (current && currentTokens + unitTokens > o.maxTokens) {
      flush();
      // 重叠：把上一块尾部带入下一块前缀
      const overlap =
        chunks.length > 0 ? takeTailByText(chunks[chunks.length - 1], o.overlapTokens) : '';
      current = overlap + unit;
    } else {
      current = current ? current + unit : unit;
    }
  }
  flush();

  // 尾块过短：合并入上一块
  if (chunks.length >= 2 && estimateTokens(chunks[chunks.length - 1]) < o.minChunkTokens) {
    const tail = chunks.pop()!;
    chunks[chunks.length - 1] = (chunks[chunks.length - 1] + tail).trim();
  }

  return chunks
    .filter((t) => t.length > 0)
    .map((text, index) => ({ text, index }));
}
