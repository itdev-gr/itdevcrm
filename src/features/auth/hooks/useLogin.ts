import { useMutation } from '@tanstack/react-query';
import { signIn } from '@/lib/auth';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useLogin() {
  return useMutation({
    mutationFn: captureMutation('auth', 'login', async (vars: { email: string; password: string }) => {
      return await signIn(vars.email, vars.password);
    }),
  });
}
