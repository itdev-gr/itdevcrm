import { createBrowserRouter } from 'react-router-dom';
import { ShellLayout } from './ShellLayout';
import { HomePage } from './routes/HomePage';
import { LoginPage } from '@/features/auth/LoginPage';
import { NotFoundPage } from './routes/NotFoundPage';

export const router = createBrowserRouter([
  {
    element: <ShellLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  // login is OUTSIDE the shell (no sidebar/topbar on login page)
  { path: '/login', element: <LoginPage /> },
]);
