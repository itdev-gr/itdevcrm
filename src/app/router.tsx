import { createBrowserRouter } from 'react-router-dom';
import { ShellLayout } from './ShellLayout';
import { SetPasswordLayout } from './SetPasswordLayout';
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
  { path: '/login', element: <LoginPage /> },
  { path: '/set-password', element: <SetPasswordLayout /> },
]);
