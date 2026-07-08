import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, RefreshCw, Copy, Trash2, Maximize2, ChevronDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { InsightMessage } from '../db/db';
import { useSettingsStore } from '../store/settings.store';
import { washCitations } from '../lib/citationWash';

interface ContextChatProps {
  chatHistory: InsightMessage[];
  contextContent?: string;
  apiEndpoint: string;
  onUpdateHistory: (newHistory: InsightMessage[]) => Promise<void> | void;
  // When provided, the context is re-retrieved per question (RAG) instead of
  // using the static contextContent prop. Used by the Copilot panel.
  getDynamicContext?: (userMessage: string) => Promise<string>;
  // When provided, `#log_id_<UUID>` citation links call this instead of
  // navigating as plain anchors. Used by the Copilot panel.
  onCitationClick?: (logId: string) => void;
  inputPlaceholder?: string;
}

export default function ContextChat({ chatHistory, contextContent, apiEndpoint, onUpdateHistory, getDynamicContext, onCitationClick, inputPlaceholder }: ContextChatProps) {
  const [messages, setMessages] = useState<InsightMessage[]>(chatHistory || []);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const settings = useSettingsStore();

  useEffect(() => {
    // Only sync down from a non-empty chatHistory. Guards against the new-
    // conversation race where chatHistory transiently becomes [] while the
    // first message is being persisted, which would otherwise wipe the
    // optimistic user message.
    if (chatHistory && chatHistory.length !== messages.length && !isTyping && chatHistory.length > 0) {
        setMessages(chatHistory);
    }
  }, [chatHistory]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const updateAndSave = async (newMsgs: InsightMessage[]) => {
    setMessages(newMsgs);
    await onUpdateHistory(newMsgs);
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isTyping) return;
    
    const userMsg: InsightMessage = {
      role: 'user',
      content: inputValue.trim(),
      timestamp: Date.now()
    };
    
    const newMessages = [...messages, userMsg];
    await updateAndSave(newMessages);
    
    setInputValue("");
    setIsTyping(true);

    try {
      const ctx = getDynamicContext ? await getDynamicContext(userMsg.content) : (contextContent || '');
      const res = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contextContent: ctx,
          chatHistory: messages,
          userMessage: userMsg.content,
          settings
        })
      });

      if (!res.ok) {
        let errStr = await res.text();
        try { const d = JSON.parse(errStr); errStr = d.error || errStr; } catch(e){}
        throw new Error(errStr);
      }

      const data = await res.json();
      const aiMsg: InsightMessage = {
        role: 'assistant',
        content: data.reply || "请求失败，未返回内容",
        timestamp: Date.now()
      };

      await updateAndSave([...newMessages, aiMsg]);

    } catch (err: any) {
      console.error(err);
      const errorMsg: InsightMessage = {
        role: 'assistant',
        content: `**发生错误**：${err.message}`,
        timestamp: Date.now()
      };
      await updateAndSave([...newMessages, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleDelete = async (index: number) => {
    const newMessages = messages.filter((_, i) => i !== index);
    await updateAndSave(newMessages);
  };

  const handleRegenerate = async (index: number) => {
    if (isTyping) return;
    
    let userMsgIndex = index - 1;
    while (userMsgIndex >= 0 && messages[userMsgIndex].role !== 'user') {
       userMsgIndex--;
    }
    
    if (userMsgIndex < 0) return;

    const historyUpToUserMsg = messages.slice(0, userMsgIndex);
    const targetUserMsg = messages[userMsgIndex];

    const newMessages = messages.slice(0, userMsgIndex + 1);
    await updateAndSave(newMessages);
    setIsTyping(true);

    try {
      const ctx = getDynamicContext ? await getDynamicContext(targetUserMsg.content) : (contextContent || '');
      const res = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contextContent: ctx,
          chatHistory: historyUpToUserMsg,
          userMessage: targetUserMsg.content,
          settings
        })
      });

      if (!res.ok) {
        let errStr = await res.text();
        try { const d = JSON.parse(errStr); errStr = d.error || errStr; } catch(e){}
        throw new Error(errStr);
      }

      const data = await res.json();
      const aiMsg: InsightMessage = {
        role: 'assistant',
        content: data.reply || "请求失败，未返回内容",
        timestamp: Date.now()
      };

      await updateAndSave([...newMessages, aiMsg]);

    } catch (err: any) {
      console.error(err);
      const errorMsg: InsightMessage = {
        role: 'assistant',
        content: `**发生错误**：${err.message}`,
        timestamp: Date.now()
      };
      await updateAndSave([...newMessages, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex flex-col mt-4 border-t border-stone-100 pt-4">
      {messages.length > 0 && (
        <div ref={scrollRef} className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto thin-scrollbar pb-2 pr-1 mb-3">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div 
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed shadow-sm ${
                  msg.role === 'user' 
                    ? 'bg-stone-800 text-stone-50 rounded-tr-sm' 
                    : 'bg-white border border-stone-100 text-stone-700 rounded-tl-sm'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <div className="w-full flex flex-col">
                    <div className="markdown-body prose prose-sm prose-stone prose-p:my-1 prose-ul:my-1 prose-ol:my-1 w-full max-w-none">
                      <ReactMarkdown
                        components={
                          onCitationClick
                            ? {
                                a: ({ node, href, children, ...props }) => (
                                  <a
                                    href={href}
                                    onClick={(e) => {
                                      if (href?.startsWith('#log_id_')) {
                                        e.preventDefault();
                                        onCitationClick(href.replace('#log_id_', ''));
                                      }
                                    }}
                                    className="text-stone-500 bg-stone-200/50 hover:bg-stone-200 hover:text-stone-900 px-1.5 py-0.5 rounded cursor-pointer no-underline transition-colors border border-black/5"
                                    {...props}
                                  >
                                    {children}
                                  </a>
                                ),
                              }
                            : undefined
                        }
                      >
                        {washCitations(msg.content)}
                      </ReactMarkdown>
                    </div>
                    <div className="flex justify-between w-full mt-3 pt-2.5 border-t border-stone-100/80 text-[11px] text-stone-400 font-medium select-none">
                      <button 
                        onClick={() => handleDelete(idx)} 
                        className="flex items-center gap-1 hover:text-rose-500 transition-colors active:scale-95"
                      >
                        <Trash2 className="w-3 h-3" />
                        删除
                      </button>
                      <button 
                        onClick={() => navigator.clipboard.writeText(msg.content)} 
                        className="flex items-center gap-1 hover:text-stone-700 transition-colors active:scale-95"
                      >
                        <Copy className="w-3 h-3" />
                        复制
                      </button>
                      <button 
                        onClick={() => handleRegenerate(idx)} 
                        className="flex items-center gap-1 hover:text-stone-700 transition-colors active:scale-95"
                      >
                        <RefreshCw className="w-3 h-3" />
                        重新生成
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                )}
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-white border border-stone-100 text-stone-500 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2 shadow-sm">
                 <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
                 <span className="text-[13px] font-medium tracking-wide">思考中...</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-end gap-2 relative">
        <button
          type="button"
          onClick={() => setIsFullScreen(true)}
          className="w-11 h-11 shrink-0 flex items-center justify-center bg-stone-50 border border-stone-200/60 text-stone-400 rounded-2xl hover:bg-stone-100 hover:text-stone-750 transition-colors active:scale-95"
          title="展开为长文本输入"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <textarea
          className="flex-1 bg-stone-50 border border-stone-200/60 rounded-2xl px-4 py-3 text-[14px] text-stone-800 placeholder-stone-400 focus:outline-none focus:border-stone-300 focus:bg-white focus:ring-4 focus:ring-stone-100/50 transition-all resize-none thin-scrollbar"
          rows={1}
          placeholder={inputPlaceholder || "向 AI 追问更多细节..."}
          value={inputValue}
          onChange={(e) => {
             setInputValue(e.target.value);
             e.target.style.height = 'auto';
             e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
          }}
          onKeyDown={(e) => {
            const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth < 768);
            if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
              e.preventDefault();
              handleSend();
            }
          }}
          style={{ minHeight: '44px' }}
        />
        <button
          onClick={handleSend}
          disabled={!inputValue.trim() || isTyping}
          className="w-11 h-11 shrink-0 flex items-center justify-center bg-stone-900 text-white rounded-xl shadow-sm hover:bg-stone-800 transition-colors disabled:opacity-40 disabled:hover:bg-stone-900"
        >
          <Send className="w-5 h-5 ml-[-2px]" />
        </button>
      </div>

      {/* Full Screen Text Editor overlay */}
      {isFullScreen && (
        <div className="fixed inset-0 z-[110] flex flex-col bg-white animate-in slide-in-from-bottom duration-300">
          {/* Header */}
          <div className="flex h-[54px] shrink-0 items-center px-4 bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white gap-2 select-none border-b border-white/5">
            <button
              type="button"
              onClick={() => setIsFullScreen(false)}
              className="p-1.5 hover:opacity-70 transition-opacity active:scale-95 shrink-0"
              title="收起"
            >
              <ChevronDown className="w-6 h-6 text-white" />
            </button>
            <span className="text-[14px] font-normal flex-1 font-serif baimiao-editorial-title translate-y-[2px] tracking-wide select-none">
              长文本输入
            </span>
          </div>

          {/* Text Area */}
          <div className="flex-1 bg-white p-6 overflow-y-auto">
            <textarea
              className="w-full h-full focus:outline-none resize-none text-[15.5px] leading-relaxed text-stone-800 placeholder-stone-400 thin-scrollbar"
              placeholder={inputPlaceholder || "在这里写下长内容，向 AI 追问更多细节..."}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              autoFocus
            />
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-stone-100 bg-[#faf9fc] flex justify-end shrink-0 z-20">
            <button
              onClick={() => {
                handleSend();
                setIsFullScreen(false);
              }}
              disabled={!inputValue.trim() || isTyping}
              className="px-6 py-2.5 rounded-xl text-[14px] font-medium text-white bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] border border-white/10 hover:brightness-110 active:scale-95 transition-all shadow-sm select-none disabled:opacity-40 disabled:hover:brightness-100"
            >
              发送
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
