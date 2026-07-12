import { Notepad } from '@phosphor-icons/react';
import { Sparkles } from 'lucide-react';

// V2「沉思」笔记板块占位页。真实的 flomo 式笔记 UI（瀑布流/时间线、富文本编辑、
// 标签、附件、随机漫步入口）在 #7 实现；#3 仅提供导航可达的占位。
export default function Thoughts() {
  return (
    <div className="flex flex-col h-full bg-transparent">
      <div className="flex h-[52px] items-center px-4 bg-[#faf9fc]/85 backdrop-blur border-b border-baimiao-border/40 z-20 shrink-0 w-full">
        <h2 className="text-[13.5px] font-bold tracking-wide text-baimiao-mysteria flex items-center gap-1.5 font-serif baimiao-editorial-title">
          <Notepad weight="regular" className="w-4 h-4 text-baimiao-mysteria/70 translate-y-[-0.8px] shrink-0" />
          沉思
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto thin-scrollbar p-6 flex flex-col items-center justify-center text-center">
        <div className="text-baimiao-mysteria mb-4 bg-white p-3 rounded-xl shadow-[0_2px_10px_rgba(27,25,56,0.05)] border border-baimiao-mysteria/5">
          <Sparkles className="w-6 h-6 stroke-[1.5px] text-baimiao-mysteria/70" />
        </div>
        <p className="text-[15px] text-stone-900 font-medium tracking-tight mb-2 font-serif baimiao-editorial-title">沉思板块</p>
        <p className="text-[12.5px] text-stone-500 leading-relaxed max-w-[260px]">
          这里将是你慢思考的沉淀空间——支持 Markdown、标签与附件的笔记系统。
        </p>
        <p className="text-[11px] text-stone-400 mt-4">该模块开发中（追踪 Issue #7）</p>
      </div>
    </div>
  );
}
