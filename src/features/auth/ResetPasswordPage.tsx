import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useChangePassword } from './hooks/useChangePassword';
import { useAuthStore } from '@/lib/stores/authStore';

const schema = z
  .object({
    new_password: z.string().min(8),
    confirm_password: z.string(),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    path: ['confirm_password'],
    message: 'mismatch',
  });

type FormValues = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const change = useChangePassword();
  const user = useAuthStore((s) => s.user);

  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  // Supabase redirects here after verifying the email link. A valid link
  // carries a recovery session in the hash (#access_token=…, hydrated by the
  // auth listener); an expired or used link carries error params instead.
  const hash = window.location.hash;
  const linkFailed = hash.includes('error=') || hash.includes('error_code=');
  const hasRecovery = Boolean(user) || hash.includes('access_token=');

  if (linkFailed || !hasRecovery) {
    return (
      <div className="mx-auto mt-24 max-w-sm space-y-6 p-8">
        <h1 className="text-2xl font-bold">{t('reset_password.expired_title')}</h1>
        <p className="text-sm text-muted-foreground">{t('reset_password.expired_description')}</p>
        <Link to="/forgot-password" className="block text-sm underline">
          {t('reset_password.request_new')}
        </Link>
      </div>
    );
  }

  async function onSubmit(values: FormValues) {
    try {
      await change.mutateAsync(values.new_password);
      navigate('/', { replace: true });
    } catch {
      // error rendered below via change.isError
    }
  }

  return (
    <div className="mx-auto mt-24 max-w-sm space-y-6 p-8">
      <h1 className="text-2xl font-bold">{t('reset_password.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('reset_password.description')}</p>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <Label htmlFor="new_password">{t('reset_password.new_password')}</Label>
          <Input
            id="new_password"
            type="password"
            autoComplete="new-password"
            {...register('new_password')}
          />
          {formState.errors.new_password && (
            <p className="mt-1 text-sm text-red-600">{t('reset_password.error_too_short')}</p>
          )}
        </div>
        <div>
          <Label htmlFor="confirm_password">{t('reset_password.confirm_password')}</Label>
          <Input
            id="confirm_password"
            type="password"
            autoComplete="new-password"
            {...register('confirm_password')}
          />
          {formState.errors.confirm_password && (
            <p className="mt-1 text-sm text-red-600">{t('reset_password.error_mismatch')}</p>
          )}
        </div>
        {change.isError && (
          <p role="alert" className="text-sm text-red-600">
            {t('reset_password.error_generic')}
          </p>
        )}
        <Button type="submit" disabled={change.isPending || formState.isSubmitting}>
          {change.isPending ? t('reset_password.submitting') : t('reset_password.submit')}
        </Button>
      </form>
    </div>
  );
}
