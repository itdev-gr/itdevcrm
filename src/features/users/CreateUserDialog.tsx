import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useCreateUser } from './hooks/useCreateUser';
import { ManageGroupsField } from './ManageGroupsField';

const schema = z.object({
  full_name: z.string().min(1),
  email: z.string().email(),
  temp_password: z.string().min(8),
  is_admin: z.boolean().optional(),
});

type FormValues = z.infer<typeof schema>;

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

export function CreateUserDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation('users');
  const [groupCodes, setGroupCodes] = useState<string[]>([]);
  const create = useCreateUser();

  const { register, handleSubmit, reset, control, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: FormValues) {
    try {
      await create.mutateAsync({
        ...values,
        is_admin: values.is_admin ?? false,
        group_codes: groupCodes,
      });
      reset();
      setGroupCodes([]);
      onOpenChange(false);
    } catch {
      // error rendered below
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('create_dialog.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="full_name">{t('create_dialog.full_name')}</Label>
            <Input id="full_name" {...register('full_name')} />
          </div>
          <div>
            <Label htmlFor="email">{t('create_dialog.email')}</Label>
            <Input id="email" type="email" {...register('email')} />
          </div>
          <div>
            <Label htmlFor="temp_password">{t('create_dialog.temp_password')}</Label>
            <Input id="temp_password" type="text" {...register('temp_password')} />
          </div>
          <div>
            <Label>{t('create_dialog.groups')}</Label>
            <ManageGroupsField selected={groupCodes} onChange={setGroupCodes} />
          </div>
          <div className="flex items-center gap-2">
            <Controller
              control={control}
              name="is_admin"
              render={({ field }) => (
                <Checkbox
                  id="is_admin"
                  checked={!!field.value}
                  onCheckedChange={(v) => field.onChange(v === true)}
                />
              )}
            />
            <Label htmlFor="is_admin">{t('create_dialog.is_admin')}</Label>
          </div>
          {create.isError && (
            <p role="alert" className="text-sm text-red-600">
              {create.error?.message ?? t('create_dialog.error_generic')}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || formState.isSubmitting}>
              {create.isPending ? t('create_dialog.submitting') : t('create_dialog.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
