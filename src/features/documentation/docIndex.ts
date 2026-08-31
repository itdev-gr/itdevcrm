const DOCS = import.meta.glob('../../../docs/tech/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export type DocEntry = { slug: string; title: string; file: string };
export type DocArea = { area: string; areaTitle: string; docs: DocEntry[] };

// Single source of nav order. `file` is the path tail under docs/tech/.
export const DOC_AREAS: DocArea[] = [
  {
    area: 'overview',
    areaTitle: 'Overview',
    docs: [
      { slug: 'architecture', title: 'Architecture & stack', file: 'overview/architecture.md' },
      { slug: 'data-model', title: 'Data model map', file: 'overview/data-model.md' },
      { slug: 'environments', title: 'Environments & deploy', file: 'overview/environments.md' },
      { slug: 'conventions', title: 'Conventions & gotchas', file: 'overview/conventions.md' },
    ],
  },
  {
    area: 'sales',
    areaTitle: 'Sales',
    docs: [
      { slug: 'lead-intake', title: 'Lead intake', file: 'sales/lead-intake.md' },
      { slug: 'distribution', title: 'Lead distribution', file: 'sales/distribution.md' },
      { slug: 'kanban', title: 'Sales kanban & stages', file: 'sales/kanban.md' },
      { slug: 'under-development', title: 'Under Development pipeline', file: 'sales/under-development.md' },
      { slug: 'call-comments', title: 'Call auto-comments', file: 'sales/call-comments.md' },
      { slug: 'conversion', title: 'Lead → deal conversion', file: 'sales/conversion.md' },
    ],
  },
  {
    area: 'accounting',
    areaTitle: 'Accounting',
    docs: [
      { slug: 'deal-lifecycle', title: 'Deal & onboarding stages', file: 'accounting/deal-lifecycle.md' },
      { slug: 'billing-model', title: 'Billing model (jobs & payments)', file: 'accounting/billing-model.md' },
      { slug: 'block-lifecycle', title: 'Block / On-Hold lifecycle', file: 'accounting/block-lifecycle.md' },
      { slug: 'renewal-close', title: 'Renewal & close', file: 'accounting/renewal-close.md' },
      { slug: 'payment-reminders', title: 'Payment reminders', file: 'accounting/payment-reminders.md' },
      { slug: 'reporting', title: 'Income/expense reporting', file: 'accounting/reporting.md' },
      { slug: 'financial-controls', title: 'Financial controls (the money contract)', file: 'accounting/financial-controls.md' },
    ],
  },
  {
    area: 'technical',
    areaTitle: 'Technical',
    docs: [
      { slug: 'service-boards', title: 'Service boards & job lifecycle', file: 'technical/service-boards.md' },
      { slug: 'ai-seo', title: 'AI SEO 3-row split', file: 'technical/ai-seo.md' },
      { slug: 'onboarding-emails', title: 'SEO onboarding emails', file: 'technical/onboarding-emails.md' },
      { slug: 'info-attachments', title: 'Service Info & attachments', file: 'technical/info-attachments.md' },
    ],
  },
  {
    area: 'platform',
    areaTitle: 'Platform',
    docs: [
      { slug: 'email-system', title: 'Email system', file: 'platform/email-system.md' },
      { slug: 'auth-permissions', title: 'Auth, permissions & RLS', file: 'platform/auth-permissions.md' },
      { slug: 'tasks-notifications', title: 'Tasks & notifications', file: 'platform/tasks-notifications.md' },
      { slug: 'integrations', title: 'Integrations', file: 'platform/integrations.md' },
      { slug: 'monitoring', title: 'Monitoring & health', file: 'platform/monitoring.md' },
    ],
  },
];

export function loadDoc(file: string): string | null {
  const entry = Object.entries(DOCS).find(([path]) => path.endsWith(`/docs/tech/${file}`));
  return entry?.[1] ?? null;
}

export function allDocFiles(): string[] {
  return DOC_AREAS.flatMap((a) => a.docs.map((d) => d.file));
}

export function globbedFiles(): string[] {
  const marker = '/docs/tech/';
  return Object.keys(DOCS).map((p) => p.slice(p.indexOf(marker) + marker.length));
}
