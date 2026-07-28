/**
 * 卡片 sub-header 槽位标签 helper。
 *
 * 用途：回顾 / 洞察卡片底部那一行 `{统摄名}（{槽位标签}） · {时间}`
 * 中括号里的"槽位标签"——让用户一眼看出这条卡片由哪个 prompt 槽位产出。
 *
 * 优先级：
 *   1. 用户在设置里改过的 prompt_name（用户语义）
 *   2. 固定槽名（i18n，区分 review/insight 的 slot 0/1 语义不同）
 *   3. 都缺 → 'settings.promptDefault' 兜底
 *
 * 设计要点：
 *   - 0 后端 / schema 改动：只读 prompt_index + prompt_name
 *   - 复用 settings.prompt* i18n key，确保卡片显示与浮层显示的"槽位名"完全一致
 */
type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export type SlotKind = 'review' | 'insight';

/**
 * 返回卡片 sub-header 括号里的槽位标签。
 *
 * @param promptName 用户在设置里给该槽位起的名字（可改）；为空时 fallback 到固定槽名
 * @param promptIndex 槽位索引 0~4
 * @param t i18n 翻译函数（来自 useTranslation）
 * @param kind 'review' → 5 槽为 日记/回顾/自定义 1/2/3
 *             'insight' → 5 槽为 明悟/洞察/自定义 1/2/3
 */
export function slotLabel(
  promptName: string | undefined,
  promptIndex: number | undefined,
  t: TranslateFn,
  kind: SlotKind,
): string {
  const trimmed = promptName?.trim();
  if (trimmed) return trimmed;
  switch (promptIndex) {
    case 0:
      return t(kind === 'review' ? 'settings.promptDiary' : 'settings.promptMingwu');
    case 1:
      return t(kind === 'review' ? 'settings.promptReview' : 'settings.promptInsight');
    case 2:
      return t('settings.promptCustom1');
    case 3:
      return t('settings.promptCustom2');
    case 4:
      return t('settings.promptCustom3');
    default:
      return t('settings.promptDefault');
  }
}