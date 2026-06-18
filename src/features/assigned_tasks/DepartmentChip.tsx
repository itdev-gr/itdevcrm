import { useTranslation } from 'react-i18next';
import type { AssignedTaskDepartment } from './hooks/useAssignedTasksOpen';

export function DepartmentChip({ department }: { department: AssignedTaskDepartment | null }) {
  const { i18n } = useTranslation();
  const locale: 'en' | 'el' = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  if (!department) return null;
  return (
    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {department.display_names[locale]}
    </span>
  );
}
