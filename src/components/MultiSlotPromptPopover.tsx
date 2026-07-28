/**
 * 5 槽多选 Prompt 浮层 — 复用于 Review / Insights（未来可扩展更多页）。
 *
 * 视觉与交互来自 Review.tsx:838-905 的内联 JSX；抽出目的是消除 C4 中 Insights.tsx 的重复 JSX。
 * 数据驱动：slots 数组 + selectedIndices，UI 只负责呈现 + 转发用户操作。
 */
import { X, Sparkles, CheckSquare, Square } from 'lucide-react';
import { useTranslation } from '../lib/i18n';
import { calcPopoverTop, clampPopoverLeft } from '../lib/popover';

export interface MultiSlotPromptPopoverSlot {
  /** 槽位显示名（中文/英文，跟随 i18n） */
  name: string;
  /** 该槽位是否已配置 prompt 正文（用于显示「已配置」徽章） */
  hasContent: boolean;
  /** 槽位是否固定名（不可改名），用于显示「默认」徽章 */
  isFixed: boolean;
}

export interface MultiSlotPromptPopoverProps {
  visible: boolean;
  /** 触发按钮的视口坐标（getBoundingClientRect），用于 fixed 定位 */
  anchorRect: DOMRect | null;
  /** 5 槽的展示元数据 */
  slots: MultiSlotPromptPopoverSlot[];
  /** 当前选中的 slot 索引列表（至少 1 项） */
  selectedIndices: number[];
  /** 切换单个 slot 的回调（外层维护「至少保留 1 项」规则） */
  onToggle: (index: number) => void;
  /** 「生成 N 篇」按钮点击回调（外层负责关闭浮层 + 真正发起请求） */
  onGenerate: () => void;
  /** 浮层关闭回调（背景遮罩 / X 按钮 / 业务取消） */
  onClose: () => void;
  /** 浮层顶部标题 i18n key（如 'review.selectTemplate'） */
  titleKey: string;
  /** 「生成 N 篇」按钮文案 i18n key，支持 {count} 占位符 */
  generateLabelKey: string;
  /** 「已配置」徽章 i18n key（默认 'review.configured'） */
  configuredKey?: string;
  /** 「默认」徽章 i18n key（默认 'settings.promptDefault'） */
  defaultBadgeKey?: string;
  /** 浮层宽度（默认 220） */
  width?: number;
  /** 复选行 testid 前缀，默认 'prompt-slot-' */
  testIdPrefix?: string;
  /** 「生成 N 篇」按钮 testid，默认 'popover-generate-n-btn' */
  generateBtnTestId?: string;
}

export function MultiSlotPromptPopover(props: MultiSlotPromptPopoverProps) {
  const {
    visible, anchorRect, slots, selectedIndices,
    onToggle, onGenerate, onClose,
    titleKey, generateLabelKey,
    configuredKey = 'review.configured',
    defaultBadgeKey = 'settings.promptDefault',
    width = 220,
    testIdPrefix = 'prompt-slot-',
    generateBtnTestId = 'popover-generate-n-btn',
  } = props;
  const { t } = useTranslation();

  if (!visible || !anchorRect) return null;

  return (
    <div
      className="fixed inset-0 z-[110] bg-black/10 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="absolute bg-gradient-to-r from-baimiao-mysteria/95 to-[#2c2957]/95 backdrop-blur-xl border border-white/10 rounded-2xl p-2 flex flex-col gap-1 shadow-[0_10px_30px_rgba(0,0,0,0.3)] z-[120] animate-in zoom-in-95 duration-100"
        style={{
          top: calcPopoverTop(anchorRect),
          left: clampPopoverLeft(anchorRect, width),
          width: `${width}px`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[11px] font-semibold text-white/40 tracking-wider px-2.5 py-1.5 border-b border-white/5 flex justify-between items-center select-none">
          <span>{t(titleKey)}</span>
          <button
            onClick={onClose}
            className="hover:bg-white/10 p-0.5 rounded text-white/40 hover:text-white transition-colors"
            aria-label="close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex flex-col gap-0.5 mt-1">
          {/* 生成 N 篇 按钮 */}
          <button
            data-testid={generateBtnTestId}
            onClick={onGenerate}
            className="w-full py-2 px-2.5 bg-white/10 hover:bg-white/15 rounded-xl text-[12.5px] font-semibold text-purple-200 text-left active:scale-[0.98] transition-all border border-white/5 mb-1 flex items-center justify-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-300" />
            {t(generateLabelKey, { count: selectedIndices.length })}
          </button>

          {/* 5 槽多选列表 */}
          {slots.map((slot, idx) => {
            const isSelected = selectedIndices.includes(idx);
            return (
              <button
                key={idx}
                data-testid={`${testIdPrefix}${idx}`}
                onClick={() => onToggle(idx)}
                className={`w-full py-2 px-2.5 hover:bg-white/5 rounded-xl text-[12.5px] font-medium text-left active:scale-[0.98] transition-all flex items-center justify-between ${
                  isSelected ? 'text-white' : 'text-white/50'
                }`}
              >
                <span className="flex items-center gap-2">
                  {isSelected
                    ? <CheckSquare className="w-3.5 h-3.5 text-purple-300 shrink-0" />
                    : <Square className="w-3.5 h-3.5 text-white/30 shrink-0" />
                  }
                  {slot.name}
                  {slot.isFixed && <span className="text-[9px] text-white/30 font-normal">{t(defaultBadgeKey)}</span>}
                </span>
                {slot.hasContent && <span className="text-purple-300/60 text-[10px] font-normal">{t(configuredKey)}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
