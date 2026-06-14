import React, { useEffect } from 'react';

interface ActionSheetProps {
  isOpen: boolean;
  onClose: () => void;
  actions: {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    danger?: boolean;
  }[];
}

export default function ActionSheet({ isOpen, onClose, actions }: ActionSheetProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/40 z-[100] transition-opacity"
        onClick={onClose}
      />
      <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl z-[101] max-w-md mx-auto transform transition-transform animate-in slide-in-from-bottom-full duration-300 pb-safe">
        <div className="flex flex-col p-4 space-y-1">
          <div className="w-10 h-1.5 bg-stone-200 rounded-full mx-auto mb-4" />
          
          <div className="bg-stone-50 rounded-2xl overflow-hidden flex flex-col mb-4 ring-1 ring-black/5">
              {actions.map((action, idx) => (
                <button
                  key={idx}
                  onClick={() => { action.onClick(); onClose(); }}
                  className={`flex items-center justify-center gap-2 p-4 w-full text-center transition-colors border-b border-stone-200/60 last:border-0 ${action.danger ? 'text-red-500 hover:bg-red-50 active:bg-red-100' : 'text-stone-700 hover:bg-stone-100 active:bg-stone-200'}`}
                >
                  {action.icon}
                  <span className="text-[16px] font-medium">{action.label}</span>
                </button>
              ))}
          </div>

          <button
            onClick={onClose}
            className="flex items-center justify-center p-4 w-full text-center text-stone-600 bg-stone-100 hover:bg-stone-200 active:bg-stone-300 rounded-2xl transition-colors font-medium text-[16px]"
          >
            取消
          </button>
        </div>
      </div>
    </>
  );
}
