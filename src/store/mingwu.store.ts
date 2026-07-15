/**
 * #8 洞察（Mingwu）模块 -- Zustand store。
 *
 * 将原「洞察」升级为「明悟」：一次生成同时产出「明悟」(mingwu_type='mingwu')
 * 与「洞察」(mingwu_type='insight') 两类 AI 卡片。
 *
 * 数据源：所选时间范围的 raw_logs + thoughts。生成时按 settings.submitMultimedia
 * 决定是否向模型提交多媒体摘要（raw_logs.attachment_summary）。
 *
 * AI 产出自动打全局标签：生成文本后用 parseTagsFromText 提取 #标签、resolveAlias
 * 纠正被合并的标签、createTag 落库到全局 tags 表，存入 mingwu.tags（非索引字段）。
 *
 * 生成队列状态托管在 app.store（isGeneratingMingwu / mingwuError），本 store 负责逻辑。
 */
import { create } from 'zustand';
import { db, type Mingwu } from '../db/db';
import { generateUUID } from '../lib/utils';
import { parseTagsFromText, resolveAlias } from '../lib/tags';
import { useTagsStore } from './tags.store';
import { useSettingsStore } from './settings.store';
import { useAppStore } from './app.store';
import { format } from 'date-fns';

interface GenerateMingwuParams {
  rangeType: string;
  startTime: number;
  endTime: number;
  rangeLabel: string;
}

interface MingwuState {
  /** 按时间范围生成「明悟」+「洞察」两类卡片。 */
  generateMingwu: (params: GenerateMingwuParams) => Promise<void>;
  /** 重新生成单张卡片（按 oldMingwu 的时间范围与类型）。 */
  regenerateMingwu: (oldMingwu: Mingwu) => Promise<void>;
}

/**
 * 从文本解析 #标签 -> resolveAlias 纠正 -> createTag 落库，返回去重后的标签路径数组。
 * 与 thoughts.store 的 processTagsFromText 流程一致，保证全局标签系统口径统一。
 */
async function processTagsFromText(text: string): Promise<string[]> {
  const store = useTagsStore.getState();
  await store.refreshAliases();
  const aliases = useTagsStore.getState().aliases;
  const rawTags = parseTagsFromText(text);
  if (rawTags.length === 0) return [];
  const resolved = rawTags.map((t) => resolveAlias(t, aliases));
  const unique = Array.from(new Set(resolved));
  for (const tag of unique) {
    await store.createTag(tag);
  }
  return unique;
}

/**
 * 拉取时间范围内的 raw_logs + thoughts，构建提交给 API 的 payload。
 * 按 settings.submitMultimedia 决定是否附带 raw_logs.attachment_summary。
 */
async function buildMingwuPayload(startTime: number, endTime: number, rangeLabel: string) {
  const settings = { ...useSettingsStore.getState() };

  const logs = await db.raw_logs
    .where('created_at')
    .between(startTime, endTime, true, true)
    .toArray();

  const thoughts = await db.thoughts
    .where('created_at')
    .between(startTime, endTime, true, true)
    .toArray();

  // 仅当 submitMultimedia 开启时附带多媒体摘要
  const submitMultimedia = settings.submitMultimedia;

  const logsPayload = logs.map((l) => ({
    id: l.id,
    date: format(new Date(l.created_at), 'yyyy-MM-dd HH:mm'),
    content: l.content,
    ...(submitMultimedia && l.attachment_summary ? { attachment_summary: l.attachment_summary } : {}),
  }));

  const thoughtsPayload = thoughts.map((t) => ({
    id: t.id,
    date: format(new Date(t.created_at), 'yyyy-MM-dd HH:mm'),
    content: t.content,
  }));

  return { logs: logsPayload, thoughts: thoughtsPayload, rangeLabel, settings };
}

/**
 * 调用 /api/generate-mingwu 端点，返回明悟与洞察两份报告。
 */
async function callMingwuApi(payload: {
  logs: any[];
  thoughts: any[];
  rangeLabel: string;
  settings: any;
}) {
  const res = await fetch('/api/generate-mingwu', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeRangeLabel: payload.rangeLabel,
      logs: payload.logs,
      thoughts: payload.thoughts,
      settings: payload.settings,
    }),
  });

  if (!res.ok) {
    let errStr = await res.text();
    try {
      const d = JSON.parse(errStr);
      errStr = d.error || errStr;
    } catch (e) {
      /* ignore parse error */
    }
    throw new Error(errStr);
  }

  return res.json() as Promise<{
    mingwu_report: string;
    mingwu_summary: string;
    insight_report: string;
    insight_summary: string;
  }>;
}

