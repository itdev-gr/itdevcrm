import { useState } from 'react';
import type { MouseEvent } from 'react';

type Props = {
  code: string;
  className?: string;
};

export function CopyableCode({ code, className = '' }: Props) {
  const [copied, setCopied] = useState(false);

  async function onClick(e: MouseEvent<HTMLButtonElement>) {
    // Prevent the surrounding <Link>/draggable wrapper from grabbing the click.
    e.preventDefault();
    e.stopPropagation();
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(code);
      } else {
        const ta = document.createElement('textarea');
        ta.value = code;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard may be unavailable; fall through silently */
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      title={copied ? 'Copied!' : 'Click to copy'}
      className={`rounded bg-muted px-1.5 py-0.5 font-mono hover:bg-muted ${
        copied ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'
      } ${className}`}
    >
      {copied ? '✓ ' : ''}
      {code}
    </button>
  );
}
