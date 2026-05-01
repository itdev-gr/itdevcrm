import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLogin } from './hooks/useLogin';

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
    <div className="mx-auto mt-24 max-w-sm space-y-6 p-8">
      <h1 className="text-2xl font-bold">{t('login.title')}</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <Label htmlFor="email">{t('login.email')}</Label>
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
        </div>
        <div>
          <Label htmlFor="password">{t('login.password')}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register('password')}
          />
        </div>
        {login.isError && (
          <p role="alert" className="text-sm text-red-600">
            {t('login.error_generic')}
          </p>
        )}
        <Button type="submit" disabled={login.isPending || formState.isSubmitting}>
          {login.isPending ? t('login.submitting') : t('login.submit')}
        </Button>
      </form>
    </div>
  );
}
