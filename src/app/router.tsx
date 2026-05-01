import { createBrowserRouter } from 'react-router-dom';
import { HomePage } from './routes/HomePage';
import { LoginPage } from './routes/LoginPage';
import { NotFoundPage } from './routes/NotFoundPage';

export const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '*', element: <NotFoundPage /> },
]);
