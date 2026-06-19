import { Phone } from 'lucide-react';
import { phoneToTelHref } from '@/lib/phone/normalize';

type CallLinkProps = {
  phone: string | null | undefined;
  className?: string;
};

// Renders a phone number as a click-to-call tel: link (the agent's softphone
// handles the dial). Falls back to a plain placeholder when not dialable.
export function CallLink({ phone, className }: CallLinkProps) {
  const href = phoneToTelHref(phone);
  if (!href) return <span className={className}>{phone || '—'}</span>;
  return (
    <a
      href={href}
      className={
        className ??
        'inline-flex items-center gap-1 font-medium text-primary transition-colors hover:text-[#147272] hover:underline dark:text-[#7ad4d4] dark:hover:text-[#9de0e0]'
      }
      title="Κλήση"
    >
      <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {phone}
    </a>
  );
}
