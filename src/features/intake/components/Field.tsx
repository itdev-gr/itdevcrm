import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** Label + control + optional help/error, in the wizard's house styling. */
export function Field({
  label,
  htmlFor,
  required = false,
  optional = false,
  optionalLabel,
  help,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string | undefined;
  required?: boolean;
  optional?: boolean;
  optionalLabel?: string | undefined;
  help?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-sm font-semibold text-[#15243b]">
        <span>{label}</span>
        {required && <span className="text-[#1a9696]">*</span>}
        {optional && optionalLabel && (
          <span className="text-xs font-normal text-[#98a2b3]">{optionalLabel}</span>
        )}
      </Label>
      {children}
      {help && <p className="text-xs leading-relaxed text-[#667085]">{help}</p>}
      {error && (
        <p role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
