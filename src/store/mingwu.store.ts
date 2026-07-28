/**
 * #8 洞察（Insight）模块 -- Zustand store。
 *
 * 一次生成可按用户选中的 1-5 个 prompt 槽位（slot 0=明悟，slot 1=洞察，slot 2-4=自定义 1/2/3），
 * 每个槽位独立调用 /api/generate-insight 一次，生成一张 Insight 卡片。
 * 数据源：所选时间范围的 raw_logs + thoughts。生成时按 settings.submitMultimedia
 * 决定是否向模型提交多媒体摘要（raw_logs.attachment_summary）。
 *
 * 标签改为用户手动管理：生成时不再调用 parseTagsFromText，新生成的洞察 tags 字段
 * 默认为空数组；regenerate 时保留用户已手动添加的标签。手动编辑 UI 见 Insights.tsx。
 *
 * 生成队列状态托管在 app.store（isGeneratingInsight / insightError），本 store 负责逻辑。
 */
import { create } from 'zustand';
import { db, type Insight } from '../db/db';
import { generateUUID } from '../lib/utils';
import { useSettingsStore } from './settings.store';
import { useAppStore } from './app.store';
import { format } from 'date-fns';

interface GenerateMingwuParams {
  rangeType: string;
  startTime: number;
  endTime: number;
  rangeLabel: string;
  /** C2 新增：用户选中的 5 槽索引列表（0..4）。缺省取 useSettingsStore().mingwuInsightSelectedIndices ?? [0, 1]。 */
  selectedIndices?: number[];
}

interface MingwuState {
  /** 按选中的 1-5 个 prompt 槽位循环生成 Insight 卡片。 */
  generateMingwu: (params: GenerateMingwuParams) => Promise<void>;
  /** 重新生成单张卡片（按 oldInsight.prompt_index 索引回 mingwuInsightPrompts）。 */
  regenerateMingwu: (oldInsight: Insight) => Promise<void>;
}

/**
 * 把 slot index 映射到 insight_type 字段值：slot 0=明悟，slot 1=洞察，其他=custom。
 * InsightCard 徽章（Insights.tsx）与 RandomWalk 标签都据此判断显示「明悟/洞察/自定义名」。
 */
function insightTypeForSlot(slotIndex: number): 'mingwu' | 'insight' | 'custom' {
  if (slotIndex === 0) return 'mingwu';
  if (slotIndex === 1) return 'insight';
  return 'custom';
}

/**
 * 拉取时间范围内的 raw_logs + thoughts，按 settings.submitMultimedia 决定是否附带
 * raw_logs.attachment_summary，再按 selectedIndices 构造 settings.prompts[] 供 API 循环生成。
 * 空 content 的 prompt 会在此过滤掉，不发请求（保留 settings.prompts 顺序与 selectedIndices 一致）。
 */
async function buildMingwuPayload(
  startTime: number,
  endTime: number,
  rangeLabel: string,
  selectedIndices: number[],
) {
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

  // 5 槽统一字段 + 兼容旧字段（mingwuPrompt/insightPrompt/insightSummaryPrompt）
  const mingwuInsightPrompts = settings.mingwuInsightPrompts || [];
  const mingwuInsightPromptNames = settings.mingwuInsightPromptNames || [];
  const prompts = selectedIndices
    .map((idx) => ({
      index: idx,
      name: mingwuInsightPromptNames[idx] || `自定义 ${idx - 1}`,
      content: mingwuInsightPrompts[idx] || '',
    }))
    .filter((p) => p.content.trim().length > 0);

  return {
    logs: logsPayload,
    thoughts: thoughtsPayload,
    rangeLabel,
    settings: {
      ...settings,
      prompts,
      summaryPrompt: settings.mingwuInsightSummaryPrompt,
      // 兼容字段：旧 API 路径（不含 prompts[]）仍可读
      mingwuPrompt: mingwuInsightPrompts[0],
      insightPrompt: mingwuInsightPrompts[1],
      insightSummaryPrompt: settings.mingwuInsightSummaryPrompt,
    },
  };
}

/**
 * 调 /api/generate-insight；返回 { results: Array<{index, name, report, summary}> }。
 * 旧 API 路径下 results 为空数组，调用方需自行 fallback 到 mingwu_report/insight_report。
 */
