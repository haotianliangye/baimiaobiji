import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Record from './pages/Record';
import Review from './pages/Review';
import Thoughts from './pages/Thoughts';
import Insights from './pages/Insights';
import Settings from './pages/Settings';
import TagManagement from './pages/TagManagement';

// V2 信息架构：记录(/) · 回顾(/review) · 沉淀(/thoughts) · 洞察(/insight)
// /diary、/mingwu、/insights 为旧链接，重定向到新路由（Copilot/LLM Chat 仍从 Header 进入）。
const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      {
        index: true,
        element: <Record />
      },
      {
        path: 'review',
        element: <Review />
      },
      {
        path: 'thoughts',
        element: <Thoughts />
      },
      {
        path: 'insight',
        element: <Insights />
      },
      {
        path: 'diary',
        element: <Navigate to="/review" replace />
      },
      {
        path: 'mingwu',
        element: <Navigate to="/insight" replace />
      },
      {
        path: 'insights',
        element: <Navigate to="/insight" replace />
      },
      {
        path: 'tags',
        element: <TagManagement />
      },
      // Issue: 设置入口改造 —— 把 /settings 从顶级路由移到 Layout 子路由，
      // 这样点击 [≡] 时 Layout 仍挂载，主面板能被推到右侧作"暗淡"次位展示。
      // drawer / detail 用 ?view=detail 区分，drawer 为默认。
      {
        path: 'settings',
        element: <Settings />
      }
    ]
  }
]);

export default function App() {
  return <RouterProvider router={router} />;
}
