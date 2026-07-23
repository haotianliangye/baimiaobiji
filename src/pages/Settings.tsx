import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, KeyRound, Server, Cpu, FileDown, Settings2, RotateCcw, Eye, EyeOff, Upload, Shield, Cloud, ShieldCheck, Loader2, CloudLightning, Download, FileJson, FileText, MessageSquare, Volume2, Tags, Info, Database, X, ChevronRight, ChevronDown, ChevronUp, Search, Mic, Plus, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import TagManagement from './TagManagement';
import DrawerTagList from '../components/DrawerTagList';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useSettingsStore, DEFAULT_DIARY_PROMPT, DEFAULT_REVIEW_PROMPT, DEFAULT_INSIGHT_PROMPT, DEFAULT_MINGWU_PROMPT, DEFAULT_DIARY_REVIEW_SUMMARY_PROMPT, DEFAULT_MINGWU_INSIGHT_SUMMARY_PROMPT, DEFAULT_PROMPTS_BY_LANG, DEFAULT_REVIEW_PROMPT_NAMES_BY_LANG, DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG, type Language } from '../store/settings.store';
import { db, normalizeLegacyDiary, normalizeLegacyInsight } from '../db/db';
import { enqueueAllMissingEmbeddings } from '../lib/embedding';
import { checkStorageStatus, requestStoragePersistence, StorageEstimateInfo } from '../lib/storage';
import { getPressureLevel, type PressureLevel } from '../lib/storagePressure';
import { useAppStore } from '../store/app.store';
import { SYNC_CONSTANTS, TTS_VOICES, findTtsVoiceLabel, type TtsVoiceOption } from '../config/constants';
import DatePickerPopover from '../components/DatePickerPopover';
import { exportData, exportConversations, downloadContent, getExportFilename } from '../lib/dataExport';
import type { DataType, ExportOptions } from '../lib/dataExport';
import { importData, importConversations } from '../lib/dataImport';
import type { ImportStrategy, ImportResult } from '../lib/dataImport';
import { cn } from '../lib/utils';
import { useTranslation } from '../lib/i18n';
import { getPatterns, addPattern, removePattern, resetPatterns } from '../lib/hallucinationPatterns';
import type { HallucinationPattern } from '../lib/hallucinationFilter';
import { getErrorCount, exportErrorLog, clearErrorLog, triggerTestError, ERROR_BUFFER_MAX_SIZE } from '../lib/errorBuffer';
import {
  getAutoBackupEnabled,
  setAutoBackupEnabled,
  createBackup,
  listBackups,
  restoreBackup,
  deleteBackup,
  totalBackupSize,
  type BackupRecord,
} from '../lib/autoBackup';
import { useLiveQuery } from 'dexie-react-hooks';

const SYNC_START_DELAY_MS = 500;
const OAUTH_CHECK_INTERVAL_MS = 50;

// Seam 8: 火山引擎 TTS API Key 即时格式校验（约定 "appid:access_token"，两部分均非空）。
// 留空视为合法（尚未填写不报错），与后端 /api/tts 的 400 校验保持一致但前置到客户端。
const isVolcengineTtsKeyValid = (key: string): boolean => {
  if (!key) return true;
  const sep = key.indexOf(':');
  if (sep <= 0) return false;
  return key.slice(0, sep).length > 0 && key.slice(sep + 1).length > 0;
};