export const useMingwuStore = create<MingwuState>(() => ({
  generateMingwu: async ({ rangeType, startTime, endTime, rangeLabel }) => {
    const appStore = useAppStore.getState();
    appStore.clearMingwuError();
    useAppStore.setState({ isGeneratingMingwu: true });

    try {
      const payload = await buildMingwuPayload(startTime, endTime, rangeLabel);

      if (payload.logs.length === 0 && payload.thoughts.length === 0) {
        throw new Error('这段时间内还没有任何记录。换个时间范围或者去记录点什么吧！');
      }

      const data = await callMingwuApi(payload);

      const startDateIso = new Date(startTime).toISOString();
      const endDateIso = new Date(endTime).toISOString();
      const now = Date.now();

      // #008 US36: 读取 mingwuInsightSelectedIndices，只落库选中的类型。
      // slot 0 = 明悟(mingwu)，slot 1 = 洞察(insight)。默认两者皆选，让「自动生成选中」复选框真正生效。
      // 后端 /api/generate-mingwu 仍同时生成两份报告（未在本次改动范围），此处按选中过滤落库。
      const selectedIndices = useSettingsStore.getState().mingwuInsightSelectedIndices || [0, 1];
      const wantMingwu = selectedIndices.includes(0);
      const wantInsight = selectedIndices.includes(1);

      // 明悟卡片
      if (wantMingwu && data.mingwu_report) {
        const mingwuTags = await processTagsFromText(data.mingwu_report);
        const mingwuCard: Mingwu = {
          id: generateUUID(),
          range_type: rangeType,
          range_label: rangeLabel,
          start_date: startDateIso,
          end_date: endDateIso,
          content: data.mingwu_report,
          ai_summary: (data.mingwu_summary || '').toString().trim() || '暂无内容概要',
          mingwu_type: 'mingwu',
          created_at: now,
          tags: mingwuTags,
        };
        await db.mingwu.add(mingwuCard);
      }

      // 洞察卡片（时间戳略晚 1ms，保证列表中明悟在前）
      if (wantInsight && data.insight_report) {
        const insightTags = await processTagsFromText(data.insight_report);
        const insightCard: Mingwu = {
          id: generateUUID(),
          range_type: rangeType,
          range_label: rangeLabel,
          start_date: startDateIso,
          end_date: endDateIso,
          content: data.insight_report,
          ai_summary: (data.insight_summary || '').toString().trim() || '暂无内容概要',
          mingwu_type: 'insight',
          created_at: now + 1,
          tags: insightTags,
        };
        await db.mingwu.add(insightCard);
      }
    } catch (err: any) {
      console.error(err);
      useAppStore.setState({ mingwuError: err.message || '生成失败，请重试' });
    } finally {
      useAppStore.setState({ isGeneratingMingwu: false });
    }
  },

  regenerateMingwu: async (oldMingwu) => {
    const appStore = useAppStore.getState();
    appStore.clearMingwuError();
    useAppStore.setState({ isGeneratingMingwu: true });

    try {
      const startTime = new Date(oldMingwu.start_date).getTime();
      const endTime = new Date(oldMingwu.end_date).getTime();
      const rangeLabel = oldMingwu.range_label;

      const payload = await buildMingwuPayload(startTime, endTime, rangeLabel);

      if (payload.logs.length === 0 && payload.thoughts.length === 0) {
        throw new Error('此时间段内容为空，无法重新生成。');
      }

      const data = await callMingwuApi(payload);

      const startDateIso = oldMingwu.start_date;
      const endDateIso = oldMingwu.end_date;
      const now = Date.now();

      // 根据原卡片类型决定用哪份报告替换
      const isMingwuType = oldMingwu.mingwu_type === 'mingwu';
      const report = isMingwuType ? data.mingwu_report : data.insight_report;
      const summary = isMingwuType ? data.mingwu_summary : data.insight_summary;

      if (report) {
        const tags = await processTagsFromText(report);
        // 删除旧卡片，添加新卡片
        if (oldMingwu.id) {
          await db.mingwu.delete(oldMingwu.id);
        }
        await db.mingwu.add({
          id: generateUUID(),
          range_type: oldMingwu.range_type,
          range_label: rangeLabel,
          start_date: startDateIso,
          end_date: endDateIso,
          content: report,
          ai_summary: (summary || '').toString().trim() || oldMingwu.ai_summary || '暂无内容概要',
          mingwu_type: oldMingwu.mingwu_type,
          created_at: now,
          tags,
        });
      }
    } catch (err: any) {
      console.error(err);
      useAppStore.setState({ mingwuError: err.message || '重新生成失败，请重试' });
    } finally {
      useAppStore.setState({ isGeneratingMingwu: false });
    }
  },
}));
