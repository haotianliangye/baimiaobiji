/**
 * #4 全局标签系统 -- 标签管理页（/tags 路由）。
 * 树形展示所有标签，支持重命名（级联更新）、合并（建立别名）、删除（解除关联）。
 */
import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, ChevronDown, Tags as TagsIcon, Edit2, GitMerge, Trash2, X, Plus, Hash } from 'lucide-react';
import { db } from '../db/db';
import { useTagsStore } from '../store/tags.store';
import { buildTagTree, normalizeTagPath, type TreeNode } from '../lib/tags';
import { cn } from '../lib/utils';
import { useTranslation } from '../lib/i18n';

export default function TagManagement({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const allTags = useLiveQuery(() => db.tags.toArray(), []);
  const { aliases, refreshAliases, renameTag, mergeTags, deleteTag, createTag } = useTagsStore();

  useEffect(() => {
    refreshAliases();
  }, [refreshAliases]);

  const tree = useMemo(() => {
    if (!allTags) return { path: '', name: '', children: [] } as TreeNode;
    return buildTagTree(allTags.map(t => t.path));
  }, [allTags]);

  // 展开状态：默认全部展开
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (allTags) {
      const allPaths = new Set<string>();
      const collect = (node: TreeNode) => {
        if (node.path) allPaths.add(node.path);
        node.children.forEach(collect);
      };
      collect(tree);
      setExpandedPaths(allPaths);
    }
  }, [allTags]);

  const toggleExpand = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // 重命名弹窗
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // 合并弹窗
  const [mergingPath, setMergingPath] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');

  // 删除确认
  const [deletingPath, setDeletingPath] = useState<string | null>(null);

  // 新建标签
  const [newTagPath, setNewTagPath] = useState('');

  const handleRename = async () => {
    if (!renamingPath || !renameValue.trim()) return;
    await renameTag(renamingPath, renameValue.trim());
    setRenamingPath(null);
    setRenameValue('');
  };

  const handleMerge = async () => {
    if (!mergingPath || !mergeTarget.trim()) return;
    await mergeTags(mergingPath, mergeTarget.trim());
    setMergingPath(null);
    setMergeTarget('');
  };

  const handleDelete = async () => {
    if (!deletingPath) return;
    await deleteTag(deletingPath);
    setDeletingPath(null);
  };

  const handleCreate = async () => {
    if (!newTagPath.trim()) return;
    const normalized = normalizeTagPath(newTagPath);
    await createTag(normalized);
    setNewTagPath('');
  };

  const tagCount = allTags?.length ?? 0;

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Header -- 嵌入 Settings 时隐藏（Seam 2） */}
      {!embedded && (
      <div className="flex h-[52px] items-center px-4 bg-[#faf9fc]/85 backdrop-blur border-b border-baimiao-border/40 z-20 shrink-0 w-full justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="p-1 -ml-1 hover:bg-stone-200/50 rounded-full transition-colors text-stone-500 hover:text-stone-800"
            aria-label={t('settings.back')}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-[13.5px] font-bold tracking-wide text-baimiao-mysteria flex items-center gap-1.5 font-serif baimiao-editorial-title">
            <TagsIcon className="w-4 h-4 text-baimiao-mysteria/70 shrink-0" />
            {t('tags.title')}
          </h2>
        </div>
        <span className="text-[11px] font-medium text-stone-500 bg-stone-100/80 px-2 py-1 rounded-full">
          {t('tags.count', { count: tagCount })}
        </span>
      </div>
      )}

      {/* 新建标签 */}
      <div className="px-4 py-3 border-b border-baimiao-border/30 shrink-0 bg-white/50">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center bg-white rounded-xl border border-stone-200/60 px-3 py-2 focus-within:border-baimiao-mysteria/40 transition-colors">
            <Hash className="w-3.5 h-3.5 text-stone-400 shrink-0 mr-1.5" />
            <input
              type="text"
              value={newTagPath}
              onChange={e => setNewTagPath(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
              placeholder={t('tags.newTagPlaceholder')}
              className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-stone-400 min-w-0"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={!newTagPath.trim()}
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white hover:brightness-110 active:scale-95 transition-all disabled:opacity-30 disabled:scale-100"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 标签树 -- 局部滚动，移动端红线 */}
      <div className="flex-1 overflow-y-auto thin-scrollbar overscroll-none px-4 py-3 pb-6">
        {tagCount === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-stone-400 select-none">
            <TagsIcon className="w-8 h-8 mb-3 text-stone-300" />
            <p className="text-[13px] font-medium">{t('tags.noTagsTitle')}</p>
            <p className="text-[11px] mt-1 text-stone-400">{t('tags.emptyHint')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {tree.children.map(node => (
              <TagNode
                key={node.path}
                node={node}
                depth={0}
                expandedPaths={expandedPaths}
                toggleExpand={toggleExpand}
                onRename={(path) => { setRenamingPath(path); setRenameValue(path); }}
                onMerge={(path) => { setMergingPath(path); setMergeTarget(''); }}
                onDelete={(path) => setDeletingPath(path)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 重命名弹窗 */}
      {renamingPath && (
        <ModalOverlay onClose={() => setRenamingPath(null)} title={t('tags.renameTitle')}>
          <p className="text-[12px] text-stone-500 mb-3">
            {t('tags.renameDesc')}
          </p>
          <input
            type="text"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleRename(); }}
            className="w-full bg-white rounded-xl border border-stone-200 px-3 py-2.5 text-[14px] outline-none focus:border-baimiao-mysteria/40 transition-colors mb-4"
            autoFocus
          />
          <ModalActions
            onCancel={() => setRenamingPath(null)}
            onConfirm={handleRename}
            confirmText={t('tags.rename')}
            disabled={!renameValue.trim() || renameValue.trim() === renamingPath}
          />
        </ModalOverlay>
      )}

      {/* 合并弹窗 */}
      {mergingPath && (
        <ModalOverlay onClose={() => setMergingPath(null)} title={t('tags.mergeTitleWith', { path: mergingPath })}>
          <p className="text-[12px] text-stone-500 mb-3">
            {t('tags.mergeDesc', { path: mergingPath })}
          </p>
          <input
            type="text"
            value={mergeTarget}
            onChange={e => setMergeTarget(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleMerge(); }}
            placeholder={t('tags.mergePlaceholder')}
            className="w-full bg-white rounded-xl border border-stone-200 px-3 py-2.5 text-[14px] outline-none focus:border-baimiao-mysteria/40 transition-colors mb-4"
            autoFocus
          />
          <ModalActions
            onCancel={() => setMergingPath(null)}
            onConfirm={handleMerge}
            confirmText={t('tags.merge')}
            disabled={!mergeTarget.trim() || mergeTarget.trim() === mergingPath}
          />
        </ModalOverlay>
      )}

      {/* 删除确认弹窗 */}
      {deletingPath && (
        <ModalOverlay onClose={() => setDeletingPath(null)} title={t('tags.delete')}>
          <p className="text-[13px] text-stone-600 leading-relaxed mb-4">
            {t('tags.deleteDesc', { path: deletingPath })}
            <br />
            <span className="text-[12px] text-stone-400">{t('tags.deleteNote')}</span>
          </p>
          <ModalActions
            onCancel={() => setDeletingPath(null)}
            onConfirm={handleDelete}
            confirmText={t('tags.confirmDeleteBtn')}
            danger
          />
        </ModalOverlay>
      )}
    </div>
  );
}

/** 递归渲染标签树节点。 */
function TagNode({
  node,
  depth,
  expandedPaths,
  toggleExpand,
  onRename,
  onMerge,
  onDelete,
}: {
  node: TreeNode;
  depth: number;
  expandedPaths: Set<string>;
  toggleExpand: (path: string) => void;
  onRename: (path: string) => void;
  onMerge: (path: string) => void;
  onDelete: (path: string) => void;
}) {
  const { t } = useTranslation();
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedPaths.has(node.path);

  return (
    <div>
      <div
        data-testid={`tag-node-${node.path}`}
        className={cn(
          "flex items-center gap-1.5 py-1.5 pr-2 rounded-lg hover:bg-stone-100/60 group transition-colors",
        )}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => toggleExpand(node.path)}
            className="shrink-0 p-0.5 text-stone-400 hover:text-stone-700 transition-colors"
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span className="shrink-0 w-[22px] flex justify-center">
            <span className="w-1.5 h-1.5 rounded-full bg-stone-300" />
          </span>
        )}
        <Hash className="w-3 h-3 text-baimiao-mysteria/50 shrink-0" />
        <span className="flex-1 text-[13.5px] text-stone-700 truncate select-none">
          {node.name}
        </span>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            data-testid="tag-rename-btn"
            onClick={() => onRename(node.path)}
            className="p-1.5 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 transition-colors"
            title={t('tags.rename')}
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            data-testid="tag-merge-btn"
            onClick={() => onMerge(node.path)}
            className="p-1.5 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 transition-colors"
            title={t('tags.mergeToOther')}
          >
            <GitMerge className="w-3.5 h-3.5" />
          </button>
          <button
            data-testid="tag-delete-btn"
            onClick={() => onDelete(node.path)}
            className="p-1.5 rounded-md text-stone-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
            title={t('tags.delete')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {hasChildren && isExpanded && (
        <div>
          {node.children.map(child => (
            <TagNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              toggleExpand={toggleExpand}
              onRename={onRename}
              onMerge={onMerge}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 弹窗遮罩 */
function ModalOverlay({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div
      className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-[320px] p-5 shadow-2xl border border-stone-100 animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-semibold text-stone-900">{title}</h3>
          <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 弹窗底部按钮组 */
function ModalActions({
  onCancel,
  onConfirm,
  confirmText,
  disabled,
  danger,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmText: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2 justify-end">
      <button
        onClick={onCancel}
        className="px-4 py-2 rounded-xl text-[13px] font-medium text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors"
      >
        {t('review.cancel')}
      </button>
      <button
        data-testid="modal-confirm-btn"
        onClick={onConfirm}
        disabled={disabled}
        className={cn(
          "px-4 py-2 rounded-xl text-[13px] font-medium text-white transition-all active:scale-95 disabled:opacity-40 disabled:scale-100",
          danger
            ? "bg-gradient-to-r from-rose-500 to-rose-600 hover:brightness-110"
            : "bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] hover:brightness-110"
        )}
      >
        {confirmText}
      </button>
    </div>
  );
}
