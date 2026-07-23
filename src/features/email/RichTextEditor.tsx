import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Bold, Italic, Underline, List, ListOrdered, Link2, Palette } from 'lucide-react';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { sanitizeEmailHtml } from './sanitizeEmailHtml';

const COLORS = ['#0f172a', '#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed'];

type Props = {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  ariaLabel: string;
};

export function RichTextEditor({ value, onChange, disabled, ariaLabel }: Props) {
  const { t } = useTranslation('email');
  const ref = useRef<HTMLDivElement | null>(null);

  // Load external value only when it diverges (avoids caret jumps on each keystroke).
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value) el.innerHTML = sanitizeEmailHtml(value);
  }, [value]);

  function exec(cmd: string, arg?: string) {
    if (disabled) return;
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    if (ref.current) onChange(ref.current.innerHTML);
  }

  function onLink() {
    const url = window.prompt(t('editor.link_prompt', { defaultValue: 'Enter URL:' }));
    if (url) exec('createLink', url);
  }

  const btn = 'flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40';

  return (
    <div className="rounded border">
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 p-1">
        <button type="button" className={btn} disabled={disabled} aria-label={t('editor.bold', { defaultValue: 'Bold' })} onClick={() => exec('bold')}><Bold className="size-4" /></button>
        <button type="button" className={btn} disabled={disabled} aria-label={t('editor.italic', { defaultValue: 'Italic' })} onClick={() => exec('italic')}><Italic className="size-4" /></button>
        <button type="button" className={btn} disabled={disabled} aria-label={t('editor.underline', { defaultValue: 'Underline' })} onClick={() => exec('underline')}><Underline className="size-4" /></button>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className={btn} disabled={disabled} aria-label={t('editor.color', { defaultValue: 'Text colour' })}><Palette className="size-4" /></button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-1.5"><div className="flex gap-1.5">
            {COLORS.map((c) => (
              <button key={c} type="button" aria-label={c} onClick={() => exec('foreColor', c)}
                className="size-6 rounded-full border" style={{ backgroundColor: c }} />
            ))}
          </div></PopoverContent>
        </Popover>
        <button type="button" className={btn} disabled={disabled} aria-label={t('editor.bullet_list', { defaultValue: 'Bullet list' })} onClick={() => exec('insertUnorderedList')}><List className="size-4" /></button>
        <button type="button" className={btn} disabled={disabled} aria-label={t('editor.numbered_list', { defaultValue: 'Numbered list' })} onClick={() => exec('insertOrderedList')}><ListOrdered className="size-4" /></button>
        <button type="button" className={btn} disabled={disabled} aria-label={t('editor.link', { defaultValue: 'Link' })} onClick={onLink}><Link2 className="size-4" /></button>
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        contentEditable={!disabled}
        onInput={(e) => onChange((e.currentTarget as HTMLDivElement).innerHTML)}
        className={cn('min-h-[10rem] w-full px-3 py-2 text-sm focus:outline-none', disabled && 'opacity-60')}
      />
    </div>
  );
}
