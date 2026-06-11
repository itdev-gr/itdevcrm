import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';

const schema = z.object({ email: z.string().email() });

type FormValues = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const { t } = useTranslation('auth');
  const [sent, setSent] = useState(false);

  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: FormValues) {
    // Uniform outcome regardless of result: never reveal whether the email
    // has an account (also swallows Supabase's rate-limit error).
    try {
      await supabase.auth.resetPasswordForEmail(values.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } catch {
      // intentionally ignored
    }
    setSent(true);
  }

  return (
    <div className="mx-auto mt-24 max-w-sm space-y-6 p-8">
      <h1 className="text-2xl font-bold">{t('forgot_password.title')}</h1>
      {sent ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('forgot_password.sent_notice')}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t('forgot_password.description')}</p>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="email">{t('forgot_password.email')}</Label>
              <Input id="email" type="email" autoComplete="email" {...register('email')} />
            </div>
            <Button type="submit" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? t('forgot_password.submitting') : t('forgot_password.submit')}
            </Button>
          </form>
        </>
      )}
      <Link to="/login" className="block text-sm underline">
        {t('forgot_password.back_to_login')}
      </Link>
    </div>
  );
}