async function callMingwuApi(payload: {
  logs: any[];
  thoughts: any[];
  rangeLabel: string;
  settings: any;
}) {
  const res = await fetch('/api/generate-insight', {
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
    /** C2 新 schema：循环生成结果，按 slot index 索引 */
    results?: Array<{ index: number; name: string; report: string; summary: string }>;
    /** Legacy 双报告字段（仅当 settings.prompts[] 缺失时填充） */
    mingwu_report?: string;
    mingwu_summary?: string;
    insight_report?: string;
    insight_summary?: string;
  }>;
}

export const useMingwuStore = create<MingwuState>(() => ({
  generateMingwu: async ({ rangeType, startTime, endTime, rangeLabel, selectedIndices }) => {
    const appStore = useAppStore.getState();
    appStore.clearMingwuError();
    useAppStore.setState({ isGeneratingMingwu: true });

    try {
      const indices = selectedIndices
        ?? useSettingsStore.getState().mingwuInsightSelectedIndices
        ?? [0, 1];

      const payload = await buildMingwuPayload(startTime, endTime, rangeLabel, indices);

      if (payload.logs.length === 0 && payload.thoughts.length === 0) {
        throw new Error('这段时间内还没有任何记录。换个时间范围或者去记录点什么吧！');
      }

      const data = await callMingwuApi(payload);

      const startDateIso = new Date(startTime).toISOString();
      const endDateIso = new Date(endTime).toISOString();
      const now = Date.now();
      const nameMap = useSettingsStore.getState().mingwuInsightPromptNames || [];

      // 按 selectedIndices 顺序落库，保证列表展示顺序稳定
      let baseTimestamp = now;
      for (let i = 0; i < indices.length; i++) {
        const slotIdx = indices[i];
        // 优先从新 schema 的 results 找；找不到再 fallback 到 legacy 双报告字段（仅 slot 0/1 适用）
        const result = data.results?.find((r) => r.index === slotIdx);
        let report = result?.report;
        let summary = result?.summary;
        let promptName = result?.name || nameMap[slotIdx] || `自定义 ${slotIdx - 1}`;

        if (!report) {
          if (slotIdx === 0) {
            report = data.mingwu_report;
            summary = data.mingwu_summary;
            promptName = nameMap[0] || '明悟';
          } else if (slotIdx === 1) {
            report = data.insight_report;
            summary = data.insight_summary;
            promptName = nameMap[1] || '洞察';
          }
        }
        if (!report) continue; // 服务端未返回该槽的报告，跳过

        const insightCard: Insight = {
          id: generateUUID(),
          range_type: rangeType,
          range_label: rangeLabel,
          start_date: startDateIso,
          end_date: endDateIso,
          content: report,
          ai_summary: (summary || '').toString().trim() || '暂无内容概要',
          insight_type: insightTypeForSlot(slotIdx),
          prompt_index: slotIdx,
          prompt_name: promptName,
          created_at: baseTimestamp + i,   // 保证 list 顺序与 selectedIndices 一致
          tags: [],                        // #insight-manual-tags: 标签由用户在 Insights.tsx 手动添加
        };
        await db.insights.add(insightCard);
      }
    } catch (err: any) {
      console.error(err);
      useAppStore.setState({ mingwuError: err.message || '生成失败，请重试' });
    } finally {
      useAppStore.setState({ isGeneratingMingwu: false });
    }
  },

  regenerateMingwu: async (oldInsight) => {
    const appStore = useAppStore.getState();
    appStore.clearMingwuError();
    useAppStore.setState({ isGeneratingMingwu: true });

    try {
      const startTime = new Date(oldInsight.start_date).getTime();
      const endTime = new Date(oldInsight.end_date).getTime();
      const rangeLabel = oldInsight.range_label;

      // 解析旧卡对应的 slot：prompt_index 优先 → prompt_name 反查 → insight_type 推断 → 兜底 0
      const settings = useSettingsStore.getState();
      const prompts = settings.mingwuInsightPrompts || [];
      const names = settings.mingwuInsightPromptNames || [];
      let slotIdx = oldInsight.prompt_index;
      if (slotIdx === undefined || prompts[slotIdx] === undefined) {
        const byName = names.findIndex((n) => n === oldInsight.prompt_name);
        if (byName >= 0) {
          slotIdx = byName;
        } else if (oldInsight.insight_type === 'mingwu') {
          slotIdx = 0;
        } else if (oldInsight.insight_type === 'insight') {
          slotIdx = 1;
        } else {
          slotIdx = 0;  // 旧卡无法解析时最保守降级到 slot 0
        }
      }

      const promptContent = prompts[slotIdx] || '';
      const promptName = names[slotIdx] || oldInsight.prompt_name || `自定义 ${slotIdx - 1}`;

      // 单槽 payload：仅向 API 发 1 个 prompt（比旧实现「跑 2 个 LLM 只用 1 个」更省）
      const payload = await buildMingwuPayload(
        startTime, endTime, rangeLabel,
        promptContent.trim() ? [slotIdx] : [],   // 空 prompt 不发请求
      );

      if (payload.logs.length === 0 && payload.thoughts.length === 0) {
        throw new Error('此时间段内容为空，无法重新生成。');
      }

      const data = await callMingwuApi(payload);

      // 从 results 取报告；若旧卡对应 slot 0/1 且新 schema 无结果，尝试 legacy 字段
      let report = data.results?.find((r) => r.index === slotIdx)?.report;
      let summary = data.results?.find((r) => r.index === slotIdx)?.summary;
      if (!report) {
        if (slotIdx === 0) {
          report = data.mingwu_report;
          summary = data.mingwu_summary;
        } else if (slotIdx === 1) {
          report = data.insight_report;
          summary = data.insight_summary;
        }
      }
      if (!report) {
        throw new Error('重新生成失败：服务端未返回报告');
      }

      const preservedTags = oldInsight.tags || [];
      if (oldInsight.id) {
        await db.insights.delete(oldInsight.id);
      }
      await db.insights.add({
        id: generateUUID(),
        range_type: oldInsight.range_type,
        range_label: rangeLabel,
        start_date: oldInsight.start_date,
        end_date: oldInsight.end_date,
        content: report,
        ai_summary: (summary || '').toString().trim() || oldInsight.ai_summary || '暂无内容概要',
        insight_type: oldInsight.insight_type,        // 保持原卡类型，UI 沿用原徽章色
        prompt_index: slotIdx,
        prompt_name: promptName,
        created_at: Date.now(),
        tags: preservedTags,
      });
    } catch (err: any) {
      console.error(err);
      useAppStore.setState({ mingwuError: err.message || '重新生成失败，请重试' });
    } finally {
      useAppStore.setState({ isGeneratingMingwu: false });
    }
  },
}));
