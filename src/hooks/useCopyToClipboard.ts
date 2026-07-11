import { useState, useCallback, useRef } from 'react';

interface UseCopyToClipboardOptions {
  /** 复制成功后按钮保持成功态的时长（毫秒），默认 1500 */
  successDuration?: number;
  /** 复制成功后的回调 */
  onSuccess?: () => void;
  /** 复制失败后的回调 */
  onError?: (error: unknown) => void;
}

interface UseCopyToClipboardReturn {
  /** 是否刚复制成功（用于切换图标/文字） */
  copied: boolean;
  /** 执行复制 */
  copy: (text: string) => Promise<boolean>;
  /** 重置成功态 */
  reset: () => void;
}

export function useCopyToClipboard(
  options: UseCopyToClipboardOptions = {}
): UseCopyToClipboardReturn {
  const { successDuration = 1500, onSuccess, onError } = options;
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setCopied(false);
  }, []);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      reset();

      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        onSuccess?.();

        timeoutRef.current = setTimeout(() => {
          setCopied(false);
          timeoutRef.current = null;
        }, successDuration);

        return true;
      } catch (err) {
        onError?.(err);
        return false;
      }
    },
    [reset, successDuration, onSuccess, onError]
  );

  return { copied, copy, reset };
}
