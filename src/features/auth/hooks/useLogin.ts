import { useMutation } from '@tanstack/react-query';
import { signIn } from '@/lib/auth';

export function useLogin() {
  return useMutation({
    mutationFn: async (vars: { email: string; password: string }) => {
      return await signIn(vars.email, vars.password);
    },
  });
}
