/**
 * task-112: 设置抽屉「所有标签」树形列表 + 快捷操作菜单。
 * 支持展开/收起子标签、置顶、编辑名称和图标、仅移除标签、删除标签和笔记。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, ChevronUp, Hash, MoreVertical, Pin, Pencil, Unlink, Trash2, X } from 'lucide-react';
import { db } from '../db/db';
import { useTagsStore } from '../store/tags.store';
import { buildTagTree, normalizeTagPath, type TreeNode } from '../lib/tags';
import { useTranslation } from '../lib/i18n';
import { cn } from '../lib/utils';

interface MenuState {
  path: string;
  buttonEl: HTMLElement;
}

export default function DrawerTagList() {
  const { t } = useTranslation();
  const rawTags = useLiveQuery(() => db.tags.toArray(), []);
  const { pinTag, unpinTag, updateTag, removeTagOnly, deleteTagAndNotes } = useTagsStore();

  const sortedTags = useMemo(() => {
    if (!rawTags) return [];
    return [...rawTags].sort((a, b) => {
      const sa = a.sort_order ?? (a.created_at + 1_000_000_000);
      const sb = b.sort_order ?? (b.created_at + 1_000_000_000);
      return sa - sb;
    });
  }, [rawTags]);

  const tree = useMemo(() => {
    if (!sortedTags.length) return { path: '', name: '', children: [] } as TreeNode;
    return buildTagTree(sortedTags.map(t => t.path));
  }, [sortedTags]);

  // 树展开状态：默认全部展开
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (rawTags) {
      const allPaths = new Set<string>();
      const collect = (node: TreeNode) => {
        if (node.path) allPaths.add(node.path);
        node.children.forEach(collect);
      };
      collect(tree);
      setExpandedPaths(prev => {
        const next = new Set(prev);
        allPaths.forEach(p => next.add(p));
        return next;
      });
    }
  }, [rawTags, tree]);

  const toggleExpand = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // 标记：用户已与菜单交互过（开过菜单/点过菜单项）。
  // 用于拦截紧随其后的抽屉遮罩 click 事件，避免抽屉被关掉。
  // 守卫在拦截一次 click 后立即重置，不影响后续正常的点击关闭抽屉行为。
  const backdropCloseGuardRef = useRef(false);

  // 点击菜单外部或滚动时关闭菜单；点击抽屉遮罩时仅关闭菜单、不关闭抽屉
  useEffect(() => {
    if (!menu) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (menuRef.current && menuRef.current.contains(target)) return;
      // 若点击的是抽屉遮罩，阻止事件冒泡/默认行为，避免关闭抽屉
      if (target.closest('[data-testid="settings-drawer-backdrop"]')) {
        e.preventDefault();
        e.stopPropagation();
        backdropCloseGuardRef.current = true;
      }
      setMenu(null);
    };
    const handleScroll = () => setMenu(null);
    document.addEventListener('mousedown', handlePointerDown, true);
    scrollContainerRef.current?.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      scrollContainerRef.current?.removeEventListener('scroll', handleScroll);
    };
  }, [menu]);

  // 始终挂载：拦截菜单刚关闭后的抽屉遮罩 click 事件，避免触发 navigate(-1) 关掉抽屉
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!backdropCloseGuardRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-testid="settings-drawer-backdrop"]')) {
        e.preventDefault();
        e.stopPropagation();
      }
      backdropCloseGuardRef.current = false;
    };
    document.addEventListener('click', handleClick, true);
    return () => {
      document.removeEventListener('click', handleClick, true);
    };
  }, []);

  // 编辑弹窗
  const [editing, setEditing] = useState<{ path: string; value: string; icon: string } | null>(null);
  // 仅移除标签确认
  const [removing, setRemoving] = useState<string | null>(null);
  // 删除标签和笔记二次确认
  const [deleting, setDeleting] = useState<{ path: string; step: 1 | 2 } | null>(null);

  const tagMap = useMemo(() => {
    const map = new Map<string, { pinned?: boolean; icon?: string; sort_order?: number }>();
    sortedTags.forEach(t => map.set(t.path, { pinned: t.pinned, icon: t.icon, sort_order: t.sort_order }));
    return map;
  }, [sortedTags]);

  const handlePin = async (path: string) => {
    const info = tagMap.get(path);
    if (info?.pinned) await unpinTag(path);
    else await pinTag(path);
    backdropCloseGuardRef.current = true;
    setMenu(null);
  };

  const handleEditSubmit = async () => {
    if (!editing) return;
    const newPath = normalizeTagPath(editing.value);
    if (!newPath || newPath === editing.path) {
      // 仅图标变更也同步
      await updateTag(editing.path, editing.path, editing.icon.trim());
    } else {
      await updateTag(editing.path, newPath, editing.icon.trim());
    }
    setEditing(null);
  };

  const handleRemoveConfirm = async () => {
    if (!removing) return;
    await removeTagOnly(removing);
    setRemoving(null);
  };

  const handleDeleteConfirm = async () => {
    if (!deleting) return;
    await deleteTagAndNotes(deleting.path);
    setDeleting(null);
  };

  const openMenu = (path: string, buttonEl: HTMLElement) => {
    // 标记用户已与菜单交互，下一次 backdrop click 会被拦截（避免菜单刚关就误关抽屉）
    backdropCloseGuardRef.current = true;
    setMenu({ path, buttonEl });
  };

  // 菜单项触发关闭菜单前也标记守卫
  const closeMenuWithGuard = () => {
    backdropCloseGuardRef.current = true;
    setMenu(null);
  };

  return (
    <>
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto thin-scrollbar overscroll-contain px-2 pb-3"
        data-testid="drawer-all-tags"
      >
        {tree.children.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {tree.children
              .slice()
              .sort((a, b) => {
                const sa = tagMap.get(a.path)?.sort_order ?? Number.MAX_SAFE_INTEGER;
                const sb = tagMap.get(b.path)?.sort_order ?? Number.MAX_SAFE_INTEGER;
                if (sa !== sb) return sa - sb;
                return a.name.localeCompare(b.name, 'zh-CN');
              })
              .map(node => (
                <TagNode
                  key={node.path}
                  node={node}
                  depth={0}
                  expandedPaths={expandedPaths}
                  toggleExpand={toggleExpand}
                  tagMap={tagMap}
                  activeMenu={menu?.path === node.path ? menu : null}
                  onOpenMenu={openMenu}
                  onCloseMenu={() => setMenu(null)}
                  onPin={handlePin}
                  onEdit={(path) => {
                    setEditing({ path, value: path, icon: tagMap.get(path)?.icon ?? '' });
                    setMenu(null);
                  }}
                  onRemove={(path) => {
                    setRemoving(path);
                    setMenu(null);
                  }}
                  onDelete={(path) => {
                    setDeleting({ path, step: 1 });
                    setMenu(null);
                  }}
                />
              ))}
          </div>
        ) : (
          <div className="px-2 py-8 text-center text-[12px] text-stone-400">{t('tags.noTagsTitle')}</div>
        )}
      </div>

      {menu && (
        <TagActionMenu
          ref={menuRef}
          menu={menu}
          pinned={tagMap.get(menu.path)?.pinned ?? false}
          onPin={() => handlePin(menu.path)}
          onEdit={() => {
            setEditing({ path: menu.path, value: menu.path, icon: tagMap.get(menu.path)?.icon ?? '' });
            closeMenuWithGuard();
          }}
          onRemove={() => {
            setRemoving(menu.path);
            closeMenuWithGuard();
          }}
          onDelete={() => {
            setDeleting({ path: menu.path, step: 1 });
            closeMenuWithGuard();
          }}
          onClose={() => setMenu(null)}
        />
      )}

      {/* 编辑弹窗 */}
      {editing && (
        <ModalOverlay onClose={() => setEditing(null)} title={t('tags.editNameAndIcon')}>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[11px] text-stone-500 font-medium">{t('tags.renamePlaceholder')}</label>
              <input
                type="text"
                value={editing.value}
                onChange={e => setEditing({ ...editing, value: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') handleEditSubmit(); }}
                className="w-full bg-white rounded-xl border border-stone-200 px-3 py-2.5 text-[14px] outline-none focus:border-baimiao-mysteria/40 transition-colors"
                autoFocus
                data-testid="tag-edit-path-input"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-stone-500 font-medium">{t('tags.iconPlaceholder')}</label>
              <input
                type="text"
                value={editing.icon}
                onChange={e => setEditing({ ...editing, icon: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') handleEditSubmit(); }}
                placeholder={t('tags.iconPlaceholder')}
                className="w-full bg-white rounded-xl border border-stone-200 px-3 py-2.5 text-[14px] outline-none focus:border-baimiao-mysteria/40 transition-colors"
                data-testid="tag-edit-icon-input"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end mt-4">
            <button
              onClick={() => setEditing(null)}
              className="px-4 py-2 rounded-xl text-[13px] font-medium text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleEditSubmit}
              disabled={!normalizeTagPath(editing.value)}
              className="px-4 py-2 rounded-xl text-[13px] font-medium text-white bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:scale-100 transition-all"
              data-testid="tag-edit-confirm-btn"
            >
              {t('tags.save')}
            </button>
          </div>
        </ModalOverlay>
      )}

      {/* 仅移除标签确认 */}
      {removing && (
        <ModalOverlay onClose={() => setRemoving(null)} title={t('tags.removeTagOnly')}>
          <p className="text-[13px] text-stone-600 leading-relaxed mb-4">
            {t('tags.removeTagOnlyConfirm', { path: removing })}
          </p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setRemoving(null)}
              className="px-4 py-2 rounded-xl text-[13px] font-medium text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleRemoveConfirm}
              className="px-4 py-2 rounded-xl text-[13px] font-medium text-white bg-gradient-to-r from-rose-500 to-rose-600 hover:brightness-110 active:scale-95 transition-all"
              data-testid="tag-remove-confirm-btn"
            >
              {t('tags.confirmRemoveBtn')}
            </button>
          </div>
        </ModalOverlay>
      )}

      {/* 删除标签和笔记二次确认 */}
      {deleting && (
        <ModalOverlay
          onClose={() => setDeleting(null)}
          title={deleting.step === 1 ? t('tags.deleteTagAndNotes') : t('tags.deleteTagAndNotesConfirmTitle')}
        >
          <p className="text-[13px] text-stone-600 leading-relaxed mb-2">
            {deleting.step === 1
              ? t('tags.deleteTagAndNotesConfirm', { path: deleting.path })
              : t('tags.deleteTagAndNotesFinal', { path: deleting.path })}
          </p>
          {deleting.step === 1 && (
            <p className="text-[12px] text-rose-500 leading-relaxed mb-4">
              {t('tags.deleteTagAndNotesWarning')}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setDeleting(null)}
              className="px-4 py-2 rounded-xl text-[13px] font-medium text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors"
            >
              {t('common.cancel')}
            </button>
            {deleting.step === 1 ? (
              <button
                onClick={() => setDeleting({ ...deleting, step: 2 })}
                className="px-4 py-2 rounded-xl text-[13px] font-medium text-white bg-gradient-to-r from-rose-500 to-rose-600 hover:brightness-110 active:scale-95 transition-all"
                data-testid="tag-delete-next-btn"
              >
                {t('tags.confirmDeleteBtn')}
              </button>
            ) : (
              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-2 rounded-xl text-[13px] font-medium text-white bg-gradient-to-r from-rose-600 to-rose-700 hover:brightness-110 active:scale-95 transition-all"
                data-testid="tag-delete-final-btn"
              >
                {t('tags.confirmDeleteFinalBtn')}
              </button>
            )}
          </div>
        </ModalOverlay>
      )}
    </>
  );
}

function TagNode({
  node,
  depth,
  expandedPaths,
  toggleExpand,
  tagMap,
  activeMenu,
  onOpenMenu,
  onCloseMenu,
  onPin,
  onEdit,
  onRemove,
  onDelete,
}: {
  node: TreeNode;
  depth: number;
  expandedPaths: Set<string>;
  toggleExpand: (path: string) => void;
  tagMap: Map<string, { pinned?: boolean; icon?: string; sort_order?: number }>;
  activeMenu: MenuState | null;
  onOpenMenu: (path: string, el: HTMLElement) => void;
  onCloseMenu: () => void;
  onPin: (path: string) => void;
  onEdit: (path: string) => void;
  onRemove: (path: string) => void;
  onDelete: (path: string) => void;
}) {
  const { t } = useTranslation();
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedPaths.has(node.path);
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const info = tagMap.get(node.path);
  const pinned = info?.pinned ?? false;
  const icon = info?.icon;
  const isMenuOpen = activeMenu?.path === node.path;

  return (
    <div>
      <div
        data-testid={`drawer-tag-node-${node.path}`}
        className="flex items-center gap-0.5 py-1.5 pr-1 rounded-lg hover:bg-stone-100/60 group transition-colors"
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => toggleExpand(node.path)}
            className="shrink-0 p-0.5 text-stone-400 hover:text-stone-700 transition-colors"
            aria-label={isExpanded ? t('thoughts.collapse') : t('thoughts.expand')}
            data-testid={`drawer-tag-expand-${node.path}`}
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span className="shrink-0 w-[22px] flex justify-center">
            <span className="w-1.5 h-1.5 rounded-full bg-stone-300" />
          </span>
        )}
        <span className="shrink-0 text-[13px] text-stone-500 mr-0.5 select-none" aria-hidden="true">
          {icon ? icon : <Hash className="w-3 h-3 text-baimiao-mysteria/50" />}
        </span>
        <span
          className={cn(
            'flex-1 text-[13px] truncate select-none',
            pinned ? 'text-baimiao-mysteria font-semibold' : 'text-stone-600'
          )}
          title={node.path}
        >
          {node.name}
        </span>
        <div className="flex items-center gap-0.5 shrink-0">
          {pinned && (
            <Pin className="w-3 h-3 text-baimiao-mysteria/70 shrink-0" data-testid={`drawer-tag-pinned-${node.path}`} />
          )}
          <button
            ref={moreBtnRef}
            onClick={() => {
              if (isMenuOpen) {
                onCloseMenu();
              } else if (moreBtnRef.current) {
                onOpenMenu(node.path, moreBtnRef.current);
              }
            }}
            className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 transition-colors"
            aria-label={t('editor.more')}
            data-testid={`drawer-tag-more-${node.path}`}
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {hasChildren && isExpanded && (
        <div>
          {node.children
            .slice()
            .sort((a, b) => {
              const sa = tagMap.get(a.path)?.sort_order ?? Number.MAX_SAFE_INTEGER;
              const sb = tagMap.get(b.path)?.sort_order ?? Number.MAX_SAFE_INTEGER;
              if (sa !== sb) return sa - sb;
              return a.name.localeCompare(b.name, 'zh-CN');
            })
            .map(child => (
              <TagNode
                key={child.path}
                node={child}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                toggleExpand={toggleExpand}
                tagMap={tagMap}
                activeMenu={activeMenu}
                onOpenMenu={onOpenMenu}
                onCloseMenu={onCloseMenu}
                onPin={onPin}
                onEdit={onEdit}
                onRemove={onRemove}
                onDelete={onDelete}
              />
            ))}
        </div>
      )}
    </div>
  );
}

const TagActionMenu = React.forwardRef<HTMLDivElement, {
  menu: MenuState;
  pinned: boolean;
  onPin: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onDelete: () => void;
  onClose: () => void;
}>(function TagActionMenu({ menu, pinned, onPin, onEdit, onRemove, onDelete, onClose }, ref) {
  const { t } = useTranslation();
  const rect = menu.buttonEl.getBoundingClientRect();
  const style: React.CSSProperties = {
    position: 'fixed',
    top: rect.bottom + 4,
    left: Math.min(rect.left - 128, window.innerWidth - 160),
    zIndex: 60,
    minWidth: 148,
  };

  const items = [
    { key: 'pin', label: pinned ? t('tags.unpin') : t('tags.pinTop'), icon: Pin, danger: false, onClick: onPin },
    { key: 'edit', label: t('tags.editNameAndIcon'), icon: Pencil, danger: false, onClick: onEdit },
    { key: 'remove', label: t('tags.removeTagOnly'), icon: Unlink, danger: true, onClick: onRemove },
    { key: 'delete', label: t('tags.deleteTagAndNotes'), icon: Trash2, danger: true, onClick: onDelete },
  ];

  return (
    <div
      ref={ref}
      style={style}
      className="bg-white rounded-xl shadow-xl border border-stone-100 py-1 flex flex-col"
      data-testid="drawer-tag-action-menu"
    >
      {items.map(item => (
        <button
          key={item.key}
          onClick={() => item.onClick()}
          className={cn(
            'flex items-center gap-2 px-3 py-2 text-[12.5px] font-medium text-left transition-colors',
            item.danger
              ? 'text-rose-600 hover:bg-rose-50'
              : 'text-stone-700 hover:bg-stone-100'
          )}
          data-testid={`tag-menu-${item.key}`}
        >
          <item.icon className={cn('w-3.5 h-3.5 shrink-0', item.danger ? 'text-rose-500' : 'text-stone-400')} />
          {item.label}
        </button>
      ))}
    </div>
  );
});

function ModalOverlay({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div
      className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200"
      onClick={onClose}
      data-testid="tag-modal-overlay"
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
