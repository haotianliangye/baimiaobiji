import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import { initEmbeddingQueueListener } from './lib/embedding';
import { maybeBackup } from './lib/autoBackup';

// Register PWA service worker
registerSW({ immediate: true });

// Initialize embedding queue listener
initEmbeddingQueueListener();

// Issue #008: 启动时检查自动备份（fire-and-forget）
// 设计上不阻塞 render：备份是慢操作（可能几秒），不该挡首屏
void maybeBackup().catch(err => {
  console.error('[autoBackup] 启动时检查失败:', err);
});

// Issue #008: 页面切到后台时再检查一次（防用户用完就关）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    void maybeBackup().catch(err => {
      console.error('[autoBackup] visibilitychange 触发备份失败:', err);
    });
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
