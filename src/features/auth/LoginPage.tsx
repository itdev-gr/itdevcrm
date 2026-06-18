import { LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLogin } from './hooks/useLogin';
import { LoginBrandingPanel } from './LoginBrandingPanel';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const location = useLocation();
  const login = useLogin();

  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: FormValues) {
    try {
      await login.mutateAsync(values);
      const redirectTo =
        (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/';
      navigate(redirectTo, { replace: true });
    } catch {
      // error rendered below via login.isError
    }
  }

  return (
    <div className="flex min-h-screen bg-white text-[#15243b]">
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 flex size-14 items-center justify-center rounded-full bg-[#1a9696]">
            <LogIn className="size-6 text-white" strokeWidth={2} />
          </div>

          <h1 className="text-3xl font-bold tracking-tight">{t('login.title')}</h1>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-semibold text-[#15243b]">
                {t('login.email')}
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder={t('login.email_placeholder')}
                className="h-11 rounded-xl border-[#d9dee7] bg-white px-4 text-[#15243b] placeholder:text-[#98a2b3] focus-visible:border-[#1a9696] focus-visible:ring-[#1a9696]/20"
                {...register('email')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-semibold text-[#15243b]">
                {t('login.password')}
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder={t('login.password_placeholder')}
                className="h-11 rounded-xl border-[#d9dee7] bg-white px-4 text-[#15243b] placeholder:text-[#98a2b3] focus-visible:border-[#1a9696] focus-visible:ring-[#1a9696]/20"
                {...register('password')}
              />
            </div>

            {login.isError && (
              <p role="alert" className="text-sm text-red-600">
                {t('login.error_generic')}
              </p>
            )}

            <Button
              type="submit"
              disabled={login.isPending || formState.isSubmitting}
              className="h-11 w-full rounded-full bg-[#1a9696] text-base font-semibold text-white hover:bg-[#178787]"
            >
              {login.isPending ? t('login.submitting') : t('login.submit')}
            </Button>
          </form>

          <Link
            to="/forgot-password"
            className="mt-6 inline-block text-sm font-medium text-[#1a9696] hover:text-[#178787] hover:underline"
          >
            {t('login.forgot_password')}
          </Link>
        </div>
      </div>

      <div className="hidden flex-1 items-center justify-center border-l border-[#e8ebf0] lg:flex">
        <LoginBrandingPanel />
      </div>
    </div>
  );
}
