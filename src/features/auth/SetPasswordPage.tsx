import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useChangePassword } from './hooks/useChangePassword';

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

export function SetPasswordPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const change = useChangePassword();

  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: FormValues) {
    try {
      await change.mutateAsync(values.new_password);
      navigate('/', { replace: true });
    } catch {
      // error rendered below
    }
  }

  return (
    <div className="mx-auto mt-24 max-w-sm space-y-6 p-8">
      <h1 className="text-2xl font-bold">{t('set_password.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('set_password.description')}</p>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <Label htmlFor="new_password">{t('set_password.new_password')}</Label>
          <Input
            id="new_password"
            type="password"
            autoComplete="new-password"
            {...register('new_password')}
          />
          {formState.errors.new_password && (
            <p className="mt-1 text-sm text-red-600">{t('set_password.error_too_short')}</p>
          )}
        </div>
        <div>
          <Label htmlFor="confirm_password">{t('set_password.confirm_password')}</Label>
          <Input
            id="confirm_password"
            type="password"
            autoComplete="new-password"
            {...register('confirm_password')}
          />
          {formState.errors.confirm_password && (
            <p className="mt-1 text-sm text-red-600">{t('set_password.error_mismatch')}</p>
          )}
        </div>
        <Button type="submit" disabled={change.isPending || formState.isSubmitting}>
          {change.isPending ? t('set_password.submitting') : t('set_password.submit')}
        </Button>
      </form>
    </div>
  );
}
