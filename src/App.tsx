import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import Layout from './components/Layout';
import Record from './pages/Record';
import Diary from './pages/Diary';
import Insights from './pages/Insights';
import Review from './pages/Review';
import Settings from './pages/Settings';

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
        path: 'diary',
        element: <Diary />
      },
      {
        path: 'insights',
        element: <Insights />
      },
      {
        path: 'review',
        element: <Review />
      }
    ]
  },
  {
    path: '/settings',
    element: <Settings />
  }
]);

export default function App() {
  return <RouterProvider router={router} />;
}

