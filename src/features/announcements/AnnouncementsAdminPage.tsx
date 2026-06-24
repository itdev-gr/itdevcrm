import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader, SettingsCard } from '@/components/layout/page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useGroups } from '@/features/groups/hooks/useGroups';
import { useCreateAnnouncement } from './hooks/useCreateAnnouncement';
import { useAnnouncements, type AdminAnnouncement } from './hooks/useAnnouncements';
import { useSetAnnouncementActive } from './hooks/useSetAnnouncementActive';
import { useDeleteAnnouncement } from './hooks/useDeleteAnnouncement';
import {
  validateNewAnnouncement,
  buildCreateAnnouncementParams,
  type AnnouncementSeverity,
} from './announcement';

export function AnnouncementsAdminPage() {
  const { t, i18n } = useTranslation('announcements');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: groups = [] } = useGroups();
  const create = useCreateAnnouncement();
  const { data: list = [] } = useAnnouncements();
  const setActive = useSetAnnouncementActive();
  const del = useDeleteAnnouncement();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<AnnouncementSeverity>('info');
  const [targetAll, setTargetAll] = useState(true);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState('');

  function toggleGroup(id: string) {
    setGroupIds((cur) => (cur.includes(id) ? cur.filter((g) => g !== id) : [...cur, id]));
  }

  function reset() {
    setTitle('');
    setBody('');
    setSeverity('info');
    setTargetAll(true);
    setGroupIds([]);
    setExpiresAt('');
  }

  function showErrors(keys: string[]) {
    alert(keys.map((k) => t(`admin.errors.${k}`, { defaultValue: k })).join('\n'));
  }

  function onPublish() {
    const input = { title, body, severity, targetAll, groupIds, expiresAt };
    const errs = validateNewAnnouncement(input);
    if (errs.length > 0) {
      showErrors(errs);
      return;
    }
    create.mutate(buildCreateAnnouncementParams(input), {
      onSuccess: () => reset(),
      onError: (err) => {
        const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
        showErrors(errors);
      },
    });
  }

  function audienceLabel(a: AdminAnnouncement): string {
    if (a.target_all) return t('admin.target_all');
    return a.announcement_targets
      .map((tg) => tg.groups?.display_names?.[lang] ?? tg.group_id)
      .join(', ');
  }

  function statusLabel(a: AdminAnnouncement): string {
    if (a.expires_at && new Date(a.expires_at) <= new Date()) return t('admin.status_expired');
    return a.is_active ? t('admin.status_active') : t('admin.status_inactive');
  }

  return (
    <div className="space-y-5">
      <SettingsCard className="p-5">
        <PageHeader title={t('admin.title')} description={t('admin.description')} />

        <div className="mt-4 max-w-2xl space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="an-title">{t('admin.field_title')}</Label>
            <Input id="an-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="an-body">{t('admin.field_message')}</Label>
            <textarea
              id="an-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="an-sev">{t('admin.field_severity')}</Label>
              <select
                id="an-sev"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as AnnouncementSeverity)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                <option value="info">{t('admin.severity_info')}</option>
                <option value="warning">{t('admin.severity_warning')}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="an-exp">{t('admin.field_expires')}</Label>
              <Input
                id="an-exp"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('admin.target')}</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={targetAll ? 'default' : 'outline'}
                onClick={() => setTargetAll(true)}
              >
                {t('admin.target_all')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={!targetAll ? 'default' : 'outline'}
                onClick={() => setTargetAll(false)}
              >
                {t('admin.target_groups')}
              </Button>
            </div>
            {!targetAll ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {groups.map((g) => (
                  <label
                    key={g.id}
                    className="flex items-center gap-1.5 rounded-md border border-input px-2 py-1 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={groupIds.includes(g.id)}
                      onChange={() => toggleGroup(g.id)}
                    />
                    {g.display_names[lang]}
                  </label>
                ))}
              </div>
            ) : null}
          </div>

          <Button onClick={onPublish} disabled={create.isPending}>
            {create.isPending ? t('admin.publishing') : t('admin.publish')}
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard className="p-5">
        <h2 className="text-lg font-semibold">{t('admin.list_title')}</h2>
        {list.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('admin.empty')}</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2">{t('admin.col_title')}</th>
                <th className="py-2">{t('admin.col_audience')}</th>
                <th className="py-2">{t('admin.col_status')}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className="border-t border-border/60">
                  <td className="py-2 pr-3">{a.title}</td>
                  <td className="py-2 pr-3">{audienceLabel(a)}</td>
                  <td className="py-2 pr-3">{statusLabel(a)}</td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setActive.mutate({ id: a.id, active: !a.is_active })}
                      >
                        {a.is_active ? t('admin.deactivate') : t('admin.reactivate')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm(t('admin.delete_confirm'))) del.mutate(a.id);
                        }}
                      >
                        {t('admin.delete')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SettingsCard>
    </div>
  );
}
