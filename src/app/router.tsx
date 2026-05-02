import { createBrowserRouter } from 'react-router-dom';
import { ShellLayout } from './ShellLayout';
import { SetPasswordLayout } from './SetPasswordLayout';
import { AdminLayout } from './AdminLayout';
import { HomePage } from './routes/HomePage';
import { LoginPage } from '@/features/auth/LoginPage';
import { NotFoundPage } from './routes/NotFoundPage';
import { UsersListPage } from '@/features/users/UsersListPage';
import { UserDetailPage } from '@/features/users/UserDetailPage';
import { GroupsListPage } from '@/features/permissions/GroupsListPage';

export const router = createBrowserRouter([
  {
    element: <ShellLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      {
        path: 'admin',
        element: <AdminLayout />,
        children: [
          { path: 'users', element: <UsersListPage /> },
          { path: 'users/:userId', element: <UserDetailPage /> },
          { path: 'groups', element: <GroupsListPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '/login', element: <LoginPage /> },
  { path: '/set-password', element: <SetPasswordLayout /> },
]);