// #009-ext: TTS 语音选择 Modal。
// - 固定高度 280px 的滚动列表（按 group 分组），顶部实时搜索。
// - 列表底部永远有「自定义…」入口，展开后变为文本输入（逃生口）。
// - 用 createPortal 挂到 body，避免被父容器 transform/overflow 裁切。
function TtsVoicePickerModal({
  provider,
  value,
  onSelect,
  onClose,
  labelKey,
  placeholderKey,
  searchPlaceholderKey,
  emptyKey,
  customKey,
  customHintKey,
}: {
  provider: 'gemini' | 'volcengine';
  value: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  labelKey: string;
  placeholderKey: string;
  searchPlaceholderKey: string;
  emptyKey: string;
  customKey: string;
  customHintKey: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [customValue, setCustomValue] = useState(value || '');
  const inputRef = useRef<HTMLInputElement>(null);

  const voices = TTS_VOICES[provider] || [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return voices;
    return voices.filter((v) =>
      [v.id, v.label, v.desc, v.group].some((s) => s.toLowerCase().includes(q))
    );
  }, [voices, query]);

  // 按 group 聚合，保留 group 顺序（按首次出现）
  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, TtsVoiceOption[]>();
    filtered.forEach((v) => {
      if (!map.has(v.group)) {
        order.push(v.group);
        map.set(v.group, []);
      }
      map.get(v.group)!.push(v);
    });
    return order.map((g) => ({ group: g, items: map.get(g)! }));
  }, [filtered]);

  useEffect(() => {
    if (showCustom) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [showCustom]);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCustomSubmit = () => {
    const v = customValue.trim();
    if (v) {
      onSelect(v);
      onClose();
    }
  };

  const modalNode = (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
        onClick={onClose}
        data-testid="tts-voice-modal-backdrop"
      >
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.98 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[85vh]"
          onClick={(e) => e.stopPropagation()}
          data-testid="tts-voice-modal"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 shrink-0">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-stone-400" />
              <h3 className="text-[14px] font-medium text-stone-900">{t(labelKey)}</h3>
              <span className="text-[11px] text-stone-400">({voices.length})</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Search */}
          <div className="px-4 py-2 border-b border-stone-100 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t(searchPlaceholderKey)}
                className="w-full pl-8 pr-3 py-1.5 bg-stone-50 border border-stone-100 rounded-lg text-[13px] outline-none focus:bg-white focus:border-stone-300 transition-all"
              />
            </div>
          </div>

          {/* Voice list / Custom input */}
          {showCustom ? (
            <div className="px-4 py-4 space-y-3 shrink-0">
              <p className="text-[11px] text-stone-500 leading-relaxed">{t(customHintKey)}</p>
              <input
                ref={inputRef}
                type="text"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCustomSubmit();
                }}
                placeholder={t(placeholderKey)}
                className="w-full px-3 py-2 bg-white border border-stone-200 rounded-lg text-[13px] font-mono outline-none focus:border-stone-400"
                data-testid="tts-voice-custom-input"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowCustom(false)}
                  className="flex-1 py-2 text-[12px] text-stone-600 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={handleCustomSubmit}
                  disabled={!customValue.trim()}
                  className="flex-[2] py-2 text-[12px] text-white bg-stone-900 hover:bg-stone-700 disabled:bg-stone-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                  data-testid="tts-voice-custom-confirm"
                >
                  {t('common.confirm')}
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-y-auto flex-1 overscroll-contain" style={{ maxHeight: 'min(280px, 50vh)' }}>
              {grouped.length === 0 ? (
                <div className="px-4 py-8 text-center text-[12px] text-stone-400">{t(emptyKey)}</div>
              ) : (
                grouped.map(({ group, items }) => (
                  <div key={group}>
                    <div className="sticky top-0 px-4 py-1.5 text-[10.5px] font-medium text-stone-400 bg-stone-50/95 backdrop-blur-sm border-b border-stone-100 uppercase tracking-wide">
                      {group} · {items.length}
                    </div>
                    {items.map((v) => {
                      const isSelected = v.id === value;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => {
                            onSelect(v.id);
                            onClose();
                          }}
                          className={`w-full px-4 py-2 flex items-start gap-2 text-left hover:bg-stone-50 transition-colors ${
                            isSelected ? 'bg-stone-100' : ''
                          }`}
                          data-testid={`tts-voice-option-${v.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[13px] font-medium text-stone-900 truncate">{v.label}</span>
                              {isSelected && (
                                <span className="text-[10px] text-emerald-600 shrink-0">✓</span>
                              )}
                            </div>
                            <div className="text-[11px] text-stone-500 leading-snug mt-0.5">{v.desc}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Footer: custom toggle */}
          {!showCustom && (
            <div className="border-t border-stone-100 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setCustomValue(value || '');
                  setShowCustom(true);
                }}
                className="w-full px-4 py-2.5 text-[12px] text-stone-500 hover:bg-stone-50 hover:text-stone-700 transition-colors text-left"
                data-testid="tts-voice-custom-toggle"
              >
                {t(customKey)}
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(modalNode, document.body);
}
// #13 统一数据管理 -- 可导出的数据类型选项（labelKey 用于 i18n）
const DATA_TYPE_OPTIONS: { id: DataType; labelKey: string }[] = [
  { id: 'raw_logs', labelKey: 'dataType.raw_logs' },
  { id: 'daily_reviews', labelKey: 'dataType.daily_reviews' },
  { id: 'thoughts', labelKey: 'dataType.thoughts' },
  { id: 'insights', labelKey: 'dataType.insight' },
  { id: 'copilot_conversations', labelKey: 'dataType.copilot_conversations' },
  { id: 'tags', labelKey: 'dataType.tags' },
  { id: 'tag_aliases', labelKey: 'dataType.tag_aliases' },
  { id: 'attachments', labelKey: 'dataType.attachments' },
];

/**
 * Issue #004: 转写幻觉过滤面板
 *
 * 让用户在 Settings 里增删转写黑名单 pattern。
 * 数据存 db.settings_kv['transcription.hallucinationPatterns']。
 */
function TranscriptionFilterPanel() {
  const [patterns, setPatterns] = useState<HallucinationPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState<'exact' | 'regex'>('exact');
  const [newValue, setNewValue] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getPatterns().then(p => {
      setPatterns(p);
      setLoading(false);
    });
  }, []);

  const refresh = async () => {
    setLoading(true);
    setPatterns(await getPatterns());
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!newValue.trim()) return;
    setErr(null);
    try {
      await addPattern({
        key: `custom-${Date.now().toString(36)}`,
        type: newType,
        value: newValue.trim(),
        description: newDesc.trim() || undefined,
      });
      setNewValue('');
      setNewDesc('');
      setAdding(false);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleRemove = async (key: string) => {
    await removePattern(key);
    await refresh();
  };

  const handleReset = async () => {
    if (!confirm('确定要恢复全部默认 patterns 吗？自定义内容会丢失。')) return;
    await resetPatterns();
    await refresh();
  };

  if (loading) {
    return <div className="p-6 text-stone-500 text-center text-sm">加载中…</div>;
  }

  return (
    <section className="baimiao-card-diary p-5 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-[15px] font-semibold text-stone-900">转写幻觉过滤</h3>
        <p className="text-[12px] text-stone-500 leading-relaxed">
          LLM 转写音频时可能输出固定的噪音片段（如「[EMPTY_AUDIO]」「谢谢观看」）。
          这里配置的 patterns 会在每次转写时送给后端，被命中的转写会被丢弃或标记。
        </p>
        <p className="text-[12px] text-stone-500 leading-relaxed">
          配置仅存于本设备的 IndexedDB（settings_kv 表），不参与云同步。
        </p>
      </div>

      {err && (
        <div className="px-3 py-2 bg-red-50 text-red-700 text-[12px] rounded-lg border border-red-200">
          {err}
        </div>
      )}

      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {patterns.map(p => (
          <div
            key={p.key}
            className="flex items-center gap-2 px-3 py-2 bg-stone-50 hover:bg-stone-100 rounded-lg text-[12px] group"
          >
            <span className={cn(
              'shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono',
              p.type === 'regex' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
            )}>
              {p.type}
            </span>
            <code className="flex-1 truncate text-stone-800 font-mono">{p.value}</code>
            {p.description && (
              <span className="text-stone-400 text-[11px] truncate max-w-[120px]" title={p.description}>
                {p.description}
              </span>
            )}
            <button
              onClick={() => handleRemove(p.key)}
              className="shrink-0 p-1 text-stone-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
              title="删除"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {patterns.length === 0 && (
          <div className="text-stone-400 text-center text-[12px] py-4">
            还没有任何 pattern，点击下方按钮添加
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-stone-200/40">
        {!adding ? (
          <>
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1 px-3 py-1.5 bg-baimiao-mysteria text-white rounded-lg text-[12px] hover:brightness-110"
            >
              <Plus className="w-3.5 h-3.5" />添加 pattern
            </button>
            <button
              onClick={handleReset}
              className="flex items-center gap-1 px-3 py-1.5 text-stone-600 bg-stone-100 hover:bg-stone-200 rounded-lg text-[12px]"
            >
              <RotateCcw className="w-3.5 h-3.5" />恢复默认
            </button>
          </>
        ) : (
          <div className="flex flex-col gap-2 w-full p-3 bg-stone-50 rounded-lg">
            <div className="flex items-center gap-2">
              <label className="text-[12px] text-stone-600">类型</label>
              <select
                value={newType}
                onChange={e => setNewType(e.target.value as 'exact' | 'regex')}
                className="px-2 py-1 text-[12px] border border-stone-200 rounded"
              >
                <option value="exact">精确匹配</option>
                <option value="regex">正则表达式</option>
              </select>
            </div>
            <input
              type="text"
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              placeholder={newType === 'regex' ? '例如：关注.*订阅' : '例如：[EMPTY_AUDIO]'}
              className="w-full px-2 py-1.5 text-[12px] border border-stone-200 rounded font-mono"
            />
            <input
              type="text"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="备注（可选）"
              className="w-full px-2 py-1.5 text-[12px] border border-stone-200 rounded"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleAdd}
                disabled={!newValue.trim()}
                className="px-3 py-1.5 bg-baimiao-mysteria text-white rounded-lg text-[12px] disabled:opacity-50"
              >
                保存
              </button>
              <button
                onClick={() => { setAdding(false); setErr(null); }}
                className="px-3 py-1.5 text-stone-600 bg-stone-200 rounded-lg text-[12px]"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Issue #006: 错误日志调试面板
 *
 * 让用户能导出本地错误环形缓冲（在崩溃 / 异常场景下发给开发者）。
 * 设计：
 *   - 放在 Settings → About tab（不需要 5 次连点）
 *   - 显示当前缓冲大小（X / 100）
 *   - 「导出 JSON」按钮 → 下载 error-log-<timestamp>.json
 *   - 「清空」按钮（带确认）
 *   - 「触发测试」按钮（演示用）
 */
function ErrorInspector() {
  const [count, setCount] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [lastExport, setLastExport] = useState<string | null>(null);

  // 每次激活 About tab 时 refresh 一次
  useEffect(() => {
    setCount(getErrorCount());
    // 不挂 timer：用户切回 tab 时重读
  }, []);

  const refresh = () => setCount(getErrorCount());

  const handleExport = () => {
    if (count === 0) return;
    setIsExporting(true);
    try {
      const content = exportErrorLog();
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `error-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setLastExport(new Date().toLocaleTimeString('zh-CN'));
    } finally {
      setIsExporting(false);
    }
  };

  const handleClear = () => {
    if (!confirm('确定清空错误日志？')) return;
    clearErrorLog();
    refresh();
  };

  const handleTest = () => {
    triggerTestError();
    refresh();
  };

  return (
    <div className="w-full mb-5 p-3 bg-stone-50 border border-stone-200/60 rounded-xl text-left">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-semibold text-stone-700">错误日志（调试）</span>
        <span className="text-[11px] text-stone-500 font-mono">
          {count} / {ERROR_BUFFER_MAX_SIZE}
        </span>
      </div>
      <p className="text-[11px] text-stone-500 mb-3 leading-relaxed">
        本地环形缓冲，仅在本设备内存。导出 JSON 发给开发者辅助定位问题。
      </p>
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={handleExport}
          disabled={count === 0 || isExporting}
          className="flex items-center gap-1 px-3 py-1.5 text-[11px] bg-stone-900 text-white rounded-lg hover:bg-black disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Download className="w-3 h-3" />
          导出 JSON
        </button>
        <button
          onClick={handleClear}
          disabled={count === 0}
          className="flex items-center gap-1 px-3 py-1.5 text-[11px] bg-stone-200 text-stone-700 rounded-lg hover:bg-stone-300 disabled:opacity-30"
        >
          <Trash2 className="w-3 h-3" />
          清空
        </button>
        <button
          onClick={handleTest}
          className="flex items-center gap-1 px-3 py-1.5 text-[11px] bg-white border border-stone-200 text-stone-600 rounded-lg hover:bg-stone-50"
        >
          触发测试
        </button>
      </div>
      {lastExport && (
        <p className="text-[10px] text-stone-400 mt-2">上次导出：{lastExport}</p>
      )}
    </div>
  );
}

/**
 * Issue #008: 本地自动备份 section
 *
 * 让用户能看到/控制/恢复本地自动备份。
 */
function AutoBackupSection() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 用 useLiveQuery 让备份列表自动刷新（备份后/删除后）
  const backups = useLiveQuery(() => listBackups(20), [], [] as BackupRecord[]);
  const totalSize = useLiveQuery(() => totalBackupSize(), [], 0);

  useEffect(() => {
    getAutoBackupEnabled().then(setEnabled).catch(() => setEnabled(true));
  }, []);

  const handleToggle = async (next: boolean) => {
    setEnabled(next);
    try {
      await setAutoBackupEnabled(next);
    } catch (e) {
      setLoadError((e as Error).message);
      setEnabled(!next); // 回滚
    }
  };

  const handleBackupNow = async () => {
    setIsCreating(true);
    setLoadError(null);
    try {
      await createBackup('manual');
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleRestore = async (id: string) => {
    if (!confirm(t('settings.autoBackupRestoreConfirm'))) return;
    setLoadError(null);
    try {
      await restoreBackup(id);
      // 提醒用户：数据已替换
      alert('已恢复。请刷新页面查看最新数据。');
    } catch (e) {
      setLoadError((e as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('settings.autoBackupDeleteConfirm'))) return;
    try {
      await deleteBackup(id);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  };

  return (
    <section className="baimiao-card-diary p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[12.5px] font-semibold text-stone-400 tracking-wider uppercase flex items-center gap-1.5">
          <Database className="w-4 h-4 text-stone-400" />
          {t('settings.autoBackup')}
        </h3>
        <label className="relative inline-flex items-center cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => handleToggle(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-stone-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-black"></div>
        </label>
      </div>

      <p className="text-[11.5px] text-stone-500 leading-relaxed">
        {t('settings.autoBackupDesc')}
      </p>

      {loadError && (
        <div className="px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-[12px]">
          {loadError}
        </div>
      )}

      <button
        onClick={handleBackupNow}
        disabled={isCreating}
        className="w-full flex items-center justify-center gap-2 bg-stone-900 text-white py-2.5 rounded-xl text-[13px] font-medium hover:bg-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98]"
      >
        {isCreating ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {t('settings.autoBackupCreating')}
          </>
        ) : (
          <>
            <Database className="w-3.5 h-3.5" />
            {t('settings.autoBackupNow')}
          </>
        )}
      </button>

      <div className="pt-2 border-t border-stone-100 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-[12px] font-medium text-stone-700">
            {t('settings.autoBackupList')}
          </h4>
          <span className="text-[10px] text-stone-400 font-mono">
            {(backups?.length ?? 0)} 条 · {((totalSize ?? 0) / 1024).toFixed(1)} KB
          </span>
        </div>

        {backups && backups.length > 0 ? (
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
            {backups.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-2 px-3 py-2 bg-stone-50 hover:bg-stone-100 rounded-lg text-[11.5px] group"
              >
                <span className={cn(
                  'shrink-0 px-1.5 py-0.5 rounded text-[9.5px] font-mono',
                  b.type === 'auto' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                )}>
                  {b.type === 'auto' ? 'auto' : 'manual'}
                </span>
                <span className="flex-1 text-stone-700 font-mono">
                  {new Date(b.created_at).toLocaleString('zh-CN', {
                    month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit'
                  })}
                </span>
                <span className="text-stone-400 font-mono">
                  {(b.size_bytes / 1024).toFixed(1)}K
                </span>
                <button
                  onClick={() => handleRestore(b.id)}
                  className="shrink-0 px-2 py-1 text-stone-600 hover:text-stone-900 hover:bg-white rounded text-[10.5px] opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {t('settings.autoBackupRestore')}
                </button>
                <button
                  onClick={() => handleDelete(b.id)}
                  className="shrink-0 p-1 text-stone-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  title={t('settings.autoBackupDelete')}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-stone-400 text-center text-[11.5px] py-3">
            {t('settings.autoBackupEmpty')}
          </div>
        )}
      </div>
    </section>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const settingsStore = useSettingsStore();
  const {
    provider,
    apiKey,
    baseUrl,
    model,
    diaryPrompt,
    diaryPrompts,
    diaryPromptIndex,
    reviewPrompt,
    reviewPrompts,
    reviewPromptIndex,
    reviewPromptNames,
    reviewSelectedIndices,
    insightPrompts,
    mingwuPrompts,
    // #008: 合并后的提示词字段
    mingwuInsightPrompts,
    mingwuInsightPromptNames,
    mingwuInsightPromptIndex,
    mingwuInsightSelectedIndices,
    diaryReviewSummaryPrompt,
    mingwuInsightSummaryPrompt,
    embedEnabled,
    embedProvider,
    embedApiKey,
    embedBaseUrl,
    embedModel,
    submitMultimedia,
    ttsService,
    ttsLang,
    ttsRate,
    ttsVoice,
    ttsProvider,
    ttsApiKey,
    ttsBaseUrl,
    ttsModel,
    language,
    setLanguage,
    setSettings
  } = settingsStore;

  const { 
    syncStatus, 
    syncErrorMessage, 
    syncNow, 
    checkAndGenerateHistoryTasks, 
    isProcessingQueue, 
    autoGenTasks, 
    isQueuePaused, 
    setQueuePaused, 
    clearQueue,
    totalVectorsCount,
    embeddingQueueSize,
    updateVectorsCount
  } = useAppStore();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<'model' | 'tts' | 'embedding' | 'data' | 'prompt' | 'tags' | 'transcription' | 'about'>(
    (location.state as any)?.tab || 'model'
  );
  // Issue 109: 设置页抽屉 + 全页详情模式（推翻 Seam 2 左右分栏）
  const [view, setView] = useState<'drawer' | 'detail'>(
    (location.state as any)?.drawer ? 'drawer' : 'detail'
  );
  // 设置页桌面/移动布局分流：桌面端（md: ≥768px）下抽屉与详情页左右分栏同时常驻显示，不滑入动画
  const isDesktop = useMediaQuery('(min-width: 768px)');
  // task-111: 抽屉「所有标签」默认展开，点击标题行可展开/收起
  const [tagsExpanded, setTagsExpanded] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showEmbedApiKey, setShowEmbedApiKey] = useState(false);
  const [showTtsApiKey, setShowTtsApiKey] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [storageInfo, setStorageInfo] = useState<StorageEstimateInfo | null>(null);
  const [isPersisting, setIsPersisting] = useState(false);
  const [showSyncPass, setShowSyncPass] = useState(false);
  const [showE2eePass, setShowE2eePass] = useState(false);

  // Cloud Sync Form States
  const [localSyncEnabled, setLocalSyncEnabled] = useState(settingsStore.syncEnabled);
  const [localSyncProvider, setLocalSyncProvider] = useState<'webdav' | 'onedrive' | 'gdrive' | 'dropbox'>(settingsStore.syncProvider || 'webdav');
  const [localSyncEndpoint, setLocalSyncEndpoint] = useState(settingsStore.syncEndpoint);
  const [localSyncUsername, setLocalSyncUsername] = useState(settingsStore.syncUsername);
  const [localSyncPassword, setLocalSyncPassword] = useState(settingsStore.syncPassword);
  const [localSyncDirectory, setLocalSyncDirectory] = useState(settingsStore.syncDirectory || '/baimiaobiji/');
  const [localSyncPasswordE2EE, setLocalSyncPasswordE2EE] = useState(settingsStore.syncPasswordE2EE);
  const [localSyncRememberCredentials, setLocalSyncRememberCredentials] = useState(settingsStore.syncRememberCredentials || false);

  // OAuth Client IDs local states
  const [localSyncOneDriveClientId, setLocalSyncOneDriveClientId] = useState(settingsStore.syncOneDriveClientId || '');
  const [localSyncGDriveClientId, setLocalSyncGDriveClientId] = useState(settingsStore.syncGDriveClientId || '');
  const [localSyncDropboxClientId, setLocalSyncDropboxClientId] = useState(settingsStore.syncDropboxClientId || '');

  useEffect(() => {
    async function loadStorageInfo() {
      const info = await checkStorageStatus();
      setStorageInfo(info);
    }
    loadStorageInfo();
  }, []);

  // OAuth Callback Hash Parser
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes('access_token=')) {
      const params = new URLSearchParams(hash.replace(/^#/, '?'));
      const token = params.get('access_token');
      const state = params.get('state');

      if (token && state) {
        // Restore pre-oauth backup
        try {
          const backupStr = localStorage.getItem('baimiao_oauth_backup');
          if (backupStr) {
            const backup = JSON.parse(backupStr);
            if (backup.syncEndpoint) setLocalSyncEndpoint(backup.syncEndpoint);
            if (backup.syncUsername) setLocalSyncUsername(backup.syncUsername);
            if (backup.syncDirectory) setLocalSyncDirectory(backup.syncDirectory);
            if (backup.syncRememberCredentials !== undefined) setLocalSyncRememberCredentials(backup.syncRememberCredentials);
            settingsStore.setSettings({
              syncEndpoint: backup.syncEndpoint,
              syncUsername: backup.syncUsername,
              syncDirectory: backup.syncDirectory,
              syncRememberCredentials: backup.syncRememberCredentials
            });
            localStorage.removeItem('baimiao_oauth_backup');
          }
        } catch (err) {}

        if (state === 'onedrive') {
          settingsStore.setSettings({
            syncOneDriveToken: token,
            syncProvider: 'onedrive',
            syncEnabled: true
          });
          setLocalSyncProvider('onedrive');
          setLocalSyncEnabled(true);
        } else if (state === 'gdrive') {
          settingsStore.setSettings({
            syncGDriveToken: token,
            syncProvider: 'gdrive',
            syncEnabled: true
          });
          setLocalSyncProvider('gdrive');
          setLocalSyncEnabled(true);
        } else if (state === 'dropbox') {
          settingsStore.setSettings({
            syncDropboxToken: token,
            syncProvider: 'dropbox',
            syncEnabled: true
          });
          setLocalSyncProvider('dropbox');
          setLocalSyncEnabled(true);
        }

        // Clean up hash from URL
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        alert(t('settings.oauthConnectedAlert', { provider: state === 'gdrive' ? 'Google Drive' : state === 'onedrive' ? 'OneDrive' : 'Dropbox' }));
        
        // Delay syncNow to give React state time to flush to Zustand
        setTimeout(() => {
          syncNow();
        }, SYNC_START_DELAY_MS);
      }
    }
  }, []);

  const handlePersist = async () => {
    setIsPersisting(true);
    const success = await requestStoragePersistence();
    const info = await checkStorageStatus();
    setStorageInfo(info);
    setIsPersisting(false);
    if (success) {
      alert(t('settings.storageActivatingSuccess'));
    } else {
      alert(t('settings.persistRejected'));
    }
  };

  const handleOAuthAuthorize = (provider: 'onedrive' | 'gdrive' | 'dropbox') => {
    const redirectUri = window.location.origin + window.location.pathname;
    
    let authUrl = '';
    if (provider === 'onedrive') {
      const clientId = localSyncOneDriveClientId || SYNC_CONSTANTS.DEFAULT_ONEDRIVE_CLIENT_ID;
      authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('files.readwrite')}&state=onedrive`;
    } else if (provider === 'gdrive') {
      const clientId = localSyncGDriveClientId || SYNC_CONSTANTS.DEFAULT_GDRIVE_CLIENT_ID;
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive.file')}&state=gdrive`;
    } else if (provider === 'dropbox') {
      const clientId = localSyncDropboxClientId || SYNC_CONSTANTS.DEFAULT_DROPBOX_CLIENT_ID;
      authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&state=dropbox`;
    }
    
    if (authUrl) {
      settingsStore.setSettings({
        syncOneDriveClientId: localSyncOneDriveClientId,
        syncGDriveClientId: localSyncGDriveClientId,
        syncDropboxClientId: localSyncDropboxClientId,
        syncProvider: provider
      });
      // Backup state before redirect to survive cross-origin returns
      localStorage.setItem('baimiao_oauth_backup', JSON.stringify({
        syncProvider: provider,
        syncEndpoint: localSyncEndpoint,
        syncUsername: localSyncUsername,
        syncDirectory: localSyncDirectory,
        syncRememberCredentials: localSyncRememberCredentials
      }));
      window.location.href = authUrl;
    }
  };

  const handleOAuthDisconnect = (provider: 'onedrive' | 'gdrive' | 'dropbox') => {
    if (provider === 'onedrive') {
      settingsStore.setSettings({ syncOneDriveToken: '' });
    } else if (provider === 'gdrive') {
      settingsStore.setSettings({ syncGDriveToken: '' });
    } else if (provider === 'dropbox') {
      settingsStore.setSettings({ syncDropboxToken: '' });
    }
    alert(t('settings.oauthDisconnectedAlert', { provider: provider.toUpperCase() }));
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const [exportDateRange, setExportDateRange] = useState<'all' | 'custom'>('all');
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');

  const [exportOptions, setExportOptions] = useState({
    logs: true,
    diaries: true,
    insights: true,
    embeddings: false,
  });

  // #13 统一数据管理 -- 状态
  const [unifiedExportTypes, setUnifiedExportTypes] = useState<Set<DataType>>(
    new Set(['raw_logs', 'daily_reviews'])
  );
  const [unifiedExportFormat, setUnifiedExportFormat] = useState<'markdown' | 'json'>('json');
  const [unifiedExportStartDate, setUnifiedExportStartDate] = useState('');
  const [unifiedExportEndDate, setUnifiedExportEndDate] = useState('');
  const [isUnifiedExporting, setIsUnifiedExporting] = useState(false);

  const [unifiedImportStrategy, setUnifiedImportStrategy] = useState<ImportStrategy>('overwrite');
  const [unifiedImportResult, setUnifiedImportResult] = useState<ImportResult | null>(null);
  const [unifiedImportFile, setUnifiedImportFile] = useState<File | null>(null);
  const [isUnifiedImporting, setIsUnifiedImporting] = useState(false);
  const unifiedImportFileRef = useRef<HTMLInputElement>(null);

  const [convImportStrategy, setConvImportStrategy] = useState<ImportStrategy>('overwrite');
  const [convImportResult, setConvImportResult] = useState<ImportResult | null>(null);
  const [convImportFile, setConvImportFile] = useState<File | null>(null);
  const [isConvImporting, setIsConvImporting] = useState(false);
  const convImportFileRef = useRef<HTMLInputElement>(null);

  // #5: 统一 5 槽日记回顾 Prompt（合并旧 diaryPrompts + reviewPrompts）
  const [localReviewPrompts, setLocalReviewPrompts] = useState<string[]>(() => {
    if (reviewPrompts && reviewPrompts.length === 5) return [...reviewPrompts];
    // 兼容旧 4 槽 reviewPrompts（迁移前）
    if (reviewPrompts && reviewPrompts.length === 4) {
      return [reviewPrompts[0] || DEFAULT_DIARY_PROMPT, reviewPrompts[0] || DEFAULT_REVIEW_PROMPT, '', '', ''];
    }
    return [DEFAULT_DIARY_PROMPT, DEFAULT_REVIEW_PROMPT, '', '', ''];
  });
  const [localReviewPromptNames, setLocalReviewPromptNames] = useState<string[]>(() => {
    if (reviewPromptNames && reviewPromptNames.length === 5) return [...reviewPromptNames];
    return [...DEFAULT_REVIEW_PROMPT_NAMES_BY_LANG[language]];
  });
  const [localReviewSelectedIndices, setLocalReviewSelectedIndices] = useState<number[]>(() => {
    if (reviewSelectedIndices && reviewSelectedIndices.length > 0) return [...reviewSelectedIndices];
    return [0, 1];
  });
  const [localReviewIndex, setLocalReviewIndex] = useState<number>(0);

  // #008: 合并后的「明悟和洞察生成 Prompt」（5 槽：明悟/洞察/自定义1/2/3）
  const [localMingwuInsightPrompts, setLocalMingwuInsightPrompts] = useState<string[]>(() => {
    if (mingwuInsightPrompts && mingwuInsightPrompts.length === 5) return [...mingwuInsightPrompts];
    // 兼容迁移前：从旧 mingwuPrompts + insightPrompts 合并
    const mw = mingwuPrompts && mingwuPrompts.length >= 1 ? mingwuPrompts : [DEFAULT_MINGWU_PROMPT, '', '', ''];
    const ins = insightPrompts && insightPrompts.length >= 1 ? insightPrompts : [DEFAULT_INSIGHT_PROMPT, '', '', ''];
    return [mw[0] || DEFAULT_MINGWU_PROMPT, ins[0] || DEFAULT_INSIGHT_PROMPT, mw[1] || ins[1] || '', mw[2] || ins[2] || '', mw[3] || ins[3] || ''];
  });
  const [localMingwuInsightPromptNames, setLocalMingwuInsightPromptNames] = useState<string[]>(() => {
    if (mingwuInsightPromptNames && mingwuInsightPromptNames.length === 5) return [...mingwuInsightPromptNames];
    return [...DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG[language]];
  });
  const [localMingwuInsightSelectedIndices, setLocalMingwuInsightSelectedIndices] = useState<number[]>(() => {
    if (mingwuInsightSelectedIndices && mingwuInsightSelectedIndices.length > 0) return [...mingwuInsightSelectedIndices];
    return [0, 1];
  });
  const [localMingwuInsightIndex, setLocalMingwuInsightIndex] = useState<number>(0);

  // #008: 合并后的摘要 Prompt
  const [localDiaryReviewSummaryPrompt, setLocalDiaryReviewSummaryPrompt] = useState(diaryReviewSummaryPrompt || DEFAULT_DIARY_REVIEW_SUMMARY_PROMPT);
  const [localMingwuInsightSummaryPrompt, setLocalMingwuInsightSummaryPrompt] = useState(mingwuInsightSummaryPrompt || DEFAULT_MINGWU_INSIGHT_SUMMARY_PROMPT);

  // #12: 语言切换后，从 store 重新加载本地 Prompt 状态（store 的 setLanguage 已切换 active 字段）
  useEffect(() => {
    const s = useSettingsStore.getState();
    const d = DEFAULT_PROMPTS_BY_LANG[s.language];
    if (s.reviewPrompts && s.reviewPrompts.length === 5) setLocalReviewPrompts([...s.reviewPrompts]);
    if (s.reviewPromptNames && s.reviewPromptNames.length === 5) setLocalReviewPromptNames([...s.reviewPromptNames]);
    if (s.reviewSelectedIndices) setLocalReviewSelectedIndices([...s.reviewSelectedIndices]);
    // #008: 合并后字段
    if (s.mingwuInsightPrompts && s.mingwuInsightPrompts.length === 5) setLocalMingwuInsightPrompts([...s.mingwuInsightPrompts]);
    if (s.mingwuInsightPromptNames && s.mingwuInsightPromptNames.length === 5) setLocalMingwuInsightPromptNames([...s.mingwuInsightPromptNames]);
    if (s.mingwuInsightSelectedIndices) setLocalMingwuInsightSelectedIndices([...s.mingwuInsightSelectedIndices]);
    setLocalDiaryReviewSummaryPrompt(s.diaryReviewSummaryPrompt || d.diaryReviewSummary);
    setLocalMingwuInsightSummaryPrompt(s.mingwuInsightSummaryPrompt || d.mingwuInsightSummary);
  }, [language]);

  const [chatTestStatus, setChatTestStatus] = useState<'idle' | 'testing' | 'success' | 'fail'>('idle');
  const [chatTestError, setChatTestError] = useState('');
  const [embedTestStatus, setEmbedTestStatus] = useState<'idle' | 'testing' | 'success' | 'fail'>('idle');
  const [embedTestError, setEmbedTestError] = useState('');
  // #009-ext: TTS 语音选择 Modal 控制
  const [ttsVoiceModalOpen, setTtsVoiceModalOpen] = useState(false);

  const handleTestChatConnection = async () => {
    if (!apiKey && provider !== 'custom') {
      setChatTestStatus('fail');
      setChatTestError('API Key 不能为空');
      setTimeout(() => setChatTestStatus('idle'), 3000);
      return;
    }
    setChatTestStatus('testing');
    setChatTestError('');
    try {
      const res = await fetch('/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'chat',
          settings: { provider, apiKey, baseUrl, model }
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      setChatTestStatus('success');
    } catch (err: any) {
      setChatTestStatus('fail');
      setChatTestError(err.message || t('settings.connectionFailed'));
    } finally {
      setTimeout(() => setChatTestStatus('idle'), 4000);
    }
  };

  const handleTestEmbedConnection = async () => {
    const actualEmbedKey = embedApiKey || (embedProvider === 'gemini' ? apiKey : '');
    if (!actualEmbedKey && embedProvider !== 'custom') {
      setEmbedTestStatus('fail');
      setEmbedTestError('API Key 不能为空');
      setTimeout(() => setEmbedTestStatus('idle'), 3000);
      return;
    }
    setEmbedTestStatus('testing');
    setEmbedTestError('');
    try {
      const res = await fetch('/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'embed',
          settings: { provider: embedProvider, apiKey: actualEmbedKey, baseUrl: embedBaseUrl, model: embedModel }
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      setEmbedTestStatus('success');
    } catch (err: any) {
      setEmbedTestStatus('fail');
      setEmbedTestError(err.message || t('settings.connectionFailed'));
    } finally {
      setTimeout(() => setEmbedTestStatus('idle'), 4000);
    }
  };

  const convertBlobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handleExport = async () => {
    try {
      const data: any = {};
      const startMs = exportDateRange === 'custom' && exportStartDate ? new Date(exportStartDate).getTime() : 0;
      const endMs = exportDateRange === 'custom' && exportEndDate ? new Date(exportEndDate).getTime() + 86400000 - 1 : Infinity;
      
      const startStr = exportDateRange === 'custom' ? exportStartDate || '0000-00-00' : '0000-00-00';
      const endStr = exportDateRange === 'custom' && exportEndDate ? exportEndDate : '9999-99-99';

      if (exportOptions.logs) {
         let logs = await db.raw_logs.toArray();
         if (exportDateRange === 'custom') {
           logs = logs.filter(l => l.created_at >= startMs && l.created_at <= endMs);
         }
         data.logs = await Promise.all(logs.map(async l => {
            if (l.audioBlob) {
              const base64 = await convertBlobToBase64(l.audioBlob);
              return { ...l, audioBlob: undefined, audioBase64: base64 };
            }
            return l;
         }));
      }
      if (exportOptions.diaries) {
         // V2: 日记已合并进 daily_reviews（entry_type='diary'）
         let diaries = await db.daily_reviews.filter(d => d.entry_type === 'diary').toArray();
         if (exportDateRange === 'custom') {
           diaries = diaries.filter(d => d.review_date >= startStr && d.review_date <= endStr);
         }
         data.diaries = diaries;
      }
      if (exportOptions.insights) {
         // V2: insights 存储在 insights 表
         let insights = await db.insights.toArray();
         if (exportDateRange === 'custom') {
           insights = insights.filter(i => i.created_at >= startMs && i.created_at <= endMs);
         }
         data.insights = insights;
      }
      if (exportOptions.embeddings) {
         // Export only id + embedding + embedding_version from all four tables
         // (full text content is covered by the other export options)
         const allLogs = await db.raw_logs.toArray();
         const filteredLogs = exportDateRange === 'custom'
           ? allLogs.filter(l => l.created_at >= startMs && l.created_at <= endMs)
           : allLogs;
         const allDiaries = await db.daily_reviews.filter(d => d.entry_type === 'diary').toArray();
         const filteredDiaries = exportDateRange === 'custom'
           ? allDiaries.filter(d => d.review_date >= startStr && d.review_date <= endStr)
           : allDiaries;
         const allDailyReviews = await db.daily_reviews.filter(r => r.entry_type === 'review').toArray();
         const filteredReviews = exportDateRange === 'custom'
           ? allDailyReviews.filter(r => r.review_date >= startStr && r.review_date <= endStr)
           : allDailyReviews;
         const allInsights = await db.insights.toArray();
         const filteredInsights = exportDateRange === 'custom'
           ? allInsights.filter(i => i.created_at >= startMs && i.created_at <= endMs)
           : allInsights;
         data.embeddings = {
           logs: filteredLogs
             .filter(l => l.embedding && l.embedding.length > 0)
             .map(l => ({ id: l.id, embedding: l.embedding, embedding_version: l.embedding_version })),
           diaries: filteredDiaries
             .filter(d => d.embedding && d.embedding.length > 0)
             .map(d => ({ id: d.id, embedding: d.embedding, embedding_version: d.embedding_version })),
           daily_reviews: filteredReviews
             .filter(r => r.embedding && r.embedding.length > 0)
             .map(r => ({ id: r.id, embedding: r.embedding, embedding_version: r.embedding_version })),
           insights: filteredInsights
             .filter(i => i.embedding && i.embedding.length > 0)
             .map(i => ({ id: i.id, embedding: i.embedding, embedding_version: i.embedding_version })),
         };
      }

      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `baimiao_data_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(t('settings.exportFailed'));
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const text = ev.target?.result as string;
        const data = JSON.parse(text);
        
        let importedCount = 0;

        if (data.logs && Array.isArray(data.logs)) {
          const logsToPut = await Promise.all(data.logs.map(async (l: any) => {
            if (l.audioBase64) {
              const res = await fetch(l.audioBase64);
              const blob = await res.blob();
              l.audioBlob = blob;
              delete l.audioBase64;
            }
            return l;
          }));
          await db.raw_logs.bulkPut(logsToPut);
          importedCount += logsToPut.length;
        }

        if (data.diaries && Array.isArray(data.diaries)) {
          // V2: 兼容旧导出（diary_date/无 entry_type）与新格式，统一写入 daily_reviews
          const diariesToPut = data.diaries.map((d: any) => normalizeLegacyDiary(d));
          await db.daily_reviews.bulkPut(diariesToPut);
          importedCount += diariesToPut.length;
        }

        if (data.insights && Array.isArray(data.insights)) {
          // V2: insights -> insights
          const insightsToPut = data.insights.map((i: any) => normalizeLegacyInsight(i));
          await db.insights.bulkPut(insightsToPut);
          importedCount += insightsToPut.length;
        }

        alert(t('settings.importSuccess', { count: importedCount }));
        if (fileInputRef.current) fileInputRef.current.value = '';
      } catch (err) {
        console.error(err);
        alert(t('settings.importFailed'));
      }
    };
    reader.readAsText(file);
  };

  const handleDownloadMigrationBackup = async () => {
    try {
      const backup = await db.migration_backups.get('v8');
      if (!backup) {
        alert(t('settings.noBackup'));
        return;
      }
      const blob = new Blob([backup.payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `baimiao_migration_backup_v8_${new Date(backup.created_at).toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(t('settings.downloadBackupFailed'));
    }
  };

  // #13 统一数据管理 -- 导出
  const handleUnifiedExport = async () => {
    const types = Array.from(unifiedExportTypes);
    if (types.length === 0) return;
    setIsUnifiedExporting(true);
    try {
      const opts: ExportOptions = { types, format: unifiedExportFormat };
      if (unifiedExportStartDate) {
        opts.dateStart = new Date(unifiedExportStartDate).getTime();
      }
      if (unifiedExportEndDate) {
        opts.dateEnd = new Date(unifiedExportEndDate).getTime() + 86400000 - 1;
      }
      const content = await exportData(opts);
      // 测试钩子：导出内容存 window 供 E2E 读取
      (window as any).__testExportData = content;
      const filename = getExportFilename(unifiedExportFormat);
      const mimeType = unifiedExportFormat === 'json' ? 'application/json' : 'text/markdown';
      downloadContent(content, filename, mimeType);
    } catch (e) {
      alert(t('settings.exportFailed'));
    } finally {
      setIsUnifiedExporting(false);
    }
  };

  // #13 统一数据管理 -- 导入
  const handleUnifiedFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUnifiedImportFile(file);
      setUnifiedImportResult(null);
    }
  };

  const handleUnifiedImport = async () => {
    if (!unifiedImportFile) return;
    setIsUnifiedImporting(true);
    setUnifiedImportResult(null);
    try {
      const text = await unifiedImportFile.text();
      const result = await importData(text, unifiedImportStrategy);
      setUnifiedImportResult(result);
      (window as any).__testImportResult = result;
    } catch (e: any) {
      const errResult: ImportResult = { imported: 0, skipped: 0, errors: [e?.message || t('settings.importFailed')] };
      setUnifiedImportResult(errResult);
      (window as any).__testImportResult = errResult;
    } finally {
      setIsUnifiedImporting(false);
    }
  };

  // #13 聊天记录单独导出
  const handleConvExport = async (format: 'markdown' | 'json') => {
    try {
      const content = await exportConversations(format);
      (window as any).__testExportData = content;
      const filename = getExportFilename(format, 'baimiao-conversations');
      const mimeType = format === 'json' ? 'application/json' : 'text/markdown';
      downloadContent(content, filename, mimeType);
    } catch (e) {
      alert(t('settings.exportConvFailed'));
    }
  };

  // #13 聊天记录单独导入
  const handleConvFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setConvImportFile(file);
      setConvImportResult(null);
    }
  };

  const handleConvImport = async () => {
    if (!convImportFile) return;
    setIsConvImporting(true);
    setConvImportResult(null);
    try {
      const text = await convImportFile.text();
      const result = await importConversations(text, convImportStrategy);
      setConvImportResult(result);
      (window as any).__testImportResult = result;
    } catch (e: any) {
      const errResult: ImportResult = { imported: 0, skipped: 0, errors: [e?.message || t('settings.importFailed')] };
      setConvImportResult(errResult);
      (window as any).__testImportResult = errResult;
    } finally {
      setIsConvImporting(false);
    }
  };

  // Seam 2: 关于面板 -- 检查更新并重载（从 Layout About Modal 迁移）
  const handleForceUpdate = async () => {
    setIsUpdating(true);
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (let registration of registrations) {
          await registration.update();
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      window.location.reload();
    } catch (err) {
      await new Promise(resolve => setTimeout(resolve, 500));
      window.location.reload();
    }
  };

  // Seam 2: 左侧菜单项定义
  const menuItems: { id: typeof activeTab; label: string; icon: React.ReactNode }[] = [
    { id: 'model', label: t('settings.tabModel'), icon: <MessageSquare className="w-4 h-4" /> },
    { id: 'tts', label: t('settings.tabTts'), icon: <Volume2 className="w-4 h-4" /> },
    { id: 'embedding', label: t('settings.tabEmbedding'), icon: <Server className="w-4 h-4" /> },
    { id: 'data', label: t('settings.tabData'), icon: <Database className="w-4 h-4" /> },
    { id: 'prompt', label: t('settings.tabPrompt'), icon: <Settings2 className="w-4 h-4" /> },
    { id: 'tags', label: t('settings.tabTags'), icon: <Tags className="w-4 h-4" /> },
    { id: 'transcription', label: t('settings.tabTranscription'), icon: <Mic className="w-4 h-4" /> },
    { id: 'about', label: t('settings.tabAbout'), icon: <Info className="w-4 h-4" /> },
  ];

  const handleMenuSelect = (tab: typeof activeTab) => {
    setActiveTab(tab);
    // 桌面端下抽屉与详情页左右分栏常驻显示，点菜单项只切 tab、不切 view
    if (!isDesktop) {
      setView('detail');
    }
  };

  // Issue 109: 横向导航栏左右滑动切换 tab
  const touchStartX = useRef<number | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(delta) < 50) return; // 滑动阈值
    const currentIndex = menuItems.findIndex(item => item.id === activeTab);
    if (delta > 0 && currentIndex > 0) {
      setActiveTab(menuItems[currentIndex - 1].id);
    } else if (delta < 0 && currentIndex < menuItems.length - 1) {
      setActiveTab(menuItems[currentIndex + 1].id);
    }
    touchStartX.current = null;
  };

  // Seam 8: 火山引擎 TTS API Key 客户端即时校验（仅 external + volcengine 时生效）
  const ttsApiKeyInvalid = ttsService === 'external' && ttsProvider === 'volcengine' && !isVolcengineTtsKeyValid(ttsApiKey);

  // Issue 109: 抽屉菜单项（上半部分）
  const drawerNav = (
    <nav className="flex flex-col gap-0.5 p-2 shrink-0">
      {menuItems.map(item => (
        <button
          key={item.id}
          onClick={() => handleMenuSelect(item.id)}
          className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all ${
            activeTab === item.id
              ? 'bg-baimiao-mysteria/8 text-baimiao-mysteria font-semibold'
              : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100/60'
          }`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </nav>
  );

  // Issue 109: 全屏详情页顶部横向导航栏（胶囊高亮 + 横向滚动）
  const horizontalNav = (
    <div
      className="shrink-0 border-b border-baimiao-border/30 bg-[#faf9fc]/40 overflow-x-auto thin-scrollbar overscroll-x-none"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      data-testid="settings-horizontal-nav"
    >
      <div className="flex gap-1.5 p-2 min-w-min">
        {menuItems.map(item => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-medium transition-all whitespace-nowrap shrink-0 ${
              activeTab === item.id
                ? 'bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white shadow-sm font-semibold'
                : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100/60'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );

  // 统一根容器 + 条件渲染：桌面端（isDesktop=true）下抽屉与详情页左右分栏同时常驻显示，抽屉不滑入、无遮罩
  // Issue 004（方案 B）：桌面端整体区域 = 视口 1/3，靠左对齐，右侧 2/3 留空
  return (
    <div
      className={`flex h-full bg-stone-100 font-sans text-stone-900 overflow-hidden ${
        isDesktop ? 'flex-row w-1/3 mx-auto' : 'relative flex-col items-center justify-center'
      }`}
    >
      {/* 移动端遮罩：仅 drawer view 显示，点击关闭设置 */}
      {!isDesktop && view === 'drawer' && (
        <div
          className="absolute inset-0 bg-white/30 backdrop-blur-md z-40"
          onClick={() => navigate(-1)}
          data-testid="settings-drawer-backdrop"
        />
      )}

      {/* 抽屉：桌面端常驻显示 + 相对定位 + 无滑入动画；移动端绝对定位 + 滑入动画 */}
      {/* Issue 004（方案 B）：桌面端抽屉 = 视口 1/9（=根容器 1/3 的 1/3），替代原 w-72 */}
      {(isDesktop || view === 'drawer') && (
        <motion.aside
          className={`flex flex-col border-r border-baimiao-border/30 bg-[#faf9fc] shrink-0 ${
            isDesktop
              ? 'relative w-1/3 h-full shadow-none'
              : 'absolute top-0 left-0 bottom-0 w-72 z-50 shadow-xl'
          }`}
          initial={isDesktop ? false : { x: '-100%' }}
          animate={isDesktop ? undefined : { x: 0 }}
          transition={isDesktop ? undefined : { duration: 0.3, ease: 'easeInOut' }}
          data-testid="settings-drawer"
        >
          {/* 抽屉头部 */}
          <div className="flex h-14 items-center justify-between px-4 bg-[#faf9fc]/85 backdrop-blur border-b border-baimiao-border/40 shrink-0">
            <h2 className="text-[15.5px] font-bold text-baimiao-mysteria font-serif baimiao-editorial-title">{t('settings.title')}</h2>
            <button
              onClick={() => navigate(-1)}
              className="p-2 -mr-2 text-stone-400 hover:text-stone-700 hover:bg-stone-100/60 transition-all rounded-full active:scale-90"
              aria-label={t('about.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Issue 003: 语言选择模块平铺到抽屉 header 下方 */}
          <div className="flex items-center justify-between px-3 py-2.5 shrink-0" data-testid="drawer-language-switcher">
            <span className="text-[13px] font-medium text-stone-700">{t('settings.languageLabel')}</span>
            <div className="inline-flex items-center bg-stone-100/80 rounded-full p-0.5">
              <button
                data-testid="language-zh"
                onClick={() => setLanguage('zh')}
                className={`w-16 py-1.5 rounded-full text-[12.5px] font-medium transition-all text-center ${
                  language === 'zh'
                    ? 'bg-white text-baimiao-mysteria shadow-sm font-bold'
                    : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                {t('settings.languageZh')}
              </button>
              <button
                data-testid="language-en"
                onClick={() => setLanguage('en')}
                className={`w-16 py-1.5 rounded-full text-[12.5px] font-medium transition-all text-center ${
                  language === 'en'
                    ? 'bg-white text-baimiao-mysteria shadow-sm font-bold'
                    : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                {t('settings.languageEn')}
              </button>
            </div>
          </div>

          {/* 上半部分：设置菜单项（不滚动） */}
          {drawerNav}

          {/* task-111: 抽屉「所有标签」区块支持展开/收起；管理入口改为设置图标 */}
          <div className="flex-1 overflow-hidden flex flex-col border-t border-baimiao-border/30 min-h-0">
            <div className="flex items-center justify-between px-4 py-2.5 shrink-0">
              <button
                onClick={() => setTagsExpanded(v => !v)}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-stone-500 uppercase tracking-wider transition-colors hover:text-stone-700"
                aria-label={tagsExpanded ? t('thoughts.collapse') : t('thoughts.expand')}
                data-testid="drawer-all-tags-toggle"
              >
                {t('settings.allTags')}
                {tagsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              <button
                onClick={() => {
                  setActiveTab('tags');
                  // 桌面端下抽屉与详情页左右分栏常驻显示，只切 tab、不切 view
                  if (!isDesktop) setView('detail');
                }}
                className="p-1.5 -mr-1.5 text-baimiao-mysteria hover:bg-baimiao-mysteria/5 rounded-full transition-all active:scale-95"
                aria-label={t('settings.manageTags')}
                data-testid="drawer-manage-tags"
              >
                <Settings2 className="w-4 h-4" />
              </button>
            </div>
            {tagsExpanded && (
              <DrawerTagList />
            )}
          </div>
        </motion.aside>
      )}

      {/* 详情页：桌面端常驻显示 + 占满剩余宽度；移动端 view==='detail' 时居中卡片显示 */}
      {/* Issue 004（方案 B）：桌面端主面板 = 根容器剩余空间（=视口 2/9，由 flex-1 自动计算） */}
      {(isDesktop || view === 'detail') && (
        <div
          className={`flex flex-col h-full overflow-hidden bg-white ${
            isDesktop
              ? 'flex-1 ring-1 ring-black/5'
              : 'relative z-50 mx-auto w-full md:max-w-3xl shadow-sm ring-1 ring-black/5'
          }`}
        >
        {/* Header -- 直接关闭设置（不返回抽屉） */}
        <div className="flex h-14 items-center px-4 bg-[#faf9fc]/85 backdrop-blur border-b border-baimiao-border/40 shrink-0">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-baimiao-mysteria/70 hover:text-baimiao-mysteria hover:bg-baimiao-mysteria/5 transition-all rounded-full active:scale-90" aria-label={t('settings.back')}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-[15.5px] font-bold ml-2 text-baimiao-mysteria font-serif baimiao-editorial-title">{t('settings.title')}</h2>
        </div>

        {/* 横向导航栏 */}
        {horizontalNav}

        {/* Content area */}
        <div className="flex-1 overflow-y-auto thin-scrollbar w-full p-3 space-y-3 pb-20">

        <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          className="space-y-3"
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          {activeTab === 'model' && (
            <>
              {/* Provider Selection */}
              <section className="baimiao-card-diary p-1.5">
                 <div className="grid grid-cols-4 gap-1 p-1">
                    {[
                      { id: 'gemini', label: 'Gemini', defaultBase: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-3.1-flash-lite', link: 'https://aistudio.google.com/app/apikey' },
                      { id: 'openai', label: 'OpenAI', defaultBase: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', link: 'https://platform.openai.com/api-keys' },
                      { id: 'volcengine', label: t('provider.volcengine'), defaultBase: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'ep-xxx', link: 'https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint' },
                      { id: 'kimi', label: 'Kimi', defaultBase: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k', link: 'https://platform.moonshot.cn/console/api-keys' },
                      { id: 'zhipu', label: t('provider.zhipu'), defaultBase: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash', link: 'https://bigmodel.cn/usercenter/apikeys' },
                      { id: 'minimax', label: 'MiniMax', defaultBase: 'https://api.minimax.chat/v1', defaultModel: 'abab6.5s-chat', link: 'https://platform.minimaxi.com/user-center/basic-information' },
                      { id: 'mimo', label: 'MIMO', defaultBase: 'https://ai.xiaomi.com/v1', defaultModel: 'mimo-chat', link: 'https://open.xiaomi.com/' },
                      { id: 'anthropic', label: 'Anthropic', defaultBase: 'https://api.anthropic.com/v1', defaultModel: 'claude-3-5-sonnet-latest', link: 'https://console.anthropic.com/' },
                      { id: 'deepseek', label: 'DeepSeek', defaultBase: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', link: 'https://platform.deepseek.com/' },
                      { id: 'siliconflow', label: t('provider.siliconflow'), defaultBase: 'https://api.siliconflow.cn/v1', defaultModel: 'Qwen/Qwen2.5-7B-Instruct', link: 'https://cloud.siliconflow.cn/account/ak' },
                      { id: 'custom', label: t('provider.custom'), defaultBase: 'http://127.0.0.1:11434/v1', defaultModel: 'llama3', link: '' }
                    ].map(p => (
                       <button
                         key={p.id}
                         onClick={() => {
                           setSettings({ provider: p.id as any });
                         }}
                         className={`flex items-center justify-center py-1.5 px-1 rounded-lg text-[12px] font-medium transition-all ${
                           provider === p.id 
                             ? 'bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white shadow-md' 
                             : 'text-stone-500 hover:bg-baimiao-mysteria/5 hover:text-baimiao-mysteria transition-all'
                         }`}
                       >
                         {p.label}
                       </button>
                    ))}
                 </div>
              </section>

              {/* Dynamic Fields */}
              <section className="space-y-3">
                <div className="baimiao-card-diary p-4 space-y-3">
                  <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase mb-1">{t('settings.configDetails')}</h3>
                  
                  {/* API Key */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-[13px] font-medium text-stone-700">
                        <KeyRound className="w-4 h-4 text-stone-400" />
                        API Key
                      </label>
                      <div className="flex items-center gap-6">
                        {(() => {
                          const linkInfo = [
                            { id: 'gemini', link: 'https://aistudio.google.com/app/apikey' },
                            { id: 'openai', link: 'https://platform.openai.com/api-keys' },
                            { id: 'volcengine', link: 'https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint' },
                            { id: 'kimi', link: 'https://platform.moonshot.cn/console/api-keys' },
                            { id: 'zhipu', link: 'https://bigmodel.cn/usercenter/apikeys' },
                            { id: 'minimax', link: 'https://platform.minimaxi.com/user-center/basic-information' },
                            { id: 'mimo', link: 'https://open.xiaomi.com/' },
                            { id: 'anthropic', link: 'https://console.anthropic.com/' },
                            { id: 'deepseek', link: 'https://platform.deepseek.com/' },
                            { id: 'siliconflow', link: 'https://cloud.siliconflow.cn/account/ak' },
                          ].find(x => x.id === provider)?.link;
                          
                          return linkInfo ? (
                            <a href={linkInfo} target="_blank" rel="noreferrer" className="text-[11.5px] text-[#8a859e] hover:text-baimiao-mysteria transition-colors hover:underline font-normal select-none leading-none">{t('settings.applyKey')}</a>
                          ) : null;
                        })()}
                        {chatTestStatus === 'testing' ? (
                          <span className="text-[11.5px] text-stone-400 flex items-center gap-1 select-none font-medium leading-none">
                            <Loader2 className="w-3 h-3 animate-spin text-baimiao-mysteria" />
                            测试中...
                          </span>
                        ) : chatTestStatus === 'success' ? (
                          <span className="text-[11.5px] text-green-600 font-semibold flex items-center gap-0.5 animate-in fade-in select-none leading-none">
                            已连通 ✅
                          </span>
                        ) : chatTestStatus === 'fail' ? (
                          <span 
                            className="text-[11.5px] text-rose-500 font-semibold flex items-center gap-0.5 animate-in fade-in cursor-help select-none leading-none"
                            title={chatTestError}
                          >
                            连接失败 ❌
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={handleTestChatConnection}
                            className="text-[11.5px] text-[#8a859e] hover:text-baimiao-mysteria font-medium hover:underline select-none active:scale-95 transition-all leading-none"
                          >
                            测试连接
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="relative">
                      <input
                        type={showApiKey ? "text" : "password"}
                        placeholder={t('settings.apiKeyPlaceholder')}
                        value={apiKey}
                        onChange={e => setSettings({ apiKey: e.target.value })}
                        className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 pr-10 rounded-lg text-[14px] text-stone-900 placeholder:text-stone-400 transition-all font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-stone-400 hover:text-stone-600 focus:outline-none"
                      >
                        {showApiKey ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    <p className="text-[11px] text-stone-400 leading-tight">{t('settings.apiKeySafety')}</p>
                  </div>
 
                  {/* Base URL */}
                  <div className="space-y-1.5 pt-2 border-t border-stone-100">
                    <label className="flex items-center gap-2 text-[13px] font-medium text-stone-700">
                      <Server className="w-4 h-4 text-stone-400" />
                      自定义代理地址 (Base URL)
                    </label>
                    <input
                      type="text"
                      placeholder={[
                        { id: 'gemini', defaultBase: 'https://generativelanguage.googleapis.com' },
                        { id: 'openai', defaultBase: 'https://api.openai.com/v1' },
                        { id: 'volcengine', defaultBase: 'https://ark.cn-beijing.volces.com/api/v3' },
                        { id: 'kimi', defaultBase: 'https://api.moonshot.cn/v1' },
                        { id: 'zhipu', defaultBase: 'https://open.bigmodel.cn/api/paas/v4' },
                        { id: 'minimax', defaultBase: 'https://api.minimax.chat/v1' },
                        { id: 'mimo', defaultBase: 'https://ai.xiaomi.com/v1' },
                        { id: 'anthropic', defaultBase: 'https://api.anthropic.com/v1' },
                        { id: 'deepseek', defaultBase: 'https://api.deepseek.com/v1' },
                        { id: 'siliconflow', defaultBase: 'https://api.siliconflow.cn/v1' },
                        { id: 'custom', defaultBase: 'http://127.0.0.1:11434/v1' }
                      ].find(x => x.id === provider)?.defaultBase || ''}
                      value={baseUrl}
                      onChange={e => setSettings({ baseUrl: e.target.value })}
                      className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-lg text-[14px] text-stone-900 transition-all font-mono placeholder:text-stone-300"
                    />
                  </div>
 
                  {/* Model Name */}
                  <div className="space-y-1.5 pt-2 border-t border-stone-100">
                    <label className="flex items-center gap-2 text-[13px] font-medium text-stone-700">
                      <Cpu className="w-4 h-4 text-stone-400" />
                      模型名称 (Model)
                    </label>
                    <input
                      type="text"
                      placeholder={[
                        { id: 'gemini', defaultModel: 'gemini-3.1-flash-lite' },
                        { id: 'openai', defaultModel: 'gpt-4o-mini' },
                        { id: 'volcengine', defaultModel: 'doubao-seed-2-0-lite-260428' },
                        { id: 'kimi', defaultModel: 'moonshot-v1-8k' },
                        { id: 'zhipu', defaultModel: 'glm-4-flash' },
                        { id: 'minimax', defaultModel: 'abab6.5s-chat' },
                        { id: 'mimo', defaultModel: 'mimo-chat' },
                        { id: 'anthropic', defaultModel: 'claude-3-5-sonnet-latest' },
                        { id: 'deepseek', defaultModel: 'deepseek-chat' },
                        { id: 'siliconflow', defaultModel: 'Qwen/Qwen2.5-7B-Instruct' },
                        { id: 'custom', defaultModel: 'llama3' }
                      ].find(x => x.id === provider)?.defaultModel || ''}
                      value={model}
                      onChange={e => setSettings({ model: e.target.value })}
                      className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-lg text-[14px] text-stone-900 transition-all font-mono placeholder:text-stone-300"
                    />
                  </div>
                </div>
              </section>

              {/* #6 多媒体提交开关 */}
              <section className="baimiao-card-diary p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1 pr-3">
                    <h3 className="text-[13px] font-semibold text-stone-700 mb-1">{t('settings.multimediaSummary')}</h3>
                    <p className="text-[11.5px] text-stone-400 leading-relaxed">
                      生成回顾/洞察时，是否将图片/视频附件的 AI 摘要一并提交给模型。关闭后仅提交文本内容。
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={submitMultimedia}
                      onChange={e => setSettings({ submitMultimedia: e.target.checked })}
                      data-testid="submit-multimedia-toggle"
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-stone-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-baimiao-mysteria"></div>
                  </label>
                </div>
              </section>

            </>
          )}

          {activeTab === 'tts' && (
            <section className="baimiao-card-diary p-4 space-y-3" data-testid="tts-config-section">
                <div className="flex items-center gap-2 border-b border-stone-100 pb-2 mb-1">
                  <Volume2 className="w-4 h-4 text-baimiao-mysteria" />
                  <h3 className="text-[13px] font-semibold text-stone-700">{t('settings.tts')}</h3>
                </div>
                <p className="text-[11.5px] text-stone-400 leading-relaxed">
                  {t('settings.ttsDesc')}
                </p>

                {/* 朗读服务选择 */}
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-stone-500">{t('settings.ttsService')}</label>
                  <div className="flex gap-1 p-1 bg-black/5 rounded-lg">
                    <button
                      type="button"
                      data-testid="tts-service-webspeech"
                      onClick={() => setSettings({ ttsService: 'webspeech' })}
                      className={`flex-1 flex justify-center py-1.5 text-[11.5px] font-medium rounded-md transition-all ${
                        ttsService === 'webspeech'
                          ? 'bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white shadow-sm'
                          : 'text-stone-500 hover:bg-white/50 hover:text-baimiao-mysteria'
                      }`}
                    >
                      {t('settings.ttsWebspeech')}
                    </button>
                    <button
                      type="button"
                      data-testid="tts-service-external"
                      onClick={() => setSettings({ ttsService: 'external' })}
                      className={`flex-1 flex justify-center py-1.5 text-[11.5px] font-medium rounded-md transition-all ${
                        ttsService === 'external'
                          ? 'bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white shadow-sm'
                          : 'text-stone-500 hover:bg-white/50 hover:text-baimiao-mysteria'
                      }`}
                    >
                      {t('settings.ttsExternal')}
                    </button>
                  </div>
                  {ttsService === 'external' && (
                    <p className="text-[10.5px] text-stone-400 leading-relaxed mt-1">
                      {t('settings.ttsExternalHint')}
                    </p>
                  )}
                </div>

                {/* #009: 外部 TTS API 配置（仅 ttsService === 'external' 时展开） */}
                {ttsService === 'external' && (
                  <div className="space-y-3 pt-1.5 border-t border-stone-100 animate-in fade-in duration-200" data-testid="tts-external-config">
                    <h4 className="text-[12px] font-semibold text-stone-500">{t('settings.ttsExternalConfig')}</h4>

                    {/* Provider 选择 */}
                    <div className="space-y-1.5">
                      <label className="text-[12px] font-medium text-stone-500">{t('settings.ttsProvider')}</label>
                      <div className="grid grid-cols-2 gap-1 p-1 bg-black/5 rounded-lg">
                        {[
                          { id: 'gemini', label: 'Gemini' },
                          { id: 'volcengine', label: t('provider.volcengine') }
                        ].map(p => (
                          <button
                            key={p.id}
                            type="button"
                            data-testid={`tts-provider-${p.id}`}
                            onClick={() => setSettings({ ttsProvider: p.id as 'gemini' | 'volcengine' })}
                            className={`flex items-center justify-center py-1.5 text-[11.5px] font-medium rounded-md transition-all ${
                              ttsProvider === p.id
                                ? 'bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white shadow-sm'
                                : 'text-stone-500 hover:bg-white/50 hover:text-baimiao-mysteria'
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* API Key */}
                    <div className="space-y-1.5">
                      <label className="flex items-center gap-2 text-[12px] font-medium text-stone-700">
                        <KeyRound className="w-3.5 h-3.5 text-stone-400" />
                        {t('settings.ttsApiKey')}
                      </label>
                      <div className="relative">
                        <input
                          type={showTtsApiKey ? 'text' : 'password'}
                          value={ttsApiKey}
                          onChange={e => setSettings({ ttsApiKey: e.target.value })}
                          data-testid="tts-api-key"
                          className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 pr-10 rounded-lg text-[13px] text-stone-900 transition-all font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowTtsApiKey(!showTtsApiKey)}
                          className="absolute inset-y-0 right-0 pr-3 flex items-center text-stone-400 hover:text-stone-600 focus:outline-none"
                        >
                          {showTtsApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      {ttsApiKeyInvalid ? (
                        <p className="text-[10.5px] text-rose-500 leading-tight">{t('settings.ttsApiKeyInvalidVolcengine')}</p>
                      ) : (
                        <p className="text-[10.5px] text-stone-400 leading-tight">
                          {ttsProvider === 'volcengine' ? t('settings.ttsApiKeyHintVolcengine') : t('settings.ttsApiKeyHintGemini')}
                        </p>
                      )}
                    </div>

                    {/* Base URL */}
                    <div className="space-y-1.5 pt-1.5 border-t border-stone-100">
                      <label className="flex items-center gap-2 text-[12px] font-medium text-stone-700">
                        <Server className="w-3.5 h-3.5 text-stone-400" />
                        {t('settings.ttsBaseUrlLabel')}
                      </label>
                      <input
                        type="text"
                        value={ttsBaseUrl}
                        onChange={e => setSettings({ ttsBaseUrl: e.target.value })}
                        data-testid="tts-base-url"
                        className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 rounded-lg text-[13px] text-stone-900 transition-all font-mono"
                      />
                    </div>

                    {/* Model */}
                    <div className="space-y-1.5 pt-1.5 border-t border-stone-100">
                      <label className="flex items-center gap-2 text-[12px] font-medium text-stone-700">
                        <Cpu className="w-3.5 h-3.5 text-stone-400" />
                        {t('settings.ttsModelLabel')}
                      </label>
                      <input
                        type="text"
                        value={ttsModel}
                        onChange={e => setSettings({ ttsModel: e.target.value })}
                        data-testid="tts-model"
                        className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 rounded-lg text-[13px] text-stone-900 transition-all font-mono"
                      />
                      <p className="text-[10.5px] text-stone-400 leading-tight">
                        {ttsProvider === 'volcengine' ? t('settings.ttsModelHintVolcengine') : t('settings.ttsModelHintGemini')}
                      </p>
                    </div>

                    {/* Voice */}
                    <div className="space-y-1.5 pt-1.5 border-t border-stone-100">
                      <label className="flex items-center gap-2 text-[12px] font-medium text-stone-700">
                        <Volume2 className="w-3.5 h-3.5 text-stone-400" />
                        {t('settings.ttsVoiceLabel')}
                      </label>
                      {(() => {
                        const matched = ttsProvider === 'gemini' || ttsProvider === 'volcengine'
                          ? findTtsVoiceLabel(ttsProvider, ttsVoice)
                          : null;
                        const unmatched = !matched && !!ttsVoice;
                        return (
                          <>
                            <button
                              type="button"
                              onClick={() => setTtsVoiceModalOpen(true)}
                              data-testid="tts-voice"
                              className={`w-full bg-white border shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 rounded-lg text-[13px] text-left transition-all flex items-center justify-between ${
                                unmatched ? 'border-rose-300' : 'border-black/5'
                              }`}
                            >
                              <span className={matched ? 'text-stone-900' : 'text-stone-400'}>
                                {matched ? matched.label : ttsVoice || t('settings.ttsVoicePlaceholder')}
                              </span>
                              <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
                            </button>
                            {unmatched && (
                              <p className="text-[10.5px] text-rose-500 leading-tight">
                                {t('settings.ttsVoiceUnmatched', { value: ttsVoice })}
                              </p>
                            )}
                            {!matched && !ttsVoice && (
                              <p className="text-[10.5px] text-stone-400 leading-tight">
                                {ttsProvider === 'gemini'
                                  ? `${TTS_VOICES.gemini.length} 个预置音色可选`
                                  : `${TTS_VOICES.volcengine.length} 个预置音色可选`}
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* 默认朗读语言 */}
                <div className="space-y-1.5 pt-1.5 border-t border-stone-100">
                  <label className="text-[12px] font-medium text-stone-500">{t('settings.ttsLang')}</label>
                  <select
                    value={ttsLang}
                    onChange={e => setSettings({ ttsLang: e.target.value as 'auto' | 'zh' | 'en' })}
                    data-testid="tts-lang-select"
                    className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-lg text-[13px] text-stone-900 cursor-pointer font-mono"
                  >
                    <option value="auto">{t('settings.ttsLangAuto')}</option>
                    <option value="zh">{t('settings.ttsLangZh')}</option>
                    <option value="en">{t('settings.ttsLangEn')}</option>
                  </select>
                </div>

                {/* 语速 */}
                <div className="space-y-1.5 pt-1.5 border-t border-stone-100">
                  <label className="text-[12px] font-medium text-stone-500 flex items-center justify-between">
                    <span>{t('settings.ttsRate')}</span>
                    <span className="font-mono text-stone-400 text-[11px]">{ttsRate.toFixed(1)}x</span>
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={ttsRate}
                    onChange={e => setSettings({ ttsRate: parseFloat(e.target.value) })}
                    data-testid="tts-rate-slider"
                    className="w-full accent-baimiao-mysteria cursor-pointer"
                  />
                </div>
            </section>
          )}

          {activeTab === 'embedding' && (
            <>
              <section className="space-y-3">
                <div className="baimiao-card-diary p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-stone-100 pb-2 mb-1">
                    <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase">{t('settings.embeddingTitle')}</h3>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={embedEnabled} 
                        onChange={e => setSettings({ embedEnabled: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-stone-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-baimiao-mysteria"></div>
                    </label>
                  </div>

                  {embedEnabled && (
                    <div className="space-y-3 pt-1">
                      {/* Provider Row */}
                      <div className="grid grid-cols-5 gap-1 p-1 bg-black/5 rounded-lg">
                        {[
                          { id: 'gemini', label: 'Gemini' },
                          { id: 'openai', label: 'OpenAI' },
                          { id: 'siliconflow', label: t('provider.siliconflowShort') },
                          { id: 'zhipu', label: t('provider.zhipu') },
                          { id: 'custom', label: t('provider.custom') }
                        ].map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setSettings({ embedProvider: p.id as any });
                            }}
                            className={`flex items-center justify-center py-1 px-0.5 rounded-md text-[11px] font-medium transition-all ${
                              embedProvider === p.id 
                                ? 'bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white shadow-sm' 
                                : 'text-stone-500 hover:bg-white/50 hover:text-baimiao-mysteria'
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>

                      {/* API Key */}
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between">
                          <label className="flex items-center gap-2 text-[12px] font-medium text-stone-700">
                            <KeyRound className="w-3.5 h-3.5 text-stone-400" />
                            {t('settings.embeddingApiKey')}
                          </label>
                          <div className="flex items-center gap-6">
                            {(() => {
                              const linkInfo = [
                                { id: 'gemini', link: 'https://aistudio.google.com/app/apikey' },
                                { id: 'openai', link: 'https://platform.openai.com/api-keys' },
                                { id: 'siliconflow', link: 'https://cloud.siliconflow.cn/account/ak' },
                                { id: 'zhipu', link: 'https://bigmodel.cn/usercenter/apikeys' }
                              ].find(x => x.id === embedProvider)?.link;
                              
                              return linkInfo ? (
                                <a href={linkInfo} target="_blank" rel="noreferrer" className="text-[11.5px] text-[#8a859e] hover:text-baimiao-mysteria transition-colors hover:underline font-normal select-none leading-none">{t('settings.applyKey')}</a>
                              ) : null;
                            })()}
                            {embedTestStatus === 'testing' ? (
                              <span className="text-[11.5px] text-stone-400 flex items-center gap-1 select-none font-medium leading-none">
                                <Loader2 className="w-3 h-3 animate-spin text-baimiao-mysteria" />
                                {t('settings.testing')}
                              </span>
                            ) : embedTestStatus === 'success' ? (
                              <span className="text-[11.5px] text-green-600 font-semibold flex items-center gap-0.5 animate-in fade-in select-none leading-none">
                                {t('settings.connected')}
                              </span>
                            ) : embedTestStatus === 'fail' ? (
                              <span
                                className="text-[11.5px] text-rose-500 font-semibold flex items-center gap-0.5 animate-in fade-in cursor-help select-none leading-none"
                                title={embedTestError}
                              >
                                {t('settings.connectionFailed')}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={handleTestEmbedConnection}
                                className="text-[11.5px] text-[#8a859e] hover:text-baimiao-mysteria font-medium hover:underline select-none active:scale-95 transition-all leading-none"
                              >
                                {t('settings.testConnection')}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="relative">
                          <input
                            type={showEmbedApiKey ? "text" : "password"}
                            placeholder={embedProvider === 'gemini' && !embedApiKey && apiKey ? t('settings.embeddingAutoReuse') : t('settings.apiKeyPlaceholder')}
                            value={embedApiKey}
                            onChange={e => setSettings({ embedApiKey: e.target.value })}
                            className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 pr-10 rounded-lg text-[13px] text-stone-900 placeholder:text-stone-400 transition-all font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => setShowEmbedApiKey(!showEmbedApiKey)}
                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-stone-400 hover:text-stone-600 focus:outline-none"
                          >
                            {showEmbedApiKey ? (
                              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Base URL */}
                      <div className="space-y-1.5 pt-1.5 border-t border-stone-100">
                        <label className="flex items-center gap-2 text-[12px] font-medium text-stone-700">
                          <Server className="w-3.5 h-3.5 text-stone-400" />
                          {t('settings.embeddingBaseUrl')}
                        </label>
                        <input
                          type="text"
                          placeholder={[
                            { id: 'gemini', defaultBase: 'https://generativelanguage.googleapis.com' },
                            { id: 'openai', defaultBase: 'https://api.openai.com/v1' },
                            { id: 'siliconflow', defaultBase: 'https://api.siliconflow.cn/v1' },
                            { id: 'zhipu', defaultBase: 'https://open.bigmodel.cn/api/paas/v4' },
                            { id: 'custom', defaultBase: 'http://127.0.0.1:11434/v1' }
                          ].find(x => x.id === embedProvider)?.defaultBase || ''}
                          value={embedBaseUrl}
                          onChange={e => setSettings({ embedBaseUrl: e.target.value })}
                          className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 rounded-lg text-[13px] text-stone-900 transition-all font-mono placeholder:text-stone-350"
                        />
                      </div>

                      {/* Model Name */}
                      <div className="space-y-1.5 pt-1.5 border-t border-stone-100">
                        <label className="flex items-center gap-2 text-[12px] font-medium text-stone-700">
                          <Cpu className="w-3.5 h-3.5 text-stone-400" />
                          {t('settings.embeddingModel')}
                        </label>
                        <input
                          type="text"
                          placeholder={[
                            { id: 'gemini', defaultModel: 'gemini-embedding-2' },
                            { id: 'openai', defaultModel: 'text-embedding-3-small' },
                            { id: 'siliconflow', defaultModel: 'BAAI/bge-large-zh-v1.5' },
                            { id: 'zhipu', defaultModel: 'embedding-3' },
                            { id: 'custom', defaultModel: 'nomic-embed-text' }
                          ].find(x => x.id === embedProvider)?.defaultModel || ''}
                          value={embedModel}
                          onChange={e => setSettings({ embedModel: e.target.value })}
                          className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 rounded-lg text-[13px] text-stone-900 transition-all font-mono placeholder:text-stone-350"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {embedEnabled && (
                <section className="space-y-3 animate-in fade-in duration-250">
                  <div className="baimiao-card-diary p-4 space-y-3">
                    <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase flex items-center gap-1.5 border-b border-stone-100 pb-2 mb-1">
                      {t('settings.embeddingStatus')}
                    </h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center text-[13px] text-stone-700">
                        <span>{t('settings.embeddingReady')}</span>
                        <span className="font-mono font-bold text-stone-900">{t('settings.embeddingReadyCount', { count: totalVectorsCount })}</span>
                      </div>

                      <div className="flex justify-between items-center text-[13px] text-stone-700">
                        <span>{t('settings.embeddingQueue')}</span>
                        <span className="font-mono font-bold text-amber-600">
                          {embeddingQueueSize > 0 ? t('settings.embeddingQueueCount', { count: embeddingQueueSize }) : t('settings.embeddingQueueReady')}
                        </span>
                      </div>

                      <div className="pt-2 border-t border-stone-100 flex justify-center">
                        <button
                          type="button"
                          onClick={async () => {
                            const count = await enqueueAllMissingEmbeddings();
                            updateVectorsCount();
                            alert(t('settings.embeddingScanResult', { count }));
                          }}
                          className="w-fit px-5 bg-white hover:bg-stone-50 active:scale-[0.97] text-stone-600 border border-stone-200/80 py-2 rounded-xl text-[12.5px] font-medium transition-all text-center shadow-sm"
                        >
                          {t('settings.embeddingScan')}
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}

          {activeTab === 'prompt' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* Card 1: 日记生成 Prompt */}
              {/* #5: Card 1: 日记回顾生成 Prompt（合并旧日记+回顾，5 槽统一） */}
              <section className="baimiao-card-diary p-4 space-y-3 overflow-hidden">
                <div className="bg-[#f8f6fa] border-b border-stone-100/80 px-4 py-2 flex flex-col gap-2 -mx-4 -mt-4">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-[13px] font-bold text-stone-700 border-l-2 border-baimiao-mysteria pl-2">
                      <Settings2 className="w-4 h-4 text-baimiao-mysteria" />
                      {t('settings.reviewPromptTitle')}
                    </label>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-0.5 items-center bg-[#f0edf4]/60 p-0.5 rounded-lg border border-stone-200/30 flex-wrap">
                      {localReviewPromptNames.map((label, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setLocalReviewIndex(idx)}
                          className={`px-2 py-0.5 text-[10.5px] font-medium rounded transition-all active:scale-[0.93] shrink-0 ${
                            localReviewIndex === idx
                              ? 'bg-white text-baimiao-mysteria font-bold shadow-sm border border-stone-200/40'
                              : 'text-[#8a859e] hover:text-stone-600'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {localReviewIndex >= 2 && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = [...localReviewPrompts];
                          next[localReviewIndex] = '';
                          setLocalReviewPrompts(next);
                        }}
                        className="text-[11px] text-stone-400 hover:text-red-500 flex items-center gap-0.5 transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        {t('settings.clearCurrent')}
                      </button>
                    )}
                  </div>
                </div>

                {/* 自定义槽位（2/3/4）可改名 */}
                {localReviewIndex >= 2 && (
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-stone-500 font-medium shrink-0">{t('settings.slotName')}</label>
                    <input
                      type="text"
                      value={localReviewPromptNames[localReviewIndex]}
                      onChange={e => {
                        const next = [...localReviewPromptNames];
                        next[localReviewIndex] = e.target.value;
                        setLocalReviewPromptNames(next);
                      }}
                      placeholder={t('settings.slotNamePlaceholder')}
                      className="flex-1 bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-2.5 py-1.5 rounded-lg text-[12.5px] text-stone-900 transition-all"
                    />
                  </div>
                )}

                <textarea
                  placeholder={localReviewIndex < 2 ? '' : t('settings.promptPlaceholder')}
                  value={localReviewPrompts[localReviewIndex] || ''}
                  readOnly={localReviewIndex < 2}
                  onChange={e => {
                    if (localReviewIndex < 2) return;
                    const next = [...localReviewPrompts];
                    next[localReviewIndex] = e.target.value;
                    setLocalReviewPrompts(next);
                  }}
                  className={`w-full h-28 resize-none border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-xl text-[13px] transition-all font-mono leading-relaxed ${
                    localReviewIndex < 2
                      ? 'bg-stone-50 text-stone-400 border-dashed border-stone-200 cursor-not-allowed'
                      : 'bg-white text-stone-900 focus:bg-white'
                  }`}
                />

                {/* #5: 自动生成选中状态 - 每个槽位可勾选 */}
                <div className="pt-2 border-t border-stone-100">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-[11px] font-semibold text-stone-500">{t('settings.autoGenSelected')}</span>
                    <span className="text-[10px] text-stone-400">{t('settings.autoGenHint')}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {localReviewPromptNames.map((name, idx) => {
                      const isSelected = localReviewSelectedIndices.includes(idx);
                      const canToggle = !isSelected || localReviewSelectedIndices.length > 1;
                      return (
                        <label
                          key={idx}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border cursor-pointer transition-all select-none ${
                            isSelected
                              ? 'bg-baimiao-mysteria/5 border-baimiao-mysteria/20 text-baimiao-mysteria'
                              : 'bg-stone-50 border-stone-200/60 text-stone-400'
                          } ${!canToggle ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={!canToggle}
                            onChange={() => {
                              if (isSelected) {
                                if (localReviewSelectedIndices.length <= 1) return;
                                setLocalReviewSelectedIndices(localReviewSelectedIndices.filter(i => i !== idx));
                              } else {
                                setLocalReviewSelectedIndices([...localReviewSelectedIndices, idx].sort((a, b) => a - b));
                              }
                            }}
                            className="w-3.5 h-3.5 rounded border-stone-300 text-baimiao-mysteria focus:ring-baimiao-mysteria/20 accent-baimiao-mysteria cursor-pointer"
                          />
                          <span className="text-[11.5px] font-medium">{name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* #008: 明悟和洞察生成 Prompt（合并原明悟+洞察，5 槽：明悟/洞察/自定义1/2/3） */}
              <section className="baimiao-card-diary p-4 space-y-3 overflow-hidden">
                <div className="bg-[#f8f6fa] border-b border-stone-100/80 px-4 py-2 flex flex-col gap-2 -mx-4 -mt-4">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-[13px] font-bold text-stone-700 border-l-2 border-baimiao-mysteria pl-2">
                      <Settings2 className="w-4 h-4 text-baimiao-mysteria" />
                      {t('settings.mingwuInsightPromptTitle')}
                    </label>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-0.5 items-center bg-[#f0edf4]/60 p-0.5 rounded-lg border border-stone-200/30 flex-wrap">
                      {localMingwuInsightPromptNames.map((label, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setLocalMingwuInsightIndex(idx)}
                          className={`px-2 py-0.5 text-[10.5px] font-medium rounded transition-all active:scale-[0.93] shrink-0 ${
                            localMingwuInsightIndex === idx
                              ? 'bg-white text-baimiao-mysteria font-bold shadow-sm border border-stone-200/40'
                              : 'text-[#8a859e] hover:text-stone-600'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {localMingwuInsightIndex >= 2 && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = [...localMingwuInsightPrompts];
                          next[localMingwuInsightIndex] = '';
                          setLocalMingwuInsightPrompts(next);
                        }}
                        className="text-[11px] text-stone-400 hover:text-red-500 flex items-center gap-0.5 transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        {t('settings.clearCurrent')}
                      </button>
                    )}
                  </div>
                </div>

                {/* 自定义槽位（2/3/4）可改名 */}
                {localMingwuInsightIndex >= 2 && (
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-stone-500 font-medium shrink-0">{t('settings.slotName')}</label>
                    <input
                      type="text"
                      value={localMingwuInsightPromptNames[localMingwuInsightIndex]}
                      onChange={e => {
                        const next = [...localMingwuInsightPromptNames];
                        next[localMingwuInsightIndex] = e.target.value;
                        setLocalMingwuInsightPromptNames(next);
                      }}
                      placeholder={t('settings.slotNamePlaceholder')}
                      className="flex-1 bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-2.5 py-1.5 rounded-lg text-[12.5px] text-stone-900 transition-all"
                    />
                  </div>
                )}

                <textarea
                  placeholder={localMingwuInsightIndex < 2 ? '' : t('settings.mingwuInsightPromptPlaceholder')}
                  value={localMingwuInsightPrompts[localMingwuInsightIndex] || ''}
                  readOnly={localMingwuInsightIndex < 2}
                  onChange={e => {
                    if (localMingwuInsightIndex < 2) return;
                    const next = [...localMingwuInsightPrompts];
                    next[localMingwuInsightIndex] = e.target.value;
                    setLocalMingwuInsightPrompts(next);
                  }}
                  className={`w-full h-28 resize-none border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-xl text-[13px] transition-all font-mono leading-relaxed ${
                    localMingwuInsightIndex < 2
                      ? 'bg-stone-50 text-stone-400 border-dashed border-stone-200 cursor-not-allowed'
                      : 'bg-white text-stone-900 focus:bg-white'
                  }`}
                />

                {/* #008: 自动生成选中状态 - 明悟/洞察/自定义槽位可勾选 */}
                <div className="pt-2 border-t border-stone-100">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-[11px] font-semibold text-stone-500">{t('settings.autoGenSelected')}</span>
                    <span className="text-[10px] text-stone-400">{t('settings.autoGenHintMingwuInsight')}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {localMingwuInsightPromptNames.map((name, idx) => {
                      const isSelected = localMingwuInsightSelectedIndices.includes(idx);
                      const canToggle = !isSelected || localMingwuInsightSelectedIndices.length > 1;
                      return (
                        <label
                          key={idx}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border cursor-pointer transition-all select-none ${
                            isSelected
                              ? 'bg-baimiao-mysteria/5 border-baimiao-mysteria/20 text-baimiao-mysteria'
                              : 'bg-stone-50 border-stone-200/60 text-stone-400'
                          } ${!canToggle ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={!canToggle}
                            onChange={() => {
                              if (isSelected) {
                                if (localMingwuInsightSelectedIndices.length <= 1) return;
                                setLocalMingwuInsightSelectedIndices(localMingwuInsightSelectedIndices.filter(i => i !== idx));
                              } else {
                                setLocalMingwuInsightSelectedIndices([...localMingwuInsightSelectedIndices, idx].sort((a, b) => a - b));
                              }
                            }}
                            className="w-3.5 h-3.5 rounded border-stone-300 text-baimiao-mysteria focus:ring-baimiao-mysteria/20 accent-baimiao-mysteria cursor-pointer"
                          />
                          <span className="text-[11.5px] font-medium">{name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* #008: 日记回顾一句话摘要生成 Prompt（合并原日记摘要+回顾摘要） */}
              <section className="baimiao-card-diary p-4 space-y-3 overflow-hidden">
                <div className="bg-[#f8f6fa] border-b border-stone-100/80 px-4 py-2.5 -mx-4 -mt-4 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 border-l-2 border-baimiao-mysteria pl-2">
                    <label className="flex items-center gap-1.5 text-[13px] font-bold text-stone-700">
                      <Settings2 className="w-4 h-4 text-baimiao-mysteria" />
                      {t('settings.diaryReviewSummaryPromptTitle')}
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLocalDiaryReviewSummaryPrompt(DEFAULT_DIARY_REVIEW_SUMMARY_PROMPT)}
                    className="text-[11px] text-stone-400 hover:text-red-500 flex items-center gap-1 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    {t('settings.restoreDefault')}
                  </button>
                </div>
                <textarea
                  placeholder={t('settings.diaryReviewSummaryPlaceholder')}
                  value={localDiaryReviewSummaryPrompt}
                  onChange={e => setLocalDiaryReviewSummaryPrompt(e.target.value)}
                  className="w-full h-24 resize-none bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-xl text-[13px] text-stone-900 placeholder:text-stone-400 transition-all font-mono leading-relaxed focus:bg-white"
                />
              </section>

              {/* #008: 明悟和洞察一句话摘要生成 Prompt（由原洞察摘要扩展，补明悟默认摘要） */}
              <section className="baimiao-card-diary p-4 space-y-3 overflow-hidden">
                <div className="bg-[#f8f6fa] border-b border-stone-100/80 px-4 py-2.5 -mx-4 -mt-4 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 border-l-2 border-baimiao-mysteria pl-2">
                    <label className="flex items-center gap-1.5 text-[13px] font-bold text-stone-700">
                      <Settings2 className="w-4 h-4 text-baimiao-mysteria" />
                      {t('settings.mingwuInsightSummaryPromptTitle')}
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLocalMingwuInsightSummaryPrompt(DEFAULT_MINGWU_INSIGHT_SUMMARY_PROMPT)}
                    className="text-[11px] text-stone-400 hover:text-red-500 flex items-center gap-1 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    {t('settings.restoreDefault')}
                  </button>
                </div>
                <textarea
                  placeholder={t('settings.mingwuInsightSummaryPlaceholder')}
                  value={localMingwuInsightSummaryPrompt}
                  onChange={e => setLocalMingwuInsightSummaryPrompt(e.target.value)}
                  className="w-full h-24 resize-none bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-xl text-[13px] text-stone-900 placeholder:text-stone-400 transition-all font-mono leading-relaxed focus:bg-white"
                />
              </section>
            </div>
          )}

          {activeTab === 'data' && (
            <div className="space-y-4">
              {/* Storage Protection card */}
              <section className="baimiao-card-diary p-4 space-y-3">
                <h3 className="text-[12.5px] font-semibold text-stone-400 tracking-wider uppercase flex items-center gap-1.5 mb-1.5">
                  <Shield className="w-4 h-4 text-stone-400" />
                  {t('settings.storageProtection')}
                </h3>
                {storageInfo ? (
                  <div className="space-y-3">
                    <div className={`p-3 rounded-xl border flex items-start gap-2.5 transition-all ${
                      storageInfo.persisted
                        ? "bg-emerald-50/30 border-emerald-100 text-emerald-800"
                        : "bg-amber-50/50 border-amber-100/70 text-amber-800"
                    }`}>
                      {storageInfo.persisted ? (
                        <ShieldCheck className="w-4.5 h-4.5 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <Shield className="w-4.5 h-4.5 text-amber-600 shrink-0 mt-0.5" />
                      )}
                      <div className="flex flex-col">
                        <span className="text-[13px] font-medium leading-normal">
                          {t('settings.storageStatus')}{storageInfo.persisted ? (
                            <span className="text-emerald-700 font-semibold">{t('settings.storagePersisted')}</span>
                          ) : (
                            <span className="text-amber-700 font-semibold">{t('settings.storageTemporary')}</span>
                          )}
                        </span>
                        <span className="text-[11px] text-stone-500 mt-1">
                          {t('settings.storageUsed', { used: formatBytes(storageInfo.usedBytes), quota: formatBytes(storageInfo.quotaBytes) })}
                        </span>
                        {(() => {
                          // Issue #007: 存储压力进度条 + 警告
                          const ratio = storageInfo.quotaBytes > 0
                            ? storageInfo.usedBytes / storageInfo.quotaBytes
                            : 0;
                          const level: PressureLevel = getPressureLevel(ratio);
                          const colorMap: Record<PressureLevel, string> = {
                            ok: 'bg-emerald-500',
                            warning: 'bg-amber-500',
                            critical: 'bg-orange-500',
                            danger: 'bg-rose-500',
                          };
                          const textColorMap: Record<PressureLevel, string> = {
                            ok: 'text-emerald-700',
                            warning: 'text-amber-700',
                            critical: 'text-orange-700',
                            danger: 'text-rose-700',
                          };
                          const pct = Math.round(ratio * 100);
                          return (
                            <div className="mt-2 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-stone-500">已使用</span>
                                <span className={`text-[10px] font-mono font-semibold ${textColorMap[level]}`}>
                                  {pct}%
                                </span>
                              </div>
                              <div className="w-full h-1.5 bg-stone-200 rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${colorMap[level]} transition-all duration-300`}
                                  style={{ width: `${Math.min(100, pct)}%` }}
                                />
                              </div>
                              {(level === 'critical' || level === 'danger') && (
                                <div className={`text-[10.5px] leading-relaxed mt-1.5 ${textColorMap[level]} font-medium`}>
                                  ⚠️ 存储空间紧张，建议立即导出备份（{pct}% ≥ 85%）。
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                    {!storageInfo.persisted && (
                      <button
                        onClick={handlePersist}
                        disabled={isPersisting}
                        className="w-full py-2.5 bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] hover:brightness-110 text-white transition-all rounded-xl text-[13px] font-medium active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm"
                      >
                        {isPersisting ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            {t('settings.activatingStorage')}
                          </>
                        ) : (
                          t('settings.activateStorage')
                        )}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="text-[12px] text-stone-450 py-2">{t('settings.gettingStorage')}</div>
                )}
              </section>

              {/* Issue #008: Auto Backup card */}
              <AutoBackupSection />

              {/* Encrypted Cloud Sync card */}
              <section className="baimiao-card-diary p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase flex items-center gap-1.5">
                    <Cloud className="w-4 h-4 text-stone-400" />
                    {t('settings.cloudSync')}
                  </h3>
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={localSyncEnabled}
                      onChange={(e) => setLocalSyncEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-stone-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-black"></div>
                  </label>
                </div>

                {localSyncEnabled && (
                  <div className="space-y-3 pt-2 border-t border-stone-100 animate-in fade-in duration-200">
                    <div className="space-y-1">
                      <label className="text-[12px] font-medium text-stone-500">{t('settings.cloudProvider')}</label>
                      <select
                        value={localSyncProvider}
                        onChange={(e) => setLocalSyncProvider(e.target.value as any)}
                        className="w-full bg-white border border-black/5 outline-none px-3 py-1.5 rounded-lg text-[13px] text-stone-850 font-mono shadow-sm cursor-pointer focus:border-black focus:ring-1 focus:ring-black"
                      >
                        <option value="webdav">{t('settings.webdavOption')}</option>
                        <option value="onedrive">{t('settings.onedriveOption')}</option>
                        <option value="gdrive">{t('settings.gdriveOption')}</option>
                        <option value="dropbox">{t('settings.dropboxOption')}</option>
                      </select>
                    </div>

                    {localSyncProvider !== 'webdav' && (
                      <div className="space-y-3 pt-1 animate-in fade-in duration-200">
                        {/* OAuth Status Card */}
                        <div className="bg-stone-50 border border-stone-200/60 p-3 rounded-xl flex flex-col gap-2.5 shadow-inner">
                          <div className="flex items-center justify-between">
                            <span className="text-[12px] font-medium text-stone-500">{t('settings.oauthStatus')}</span>
                            {((localSyncProvider === 'onedrive' && settingsStore.syncOneDriveToken) ||
                              (localSyncProvider === 'gdrive' && settingsStore.syncGDriveToken) ||
                              (localSyncProvider === 'dropbox' && settingsStore.syncDropboxToken)) ? (
                              <span className="text-[11.5px] font-semibold text-emerald-600 flex items-center gap-1">
                                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> {t('settings.oauthConnected')}
                              </span>
                            ) : (
                              <span className="text-[11.5px] font-medium text-stone-400">{t('settings.oauthNotAuthorized')}</span>
                            )}
                          </div>

                          {((localSyncProvider === 'onedrive' && settingsStore.syncOneDriveToken) ||
                            (localSyncProvider === 'gdrive' && settingsStore.syncGDriveToken) ||
                            (localSyncProvider === 'dropbox' && settingsStore.syncDropboxToken)) ? (
                            <button
                              type="button"
                              onClick={() => handleOAuthDisconnect(localSyncProvider)}
                              className="w-full bg-stone-100 hover:bg-stone-200 text-stone-700 transition-colors py-2 rounded-lg text-[12px] font-medium active:scale-[0.99]"
                            >
                              {t('settings.oauthDisconnect')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleOAuthAuthorize(localSyncProvider)}
                              className="w-full bg-stone-900 text-white hover:bg-black transition-colors py-2 rounded-lg text-[12px] font-medium active:scale-[0.99] flex items-center justify-center gap-1"
                            >
                              {t('settings.oauthConnect')}
                            </button>
                          )}
                        </div>

                        {/* Client ID Customization */}
                        <div className="space-y-1">
                          <label className="text-[12px] font-medium text-stone-500 flex items-center justify-between">
                            <span>{t('settings.oauthClientId')}</span>
                            <span className="text-[10px] text-stone-400 font-normal">{t('settings.oauthClientIdOptional')}</span>
                          </label>
                          {localSyncProvider === 'onedrive' && (
                            <input
                              type="text"
                              placeholder="e74f3468-f9b8-4903-b054-0dc55034c56e"
                              value={localSyncOneDriveClientId}
                              onChange={(e) => setLocalSyncOneDriveClientId(e.target.value)}
                              className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 rounded-lg text-[13px] text-stone-850 font-mono"
                            />
                          )}
                          {localSyncProvider === 'gdrive' && (
                            <input
                              type="text"
                              placeholder="937286392305-juh5263124874p82g4c4983057v4b518.apps.googleusercontent.com"
                              value={localSyncGDriveClientId}
                              onChange={(e) => setLocalSyncGDriveClientId(e.target.value)}
                              className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 rounded-lg text-[13px] text-stone-850 font-mono"
                            />
                          )}
                          {localSyncProvider === 'dropbox' && (
                            <input
                              type="text"
                              placeholder="3qy6q5w6sc1m22l"
                              value={localSyncDropboxClientId}
                              onChange={(e) => setLocalSyncDropboxClientId(e.target.value)}
                              className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 rounded-lg text-[13px] text-stone-850 font-mono"
                            />
                          )}
                          <p className="text-[10px] text-stone-400 leading-normal mt-0.5">
                            {t('settings.oauthClientIdHint')}
                          </p>
                        </div>
                      </div>
                    )}

                    {localSyncProvider === 'webdav' && (
                      <div className="space-y-3 pt-1 animate-in fade-in duration-200">
                        <div className="space-y-1">
                          <label className="text-[12px] font-medium text-stone-500">{t('settings.serverEndpoint')}</label>
                          <input
                            type="text"
                            placeholder="https://dav.jianguoyun.com/dav/"
                            value={localSyncEndpoint}
                            onChange={(e) => setLocalSyncEndpoint(e.target.value)}
                            className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 rounded-lg text-[13px] text-stone-850 transition-all font-mono"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[12px] font-medium text-stone-500">{t('settings.cloudAccount')}</label>
                            <input
                              type="text"
                              placeholder="Your account"
                              value={localSyncUsername}
                              onChange={(e) => setLocalSyncUsername(e.target.value)}
                              className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 rounded-lg text-[13px] text-stone-850 transition-all font-mono"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[12px] font-medium text-stone-500">{t('settings.appPassword')}</label>
                            <div className="relative">
                              <input
                                type={showSyncPass ? "text" : "password"}
                                placeholder="App Password"
                                value={localSyncPassword}
                                onChange={(e) => setLocalSyncPassword(e.target.value)}
                                className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 pr-8 rounded-lg text-[13px] text-stone-850 transition-all font-mono"
                              />
                              <button
                                type="button"
                                onClick={() => setShowSyncPass(!showSyncPass)}
                                className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-stone-400 hover:text-stone-600 focus:outline-none"
                              >
                                {showSyncPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {localSyncProvider !== 'gdrive' && (
                      <div className="space-y-1">
                        <label className="text-[12px] font-medium text-stone-500">{t('settings.syncDirectory')}</label>
                        <input
                          type="text"
                          placeholder="/baimiaobiji/"
                          value={localSyncDirectory}
                          onChange={(e) => setLocalSyncDirectory(e.target.value)}
                          className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 rounded-lg text-[13px] text-stone-800 transition-all font-mono"
                        />
                      </div>
                    )}

                    <div className="space-y-1 pt-2 border-t border-stone-100">
                      <label className="text-[12px] font-medium text-stone-500 flex items-center gap-1">
                        {t('settings.e2eePassword')}
                      </label>
                      <div className="relative">
                        <input
                          type={showE2eePass ? "text" : "password"}
                          placeholder={t('settings.e2eePlaceholder')}
                          value={localSyncPasswordE2EE}
                          onChange={(e) => setLocalSyncPasswordE2EE(e.target.value)}
                          className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 pr-8 rounded-lg text-[13px] text-stone-850 transition-all font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowE2eePass(!showE2eePass)}
                          className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-stone-400 hover:text-stone-600 focus:outline-none"
                        >
                          {showE2eePass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      <p className="text-[10px] text-stone-400 leading-normal mt-0.5">{t('settings.e2eeHint')}</p>
                      
                      <label className="flex items-start gap-2 cursor-pointer mt-3 bg-stone-50 p-2.5 rounded-lg border border-stone-200/60 transition-colors hover:bg-stone-100/50">
                        <input
                          type="checkbox"
                          checked={localSyncRememberCredentials}
                          onChange={(e) => setLocalSyncRememberCredentials(e.target.checked)}
                          className="w-4 h-4 mt-0.5 rounded border-stone-300 text-stone-900 focus:ring-black accent-black cursor-pointer shrink-0"
                        />
                        <div className="flex flex-col select-none">
                          <span className="text-[12px] font-medium text-stone-800 leading-tight">{t('settings.rememberCredentials')}</span>
                          <span className="text-[10px] text-stone-500 mt-1 leading-tight tracking-wide">
                            <span className="text-amber-600 font-medium">{t('settings.rememberWarning')}</span>
                            {t('settings.rememberWarningDesc')}
                          </span>
                        </div>
                      </label>
                    </div>

                    <div className="pt-2 border-t border-stone-100 flex flex-col gap-2">
                      <div className="flex items-center justify-between text-[11px] text-stone-450 font-medium">
                        <span>{t('settings.syncStatus')}
                          {syncStatus === 'syncing' && <span className="text-blue-500 font-semibold animate-pulse">{t('settings.syncSyncing')}</span>}
                          {syncStatus === 'idle' && <span className="text-emerald-500 font-semibold">{t('settings.syncIdle')}</span>}
                          {syncStatus === 'error' && <span className="text-red-500 font-semibold flex items-center gap-0.5"><CloudLightning className="w-3.5 h-3.5" />{t('settings.syncError')}</span>}
                          {syncStatus === 'disabled' && <span className="text-stone-400">{t('settings.syncDisabled')}</span>}
                        </span>
                        {settingsStore.syncLastTime && (
                          <span className="font-mono">{t('settings.lastSync', { time: new Date(settingsStore.syncLastTime).toLocaleTimeString('zh-CN', { hour12: false }) })}</span>
                        )}
                      </div>
                      {syncStatus === 'error' && syncErrorMessage && (
                        <p className="text-[10px] text-red-500 font-medium leading-tight bg-red-50 p-2 rounded-lg border border-red-100">{syncErrorMessage}</p>
                      )}
                      
                      <button
                        onClick={async () => {
                          settingsStore.setSettings({
                            syncEnabled: localSyncEnabled,
                            syncProvider: localSyncProvider,
                            syncEndpoint: localSyncEndpoint,
                            syncUsername: localSyncUsername,
                            syncPassword: localSyncPassword,
                            syncDirectory: localSyncDirectory,
                            syncPasswordE2EE: localSyncPasswordE2EE,
                            syncOneDriveClientId: localSyncOneDriveClientId,
                            syncGDriveClientId: localSyncGDriveClientId,
                            syncDropboxClientId: localSyncDropboxClientId,
                          });
                          if (localSyncProvider === 'gdrive' && !localSyncGDriveClientId) {
                            setLocalSyncGDriveClientId(SYNC_CONSTANTS.DEFAULT_GDRIVE_CLIENT_ID);
                            await new Promise(r => setTimeout(r, OAUTH_CHECK_INTERVAL_MS)); 
                          }
                          if (localSyncProvider === 'onedrive' && !localSyncOneDriveClientId) {
                            setLocalSyncOneDriveClientId(SYNC_CONSTANTS.DEFAULT_ONEDRIVE_CLIENT_ID);
                            await new Promise(r => setTimeout(r, OAUTH_CHECK_INTERVAL_MS)); 
                          }
                          if (localSyncProvider === 'dropbox' && !localSyncDropboxClientId) {
                            setLocalSyncDropboxClientId(SYNC_CONSTANTS.DEFAULT_DROPBOX_CLIENT_ID);
                            await new Promise(r => setTimeout(r, OAUTH_CHECK_INTERVAL_MS)); 
                          }
                          await new Promise(r => setTimeout(r, OAUTH_CHECK_INTERVAL_MS)); 
                          await syncNow();
                        }}
                        disabled={
                          syncStatus === 'syncing' || 
                          !(
                            (localSyncProvider === 'webdav' && localSyncEndpoint && localSyncUsername && localSyncPassword && localSyncPasswordE2EE) ||
                            (localSyncProvider === 'onedrive' && settingsStore.syncOneDriveToken && localSyncPasswordE2EE) ||
                            (localSyncProvider === 'gdrive' && settingsStore.syncGDriveToken && localSyncPasswordE2EE) ||
                            (localSyncProvider === 'dropbox' && settingsStore.syncDropboxToken && localSyncPasswordE2EE)
                          )
                        }
                        className="w-full mt-1 bg-stone-900 text-white hover:bg-black transition-colors rounded-xl text-[12.5px] font-medium active:scale-[0.98] disabled:opacity-30 disabled:bg-stone-300 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 py-2.5"
                      >
                        {syncStatus === 'syncing' ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            {t('settings.syncInProgress')}
                          </>
                        ) : (
                          t('settings.manualSync')
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* AI Auto-Generation Maintenance section */}
              <section className="baimiao-card-diary p-4 space-y-3">
                <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase mb-1">AI 自动整理维护</h3>
                <p className="text-[12px] text-stone-500 leading-relaxed">
                  如果您多天未打开应用，或者中途生成中断导致日记或回顾不全，可以点击下方按钮扫描过去 30 天并自动补齐生成。
                </p>
                {autoGenTasks.length > 0 ? (
                  <div className="space-y-2 mt-2 bg-stone-50 rounded-xl p-3 border border-stone-100">
                    <div className="flex items-center justify-between text-[12px] font-medium text-stone-600">
                      <span className="flex items-center gap-1.5">
                        <Loader2 className={`w-3.5 h-3.5 ${isQueuePaused ? 'text-stone-400' : 'animate-spin text-stone-900'}`} />
                        {isQueuePaused ? '⏸️ 自动整理已暂停' : '🪄 正在后台自动整理中...'}
                      </span>
                      <span className="bg-stone-200/60 text-stone-700 px-2 py-0.5 rounded-full text-[11px] font-semibold">
                        剩余 {autoGenTasks.length} 项
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        onClick={() => setQueuePaused(!isQueuePaused)}
                        className="py-2 px-3 baimiao-btn-cream transition-colors rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1"
                      >
                        {isQueuePaused ? '▶️ 恢复整理' : '⏸️ 暂停整理'}
                      </button>
                      <button
                        onClick={() => clearQueue()}
                        className="py-2 px-3 bg-red-50 hover:bg-red-100 transition-colors rounded-lg text-[12px] font-semibold text-red-600 border border-red-100 flex items-center justify-center gap-1"
                      >
                        🛑 停止并清空
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={async () => {
                      await checkAndGenerateHistoryTasks(30);
                    }}
                    className="w-full mt-1 bg-baimiao-mysteria/[0.03] hover:bg-baimiao-mysteria/[0.06] border border-baimiao-mysteria/10 hover:border-baimiao-mysteria/20 text-baimiao-mysteria transition-colors rounded-xl text-[12.5px] font-medium active:scale-[0.98] flex items-center justify-center gap-1.5 py-2.5"
                  >
                    🪄 扫描并补全过去 30 天的日记与回顾
                  </button>
                )}
              </section>

              {/* Data Export / Import section */}
              <section className="baimiao-card-diary p-4 space-y-4">
                 <div>
                   <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase mb-3">{t('settings.dataExport')}</h3>
                 
                 <div className="space-y-4">
                    {/* Data type selection */}
                    <div className="space-y-2.5">
                      <label className="flex items-start gap-3">
                         <input 
                           type="checkbox" 
                           checked={exportOptions.logs}
                           onChange={e => setExportOptions(prev => ({ ...prev, logs: e.target.checked }))}
                           className="w-4 h-4 mt-0.5 rounded border-stone-300 text-stone-900 focus:ring-black accent-black cursor-pointer" 
                         />
                         <div className="flex flex-col cursor-pointer select-none">
                            <span className="text-[14px] text-stone-800 font-medium leading-none">{t('settings.exportLogs')}</span>
                            <span className="text-[12px] text-stone-400 mt-1">{t('settings.exportLogsDesc')}</span>
                         </div>
                      </label>
                      <label className="flex items-start gap-3 pt-2.5 border-t border-stone-50">
                         <input 
                           type="checkbox" 
                           checked={exportOptions.diaries}
                           onChange={e => setExportOptions(prev => ({ ...prev, diaries: e.target.checked }))}
                           className="w-4 h-4 mt-0.5 rounded border-stone-300 text-stone-900 focus:ring-black accent-black cursor-pointer" 
                         />
                         <div className="flex flex-col cursor-pointer select-none">
                            <span className="text-[14px] text-stone-800 font-medium leading-none">{t('settings.exportDiaries')}</span>
                            <span className="text-[12px] text-stone-400 mt-1">{t('settings.exportDiariesDesc')}</span>
                         </div>
                      </label>
                      <label className="flex items-start gap-3 pt-2.5 border-t border-stone-50">
                         <input 
                           type="checkbox" 
                           checked={exportOptions.insights}
                           onChange={e => setExportOptions(prev => ({ ...prev, insights: e.target.checked }))}
                           className="w-4 h-4 mt-0.5 rounded border-stone-300 text-stone-900 focus:ring-black accent-black cursor-pointer" 
                         />
                         <div className="flex flex-col cursor-pointer select-none">
                            <span className="text-[14px] text-stone-800 font-medium leading-none">{t('settings.exportInsights')}</span>
                            <span className="text-[12px] text-stone-400 mt-1">{t('settings.exportInsightsDesc')}</span>
                         </div>
                      </label>
                       <label className="flex items-start gap-3 pt-2.5 border-t border-stone-50">
                          <input 
                            type="checkbox" 
                            checked={exportOptions.embeddings}
                            onChange={e => setExportOptions(prev => ({ ...prev, embeddings: e.target.checked }))}
                            className="w-4 h-4 mt-0.5 rounded border-stone-300 text-stone-900 focus:ring-black accent-black cursor-pointer" 
                          />
                          <div className="flex flex-col cursor-pointer select-none">
                             <span className="text-[14px] text-stone-800 font-medium leading-none">{t('settings.exportEmbeddings')}</span>
                             <span className="text-[12px] text-stone-400 mt-1">{t('settings.exportEmbeddingsDesc')}</span>
                          </div>
                       </label>
                    </div>

                    {/* Date range selection */}
                    <div className="pt-3 border-t border-stone-100">
                      <h4 className="text-[12px] font-medium text-stone-500 mb-2">{t('settings.exportDateRange')}</h4>
                      <div className="flex gap-2">
                        <button 
                           onClick={() => setExportDateRange('all')}
                           className={`flex-1 py-1.5 text-[13px] rounded-lg border transition-all ${exportDateRange === 'all' ? 'bg-stone-100 border-stone-200 text-black font-medium shadow-[inset_0_1px_3px_rgb(0_0_0_/_0.02)]' : 'bg-white border-stone-100/50 text-stone-500 hover:bg-stone-50'}`}
                        >
                          {t('settings.exportAll')}
                        </button>
                        <button
                           onClick={() => setExportDateRange('custom')}
                           className={`flex-1 py-1.5 text-[13px] rounded-lg border transition-all ${exportDateRange === 'custom' ? 'bg-stone-100 border-stone-200 text-black font-medium shadow-[inset_0_1px_3px_rgb(0_0_0_/_0.02)]' : 'bg-white border-stone-100/50 text-stone-500 hover:bg-stone-50'}`}
                        >
                          {t('settings.exportCustom')}
                        </button>
                      </div>
                      
                      {exportDateRange === 'custom' && (
                        <div className="flex items-center justify-center gap-2 mt-3 py-2 overflow-visible">
                          <DatePickerPopover
                            value={exportStartDate}
                            onChange={setExportStartDate}
                            placeholder={t('settings.startDate')}
                            align="left"
                          />
                          <span className="text-stone-400 text-[12px] font-mono shrink-0">-</span>
                          <DatePickerPopover
                            value={exportEndDate}
                            onChange={setExportEndDate}
                            placeholder={t('settings.endDate')}
                            align="right"
                          />
                        </div>
                      )}
                    </div>
                 </div>
                 
                 <button 
                   onClick={handleExport}
                   disabled={!exportOptions.logs && !exportOptions.diaries && !exportOptions.insights && !exportOptions.embeddings}
                   className="w-full mt-4 flex items-center justify-center gap-2 bg-stone-100 text-stone-800 py-3 rounded-xl text-[13px] font-medium hover:bg-stone-200 transition-colors disabled:opacity-30 disabled:hover:bg-stone-100 active:scale-[0.98]"
                 >
                   <FileDown className="w-4 h-4" />
                   {t('settings.exportJson')}
                 </button>
               </div>

               <div className="pt-4 border-t border-stone-100">
                 <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase">{t('settings.dataImport')}</h3>
                 </div>
                 <p className="text-[12px] text-stone-500 mb-4 leading-relaxed">
                   {t('settings.importDesc')}
                 </p>
                 <input 
                   type="file" 
                   accept=".json"
                   ref={fileInputRef}
                   onChange={handleImport}
                   className="hidden"
                   id="import-file"
                 />
                 <label
                   htmlFor="import-file"
                   className="w-full flex items-center justify-center gap-2 bg-white border border-stone-200 text-stone-700 py-3 rounded-xl text-[13px] font-medium hover:bg-stone-50 hover:border-stone-300 cursor-pointer transition-all shadow-[0_1px_2px_rgb(0_0_0_/_0.02)] active:scale-[0.98]"
                 >
                   <Upload className="w-4 h-4" />
                   {t('settings.selectFileImport')}
                 </label>
               </div>

               {/* V2 迁移备份下载 */}
               <div className="pt-4 border-t border-stone-100">
                 <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase">{t('settings.v2Backup')}</h3>
                 </div>
                 <p className="text-[12px] text-stone-500 mb-4 leading-relaxed">
                   {t('settings.v2BackupDesc')}
                 </p>
                 <button
                   onClick={handleDownloadMigrationBackup}
                   className="w-full flex items-center justify-center gap-2 bg-stone-100 text-stone-800 py-3 rounded-xl text-[13px] font-medium hover:bg-stone-200 transition-colors active:scale-[0.98]"
                 >
                   <FileDown className="w-4 h-4" />
                   {t('settings.downloadV2Backup')}
                 </button>
               </div>
              </section>

              {/* 统一数据管理 (#13) */}
              <section className="baimiao-card-diary p-4 space-y-4">
                <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase flex items-center gap-1.5">
                  <FileJson className="w-4 h-4 text-stone-400" />
                  {t('settings.unifiedDataManagement')}
                </h3>

                {/* 导出面板 */}
                <div className="space-y-3">
                  <h4 className="text-[13px] font-medium text-stone-700">{t('settings.exportData')}</h4>

                  {/* 时间范围 */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] text-stone-500">{t('settings.timeRange')}</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="date"
                        data-testid="export-start-date"
                        value={unifiedExportStartDate}
                        onChange={(e) => setUnifiedExportStartDate(e.target.value)}
                        className="flex-1 min-w-0 bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-2.5 py-1.5 rounded-lg text-[12px] text-stone-900 transition-all font-mono"
                      />
                      <span className="text-stone-400 text-[12px] font-mono shrink-0">-</span>
                      <input
                        type="date"
                        data-testid="export-end-date"
                        value={unifiedExportEndDate}
                        onChange={(e) => setUnifiedExportEndDate(e.target.value)}
                        className="flex-1 min-w-0 bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-2.5 py-1.5 rounded-lg text-[12px] text-stone-900 transition-all font-mono"
                      />
                    </div>
                  </div>

                  {/* 数据类型多选 chip */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] text-stone-500">{t('settings.dataTypes')}</label>
                    <div className="flex flex-wrap gap-2">
                      {DATA_TYPE_OPTIONS.map((opt) => {
                        const selected = unifiedExportTypes.has(opt.id);
                        return (
                          <button
                            key={opt.id}
                            data-testid={`export-type-chip-${opt.id}`}
                            onClick={() => {
                              setUnifiedExportTypes((prev) => {
                                const next = new Set(prev);
                                if (next.has(opt.id)) next.delete(opt.id);
                                else next.add(opt.id);
                                return next;
                              });
                            }}
                            className={cn(
                              'px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all active:scale-[0.97]',
                              selected
                                ? 'bg-baimiao-mysteria/5 border-baimiao-mysteria/20 text-baimiao-mysteria'
                                : 'bg-stone-50 border-stone-200/60 text-stone-400 hover:text-stone-600'
                            )}
                          >
                            {t(opt.labelKey)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 格式单选 */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] text-stone-500">{t('settings.exportFormat')}</label>
                    <div className="flex gap-2">
                      <button
                        data-testid="export-format-json"
                        onClick={() => setUnifiedExportFormat('json')}
                        className={cn(
                          'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-medium border transition-all active:scale-[0.98]',
                          unifiedExportFormat === 'json'
                            ? 'bg-stone-100 border-stone-200 text-stone-900 shadow-sm'
                            : 'bg-white border-stone-100/50 text-stone-500 hover:bg-stone-50'
                        )}
                      >
                        <FileJson className="w-3.5 h-3.5" />
                        JSON
                      </button>
                      <button
                        data-testid="export-format-markdown"
                        onClick={() => setUnifiedExportFormat('markdown')}
                        className={cn(
                          'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-medium border transition-all active:scale-[0.98]',
                          unifiedExportFormat === 'markdown'
                            ? 'bg-stone-100 border-stone-200 text-stone-900 shadow-sm'
                            : 'bg-white border-stone-100/50 text-stone-500 hover:bg-stone-50'
                        )}
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Markdown
                      </button>
                    </div>
                  </div>

                  <button
                    data-testid="export-btn"
                    onClick={handleUnifiedExport}
                    disabled={unifiedExportTypes.size === 0 || isUnifiedExporting}
                    className="w-full flex items-center justify-center gap-2 bg-stone-100 text-stone-800 py-2.5 rounded-xl text-[13px] font-medium hover:bg-stone-200 transition-colors disabled:opacity-30 disabled:hover:bg-stone-100 active:scale-[0.98]"
                  >
                    {isUnifiedExporting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    {t('settings.exportDataFormat', { format: unifiedExportFormat === 'json' ? 'JSON' : 'Markdown' })}
                  </button>
                </div>

                {/* 导入面板 */}
                <div className="space-y-3 pt-4 border-t border-stone-100">
                  <h4 className="text-[13px] font-medium text-stone-700">{t('settings.importData')}</h4>

                  {/* 文件选择 */}
                  <div className="space-y-1.5">
                    <input
                      type="file"
                      accept=".json"
                      data-testid="import-file-input"
                      ref={unifiedImportFileRef}
                      onChange={handleUnifiedFileSelect}
                      className="hidden"
                    />
                    <button
                      onClick={() => unifiedImportFileRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 bg-white border border-stone-200 text-stone-700 py-2.5 rounded-xl text-[13px] font-medium hover:bg-stone-50 hover:border-stone-300 cursor-pointer transition-all shadow-sm active:scale-[0.98]"
                    >
                      <Upload className="w-4 h-4" />
                      {unifiedImportFile ? unifiedImportFile.name : t('settings.selectJsonFile')}
                    </button>
                  </div>

                  {/* 冲突策略 */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] text-stone-500">{t('settings.conflictStrategy')}</label>
                    <div className="flex gap-2">
                      <button
                        data-testid="import-strategy-overwrite"
                        onClick={() => setUnifiedImportStrategy('overwrite')}
                        className={cn(
                          'flex-1 py-2 rounded-lg text-[12px] font-medium border transition-all active:scale-[0.98]',
                          unifiedImportStrategy === 'overwrite'
                            ? 'bg-stone-100 border-stone-200 text-stone-900 shadow-sm'
                            : 'bg-white border-stone-100/50 text-stone-500 hover:bg-stone-50'
                        )}
                      >
                        {t('strategy.overwrite')}
                      </button>
                      <button
                        data-testid="import-strategy-skip"
                        onClick={() => setUnifiedImportStrategy('skip')}
                        className={cn(
                          'flex-1 py-2 rounded-lg text-[12px] font-medium border transition-all active:scale-[0.98]',
                          unifiedImportStrategy === 'skip'
                            ? 'bg-stone-100 border-stone-200 text-stone-900 shadow-sm'
                            : 'bg-white border-stone-100/50 text-stone-500 hover:bg-stone-50'
                        )}
                      >
                        {t('strategy.skip')}
                      </button>
                    </div>
                  </div>

                  <button
                    data-testid="import-btn"
                    onClick={handleUnifiedImport}
                    disabled={!unifiedImportFile || isUnifiedImporting}
                    className="w-full flex items-center justify-center gap-2 bg-stone-900 text-white py-2.5 rounded-xl text-[13px] font-medium hover:bg-black transition-colors disabled:opacity-30 disabled:bg-stone-300 disabled:cursor-not-allowed active:scale-[0.98]"
                  >
                    {isUnifiedImporting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    {t('settings.importBtn')}
                  </button>

                  {unifiedImportResult && (
                    <div data-testid="import-result" className="space-y-1.5 p-3 rounded-xl bg-stone-50 border border-stone-100">
                      <div className="flex justify-between text-[12px]">
                        <span className="text-emerald-600 font-medium">{t('settings.imported', { count: unifiedImportResult.imported })}</span>
                        <span className="text-stone-500">{t('settings.skipped', { count: unifiedImportResult.skipped })}</span>
                      </div>
                      {unifiedImportResult.errors.length > 0 && (
                        <div className="text-[11px] text-rose-500 leading-relaxed">
                          {unifiedImportResult.errors.slice(0, 5).map((err, i) => (
                            <div key={i}>{err}</div>
                          ))}
                          {unifiedImportResult.errors.length > 5 && (
                            <div>{t('settings.errorsCount', { count: unifiedImportResult.errors.length })}</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 聊天记录单独导入/导出 */}
                <div className="space-y-3 pt-4 border-t border-stone-100">
                  <h4 className="text-[13px] font-medium text-stone-700 flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-stone-400" />
                    {t('settings.chatRecords')}
                  </h4>

                  <div className="flex gap-2">
                    <button
                      data-testid="conversation-export-json"
                      onClick={() => handleConvExport('json')}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-stone-100 text-stone-800 py-2 rounded-lg text-[12px] font-medium hover:bg-stone-200 transition-colors active:scale-[0.98]"
                    >
                      <FileJson className="w-3.5 h-3.5" />
                      {t('settings.exportJsonBtn')}
                    </button>
                    <button
                      data-testid="conversation-export-md"
                      onClick={() => handleConvExport('markdown')}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-stone-100 text-stone-800 py-2 rounded-lg text-[12px] font-medium hover:bg-stone-200 transition-colors active:scale-[0.98]"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      {t('settings.exportMdBtn')}
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <input
                      type="file"
                      accept=".json"
                      data-testid="conversation-import-file-input"
                      ref={convImportFileRef}
                      onChange={handleConvFileSelect}
                      className="hidden"
                    />
                    <button
                      onClick={() => convImportFileRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 bg-white border border-stone-200 text-stone-700 py-2 rounded-lg text-[12px] font-medium hover:bg-stone-50 hover:border-stone-300 cursor-pointer transition-all shadow-sm active:scale-[0.98]"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      {convImportFile ? convImportFile.name : t('settings.selectConvFile')}
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <button
                      data-testid="conversation-strategy-overwrite"
                      onClick={() => setConvImportStrategy('overwrite')}
                      className={cn(
                        'flex-1 py-1.5 rounded-lg text-[11px] font-medium border transition-all',
                        convImportStrategy === 'overwrite'
                          ? 'bg-stone-100 border-stone-200 text-stone-900'
                          : 'bg-white border-stone-100/50 text-stone-500'
                      )}
                    >
                      {t('strategy.overwrite')}
                    </button>
                    <button
                      data-testid="conversation-strategy-skip"
                      onClick={() => setConvImportStrategy('skip')}
                      className={cn(
                        'flex-1 py-1.5 rounded-lg text-[11px] font-medium border transition-all',
                        convImportStrategy === 'skip'
                          ? 'bg-stone-100 border-stone-200 text-stone-900'
                          : 'bg-white border-stone-100/50 text-stone-500'
                      )}
                    >
                      {t('strategy.skip')}
                    </button>
                  </div>

                  <button
                    data-testid="conversation-import-btn"
                    onClick={handleConvImport}
                    disabled={!convImportFile || isConvImporting}
                    className="w-full flex items-center justify-center gap-2 bg-stone-900 text-white py-2 rounded-lg text-[12px] font-medium hover:bg-black transition-colors disabled:opacity-30 disabled:bg-stone-300 active:scale-[0.98]"
                  >
                    {isConvImporting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" />
                    )}
                    {t('settings.importConvBtn')}
                  </button>

                  {convImportResult && (
                    <div data-testid="conversation-import-result" className="space-y-1 p-2.5 rounded-xl bg-stone-50 border border-stone-100">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-emerald-600 font-medium">{t('settings.imported', { count: convImportResult.imported })}</span>
                        <span className="text-stone-500">{t('settings.skipped', { count: convImportResult.skipped })}</span>
                      </div>
                      {convImportResult.errors.length > 0 && (
                        <div className="text-[10px] text-rose-500 leading-relaxed">
                          {convImportResult.errors.slice(0, 3).map((err, i) => (
                            <div key={i}>{err}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {activeTab === 'tags' && (
            <TagManagement embedded />
          )}

          {activeTab === 'transcription' && (
            <TranscriptionFilterPanel />
          )}

          {activeTab === 'about' && (
            <section className="baimiao-card-diary p-6 flex flex-col items-center text-center select-none">
              <div className="w-14 h-14 bg-gradient-to-br from-baimiao-mysteria to-[#2c2957] text-white rounded-2xl flex items-center justify-center font-bold text-xl mb-4 shadow-md">
                {t('app.logo')}
              </div>
              <h3 className="text-[17px] font-semibold text-stone-900 mb-1">{t('app.title')}</h3>
              <p className="text-[11px] text-stone-400 font-mono mb-5">{t('app.version')}</p>

              <ErrorInspector />

              <div className="space-y-2 mb-6 text-center w-full text-stone-600 text-[13px] border-t border-b border-stone-200/40 py-4 flex flex-col items-center justify-center">
                <span className="text-stone-400 text-[11px] uppercase tracking-wider">{t('app.authorLabel')}</span>
                <span className="font-semibold text-stone-900 text-[14px]">{t('app.author')}</span>
                <p className="text-[12px] text-stone-500 leading-relaxed mt-2.5 pt-2.5 border-t border-stone-200/20 w-full text-center">
                  {t('app.tagline')}
                </p>
              </div>

              <div className="flex flex-col gap-2 w-full">
                <button
                  onClick={handleForceUpdate}
                  disabled={isUpdating}
                  className={`w-full py-2.5 bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white hover:brightness-110 transition-all rounded-xl text-[13px] font-medium tracking-wide shadow-sm flex items-center justify-center gap-1.5 ${
                    isUpdating ? 'opacity-80 cursor-wait' : ''
                  }`}
                >
                  {isUpdating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t('about.checking')}
                    </>
                  ) : (
                    t('about.checkUpdate')
                  )}
                </button>
                <a
                  href="https://github.com/haotianliangye/baimiaobiji/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => isUpdating && e.preventDefault()}
                  className={`w-full py-2 bg-stone-200/30 hover:bg-stone-200/60 text-stone-600 transition-colors rounded-xl text-[13px] font-medium flex items-center justify-center ${
                    isUpdating ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''
                  }`}
                >
                  {t('about.feedback')}
                </a>
              </div>
            </section>
          )}
        </motion.div>
        </AnimatePresence>

        </div>

        <div className="shrink-0 px-3 py-3 border-t border-baimiao-border/30 bg-white">
          <button
            onClick={() => {
              setSettings({
                // #5: 保留旧 diaryPrompts 供 Copilot 兼容（只含日记槽位内容）
                diaryPrompts: [localReviewPrompts[0], '', '', ''],
                diaryPromptIndex: 0,
                diaryPrompt: localReviewPrompts[0],
                // #5: 统一 5 槽 reviewPrompts + 名称 + 选中状态
                reviewPrompts: localReviewPrompts,
                reviewPromptNames: localReviewPromptNames,
                reviewSelectedIndices: localReviewSelectedIndices,
                reviewPromptIndex: localReviewIndex,
                reviewPrompt: localReviewPrompts[localReviewIndex],
                // #008: 合并后字段（store setSettings 会反向同步旧 insightPrompts/mingwuPrompts/summary 等只读兼容字段）
                mingwuInsightPrompts: localMingwuInsightPrompts,
                mingwuInsightPromptNames: localMingwuInsightPromptNames,
                mingwuInsightSelectedIndices: localMingwuInsightSelectedIndices,
                mingwuInsightPromptIndex: localMingwuInsightIndex,
                mingwuInsightPrompt: localMingwuInsightPrompts[localMingwuInsightIndex],
                diaryReviewSummaryPrompt: localDiaryReviewSummaryPrompt,
                mingwuInsightSummaryPrompt: localMingwuInsightSummaryPrompt,
                syncEnabled: localSyncEnabled,
                syncProvider: localSyncProvider,
                syncEndpoint: localSyncEndpoint,
                syncUsername: localSyncUsername,
                syncPassword: localSyncPassword,
                syncDirectory: localSyncDirectory,
                syncPasswordE2EE: localSyncPasswordE2EE,
                syncRememberCredentials: localSyncRememberCredentials,
                syncOneDriveClientId: localSyncOneDriveClientId,
                syncGDriveClientId: localSyncGDriveClientId,
                syncDropboxClientId: localSyncDropboxClientId
              });
              navigate(-1);
            }}
            className="w-full py-3.5 rounded-xl text-[14px] font-medium tracking-wide text-white bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] hover:brightness-110 active:scale-[0.98] shadow-md shadow-baimiao-mysteria/10 transition-all"
          >
             {t('settings.saveAndBack')}
          </button>
        </div>

        </div>
      )}

      {/* #009-ext: TTS 语音选择 Modal（仅外部 TTS + 已选 Provider 时可用） */}
      {ttsVoiceModalOpen && (ttsProvider === 'gemini' || ttsProvider === 'volcengine') && (
        <TtsVoicePickerModal
          provider={ttsProvider}
          value={ttsVoice}
          onSelect={(id) => setSettings({ ttsVoice: id })}
          onClose={() => setTtsVoiceModalOpen(false)}
          labelKey="settings.ttsVoiceModalTitle"
          placeholderKey="settings.ttsVoicePlaceholder"
          searchPlaceholderKey="settings.ttsVoiceSearch"
          emptyKey="settings.ttsVoiceEmpty"
          customKey="settings.ttsVoiceCustom"
          customHintKey="settings.ttsVoiceCustomHint"
        />
      )}
    </div>
  );
}

