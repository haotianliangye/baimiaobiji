/**
 * hallucinationFilter — 转写幻觉检测
 *
 * Issue #004 引入。原因：原 [server.ts:756](file:///d:/baimiaobiji/server.ts#L756) 硬编码黑名单
 * （"[EMPTY_AUDIO]", "谢谢观看" 等）藏在后端，用户无法编辑、新模式要改代码+重新部署。
 *
 * 此模块做三件事：
 *   1. 把默认黑名单公开化（getDefaultPatterns）
 *   2. 单一 match 函数（matchPattern）—— exact 或 regex 都走同一接口
 *   3. confidence 评分（computeConfidence）—— 区分直接丢弃（high）vs 保留但标记（medium/low）
 *
 * 数据存储侧（IndexedDB settings_kv 表）见 src/db/db.ts v15。
 * 本模块保持纯函数 + 零依赖，可独立单元测试（tests/hallucination-filter.test.ts）。
 *
 * 关键设计：
 *   - confidence 用 transcript **实际字符数**（去标点、去空格）而不是原始 bytes，
 *     因为 LLM 转写的内容里面会含 "[音乐]"、停顿符等噪音
 *   - invalid regex 不抛错，吞掉返回 no match（生产环境的运维老路：第三方的脏 pattern）
 *   - 默认 patterns 是「金标准」，但前端用户增删都允许（包括删掉默认）
 */

export type HallucinationPatternType = 'exact' | 'regex';

export interface HallucinationPattern {
  /** 唯一标识（前端生成 crypto.randomUUID()） */
  key: string;
  /** exact=精确匹配（含子串），regex=正则 */
  type: HallucinationPatternType;
  /** 要匹配的字符串或正则表达式 */
  value: string;
  /** 用户备注，可选 */
  description?: string;
  /** 创建时间戳 */
  created_at: number;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface MatchResult {
  matched: HallucinationPattern | null;
  /** 命中后计算的可信度；未命中时为 null */
  confidence: Confidence | null;
  /** 调试字段：多少字时命中的 */
  trimmedLength: number;
}

/**
 * 默认黑名单（金标准）。
 *
 * 移植自 server.ts:756 原硬编码列表：
 *   "[EMPTY_AUDIO]", "EMPTY_AUDIO", "谢谢观看", "字幕提供",
 *   "请不吝赐教", "字幕", "Thank you", "空白", "空音频", "没有声音",
 *   "请把上面的语音文件", "转录为简体中文", "如果是静音", "[静音]"
 *
 * 注意：
 *   - "[EMPTY_AUDIO]" 是占位符，必须保留 exact 匹配
 *   - "请把上面的语音文件" 等是 Gemini 系统提示的回显，前几个 chunk 容易回显
 *   - "关注.*订阅" 是 YouTube 常见幻觉，用 regex 抓
 */
export function getDefaultPatterns(): Omit<HallucinationPattern, 'created_at'>[] {
  return [
    // 静音 / 占位符
    { key: 'default-empty-audio', type: 'exact', value: '[EMPTY_AUDIO]', description: '静音或纯噪音时的占位符' },
    { key: 'default-empty-audio-word', type: 'exact', value: 'EMPTY_AUDIO', description: '无方括号变体' },
    { key: 'default-blank', type: 'exact', value: '空白', description: '空白' },
    { key: 'default-empty', type: 'exact', value: '空音频', description: '空音频' },
    { key: 'default-no-sound', type: 'exact', value: '没有声音', description: '没有声音' },
    { key: 'default-mute-bracket', type: 'exact', value: '[静音]', description: '方括号静音' },
    { key: 'default-ai-only', type: 'exact', value: '哎', description: '单字噪音（与 length<=1 配合）' },

    // 视频结尾常见幻觉
    { key: 'default-thanks-watching', type: 'exact', value: '谢谢观看', description: 'YouTube/视频结尾常见' },
    { key: 'default-subtitle-provider', type: 'exact', value: '字幕提供', description: '字幕组回声' },
    { key: 'default-feedback', type: 'exact', value: '请不吝赐教', description: '弹幕/教程结尾' },
    { key: 'default-subtitle', type: 'exact', value: '字幕', description: '字幕回声' },
    { key: 'default-thank-you', type: 'exact', value: 'Thank you', description: '英文结尾（仅当孤句时）' },

    // Gemini 系统提示回显（spec 提到的）
    { key: 'default-gemini-echo-1', type: 'exact', value: '请把上面的语音文件', description: 'Gemini prompt 回声' },
    { key: 'default-gemini-echo-2', type: 'exact', value: '转录为简体中文', description: 'Gemini prompt 回声' },
    { key: 'default-gemini-echo-3', type: 'exact', value: '如果是静音', description: 'Gemini prompt 回声' },

    // Youtuber 风格订阅引导
    { key: 'default-subscribe', type: 'regex', value: '关注.*订阅', description: 'YouTuber 风格' },
  ];
}

/**
 * 把 transcript 标准化成"有效长度"用于 confidence 计算。
 * - 去前后空格
 * - 去常见标点（中英、句末、停顿号）
 * - 去空白字符
 *
 * 注意：不去 emoji，因为 emoji 是合法字符（比如一行回声包含 🈚️ 不算短）。
 */
function trimmedLength(text: string): number {
  return text
    .trim()
    .replace(/[.,!?;:'"。，！？；：'"'()（）【】\[\]\-_—…\s]+/g, '')
    .length;
}

/**
 * 单一匹配入口。
 *
 * 行为：
 *   - exact 类型：text.includes(value)
 *   - regex 类型：try/catch 包 new RegExp(value).test(text)
 *   - 命中返回第一个匹配的 pattern + 子字符串范围（debug 用，可选）
 *   - 全没命中返回 { matched: null }
 *
 * 设计：不依赖全局 Map/缓存（低 LRU 复杂度无意义，每次只匹配几十个 patterns）。
 */
export function matchPattern(
  text: string,
  patterns: HallucinationPattern[] | Omit<HallucinationPattern, 'created_at'>[]
): MatchResult {
  const len = trimmedLength(text);
  if (!text || patterns.length === 0) {
    return { matched: null, confidence: null, trimmedLength: len };
  }

  for (const p of patterns) {
    let hit = false;
    if (p.type === 'exact') {
      hit = text.includes(p.value);
    } else if (p.type === 'regex') {
      try {
        const re = new RegExp(p.value);
        hit = re.test(text);
      } catch {
        // invalid regex：吞掉，不抛错（用户可能在前端输错的脏 pattern）
        hit = false;
      }
    }
    if (hit) {
      return { matched: p as HallucinationPattern, confidence: null, trimmedLength: len };
    }
  }

  return { matched: null, confidence: null, trimmedLength: len };
}

/**
 * 计算 confidence。
 *
 * 规则：
 *   - 未命中（matched=null）→ null
 *   - trimmedLength < 5 → high（极短的内容 + pattern 命中 = 100% 噪声）
 *   - trimmedLength > 50 → low（即使命中也可能是误伤，正常保留）
 *   - 其他 → medium（保留但标记 UI 提示）
 *
 * 边界值与规格一致：
 *   - 4 字 → high
 *   - 5 字 → medium（因为是 < 5 high, 5 都不算 < 5）
 *   - 50 字 → medium
 *   - 51 字 → low
 */
export function computeConfidence(
  text: string,
  matched: HallucinationPattern | null,
  _patterns: HallucinationPattern[] | Omit<HallucinationPattern, 'created_at'>[]
): Confidence | null {
  if (!matched) return null;
  const len = trimmedLength(text);
  if (len < 5) return 'high';
  if (len > 50) return 'low';
  return 'medium';
}

export interface DropDecision {
  drop: boolean;
  reason?: string;
}

/**
 * 决定转写结果是否应该丢弃。
 *
 *   - confidence = high → drop=true（强信号，扔）
 *   - confidence = medium/low → drop=false（保留但 return reason 给前端显示警告）
 *   - matched=null → drop=false（正常人话不该过滤）
 */
export function shouldDropTranscript(
  text: string,
  matched: HallucinationPattern | null,
  confidence: Confidence | null
): DropDecision {
  if (!matched || !confidence) {
    return { drop: false };
  }

  if (confidence === 'high') {
    return {
      drop: true,
      reason: `转写疑似幻觉（pattern: ${matched.key}，${trimmedLength(text)}字命中），已丢弃`,
    };
  }

  const severity = confidence === 'low' ? '较低' : '一般';
  return {
    drop: false,
    reason: `转写包含已知噪音片段（pattern: ${matched.key}），可信度${severity}（${trimmedLength(text)}字）`,
  };
}

/**
 * 一次性 helper：匹配 + 评分 + drop 决策。
 * server.ts 转写后调用这一个函数即可拿到 { finalText, dropped, reason }。
 */
export function evaluateTranscript(
  text: string,
  patterns: HallucinationPattern[] | Omit<HallucinationPattern, 'created_at'>[]
): {
  dropped: boolean;
  finalText: string;
  reason?: string;
  confidence: Confidence | null;
} {
  const match = matchPattern(text, patterns);
  const confidence = computeConfidence(text, match.matched, patterns);
  const decision = shouldDropTranscript(text, match.matched, confidence);

  return {
    dropped: decision.drop,
    finalText: decision.drop ? '' : text,
    reason: decision.reason,
    confidence,
  };
}