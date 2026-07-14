import { useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { ImagePlus, UploadCloud, X, FileText, AlertCircle, Loader2 } from 'lucide-react';
import { MAX_FILE_BYTES, MAX_LOGO_BYTES } from '@/lib/clientIntake';
import { Button } from '@/components/ui/button';
import { IntakeApiError, fileAdded, getUploadUrl, removeFile, uploadBytes } from '../intakeApi';
import { formatBytes } from '../intakeDraft';
import type { IntakeFileRow, IntakeFileState, IntakeLogo } from '../types';

interface UploadItem {
  id: string;
  name: string;
  size: number;
  progress: number;
  error: string | null;
}

interface StepMaterialsProps {
  token: string;
  logo: IntakeLogo | null;
  files: IntakeFileRow[];
  onFileState: (state: IntakeFileState) => void;
  t: TFunction;
}

function uploadErrorMessage(err: unknown, t: TFunction): string {
  if (err instanceof IntakeApiError) {
    switch (err.code) {
      case 'logo_too_large':
        return t('materials.logo_too_large');
      case 'not_image':
        return t('materials.not_image');
      case 'file_too_large':
        return t('materials.file_too_large');
      case 'quota_exceeded':
        return t('materials.quota_exceeded');
      case 'rate_limited':
        return t('materials.rate_limited');
    }
  }
  return t('materials.upload_failed');
}

const mime = (file: File) => file.type || 'application/octet-stream';

/** Step 2 — logo (single image) + multi-file upload area. Files persist server-side. */
export function StepMaterials({ token, logo, files, onFileState, t }: StepMaterialsProps) {
  const logoInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);

  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoProgress, setLogoProgress] = useState(0);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    // Revoke the object URL on unmount so we don't leak the blob.
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  function setPreview(url: string | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setLogoPreview(url);
  }

  async function handleLogo(file: File) {
    if (!file.type.startsWith('image/')) {
      setLogoError(t('materials.not_image'));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(t('materials.logo_too_large'));
      return;
    }
    setLogoError(null);
    setPreview(URL.createObjectURL(file));
    setLogoBusy(true);
    setLogoProgress(0);
    try {
      const { signed_url, storage_path } = await getUploadUrl(token, {
        kind: 'logo',
        file_name: file.name,
        size: file.size,
        mime_type: mime(file),
      });
      await uploadBytes(signed_url, file, setLogoProgress);
      const state = await fileAdded(token, {
        kind: 'logo',
        storage_path,
        file_name: file.name,
        size: file.size,
        mime_type: mime(file),
      });
      onFileState(state);
      setPreview(null); // fall back to the persisted signed URL
    } catch (err) {
      setLogoError(uploadErrorMessage(err, t));
      setPreview(null);
    } finally {
      setLogoBusy(false);
    }
  }

  async function handleRemoveLogo() {
    setLogoError(null);
    setPreview(null);
    try {
      onFileState(await removeFile(token, { kind: 'logo' }));
    } catch {
      setLogoError(t('materials.remove_failed'));
    }
  }

  function queueFiles(list: FileList | File[]) {
    for (const file of Array.from(list)) {
      const id = crypto.randomUUID();
      if (file.size > MAX_FILE_BYTES) {
        setUploads((u) => [
          ...u,
          { id, name: file.name, size: file.size, progress: 0, error: t('materials.file_too_large') },
        ]);
        continue;
      }
      setUploads((u) => [...u, { id, name: file.name, size: file.size, progress: 0, error: null }]);
      void uploadOne(id, file);
    }
  }

  async function uploadOne(id: string, file: File) {
    try {
      const { signed_url, storage_path } = await getUploadUrl(token, {
        kind: 'file',
        file_name: file.name,
        size: file.size,
        mime_type: mime(file),
      });
      await uploadBytes(signed_url, file, (pct) =>
        setUploads((u) => u.map((it) => (it.id === id ? { ...it, progress: pct } : it))),
      );
      const state = await fileAdded(token, {
        kind: 'file',
        storage_path,
        file_name: file.name,
        size: file.size,
        mime_type: mime(file),
      });
      onFileState(state);
      setUploads((u) => u.filter((it) => it.id !== id));
    } catch (err) {
      const message = uploadErrorMessage(err, t);
      setUploads((u) => u.map((it) => (it.id === id ? { ...it, error: message } : it)));
    }
  }

  async function handleRemoveFile(fileId: string) {
    try {
      onFileState(await removeFile(token, { id: fileId }));
    } catch {
      /* leave the row; the client can retry */
    }
  }

  const showLogo = logoPreview ?? logo?.url ?? null;

  return (
    <div className="space-y-7">
      {/* Logo */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-[#15243b]">{t('materials.logo_title')}</h3>
        <p className="text-xs leading-relaxed text-[#667085]">{t('materials.logo_hint')}</p>

        <input
          ref={logoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleLogo(file);
            e.target.value = '';
          }}
        />

        {showLogo ? (
          <div className="flex items-center gap-4 rounded-xl border border-[#e8ebf0] bg-white p-3">
            <img
              src={showLogo}
              alt={logo?.file_name ?? 'logo'}
              className="size-16 shrink-0 rounded-lg object-contain ring-1 ring-black/5"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[#15243b]">
                {logo?.file_name ?? t('materials.logo_title')}
              </p>
              {logoBusy && <ProgressBar value={logoProgress} />}
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => logoInputRef.current?.click()}
                disabled={logoBusy}
                className="h-9 rounded-lg px-3 text-xs font-semibold text-[#1a9696] hover:bg-[#1a9696]/10"
              >
                {t('materials.logo_replace')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleRemoveLogo}
                disabled={logoBusy}
                aria-label={t('materials.logo_remove')}
                className="size-9 rounded-lg text-[#667085] hover:text-red-600"
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => logoInputRef.current?.click()}
            disabled={logoBusy}
            className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-[#d9dee7] bg-[#fafbfc] px-4 py-5 text-left transition-colors hover:border-[#1a9696] hover:bg-[#1a9696]/5 disabled:opacity-60"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#1a9696]/10 text-[#1a9696]">
              {logoBusy ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <ImagePlus className="size-5" />
              )}
            </span>
            <span className="text-sm">
              <span className="block font-semibold text-[#15243b]">
                {t('materials.logo_cta')}
              </span>
              <span className="block text-xs text-[#98a2b3]">{t('materials.logo_limit')}</span>
            </span>
          </button>
        )}
        {logoError && (
          <p role="alert" className="text-xs font-medium text-red-600">
            {logoError}
          </p>
        )}
      </section>

      {/* Files */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-[#15243b]">{t('materials.files_title')}</h3>
        <p className="text-xs leading-relaxed text-[#667085]">{t('materials.files_hint')}</p>

        <input
          ref={filesInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) queueFiles(e.target.files);
            e.target.value = '';
          }}
        />

        <button
          type="button"
          onClick={() => filesInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length > 0) queueFiles(e.dataTransfer.files);
          }}
          className={
            dragging
              ? 'flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-[#1a9696] bg-[#1a9696]/5 px-4 py-8 text-center transition-colors'
              : 'flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-[#d9dee7] bg-[#fafbfc] px-4 py-8 text-center transition-colors hover:border-[#1a9696] hover:bg-[#1a9696]/5'
          }
        >
          <UploadCloud className="size-7 text-[#1a9696]" />
          <span className="text-sm font-semibold text-[#15243b]">{t('materials.drop_here')}</span>
          <span className="text-xs text-[#98a2b3]">{t('materials.files_limit')}</span>
        </button>

        {(files.length > 0 || uploads.length > 0) && (
          <ul className="space-y-2 pt-1">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-3 rounded-xl border border-[#e8ebf0] bg-white px-3 py-2.5"
              >
                <FileText className="size-5 shrink-0 text-[#98a2b3]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#15243b]">{file.file_name}</p>
                  <p className="text-xs text-[#98a2b3]">{formatBytes(file.file_size)}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveFile(file.id)}
                  aria-label={t('common.remove')}
                  className="size-8 shrink-0 rounded-lg text-[#667085] hover:text-red-600"
                >
                  <X className="size-4" />
                </Button>
              </li>
            ))}

            {uploads.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-xl border border-[#e8ebf0] bg-white px-3 py-2.5"
              >
                {item.error ? (
                  <AlertCircle className="size-5 shrink-0 text-red-500" />
                ) : (
                  <Loader2 className="size-5 shrink-0 animate-spin text-[#1a9696]" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#15243b]">{item.name}</p>
                  {item.error ? (
                    <p className="text-xs font-medium text-red-600">{item.error}</p>
                  ) : (
                    <ProgressBar value={item.progress} />
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setUploads((u) => u.filter((it) => it.id !== item.id))}
                  aria-label={t('common.remove')}
                  className="size-8 shrink-0 rounded-lg text-[#667085] hover:text-red-600"
                >
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#e8ebf0]">
      <div
        className="h-full rounded-full bg-[#1a9696] transition-all duration-200"
        style={{ width: `${Math.max(4, value)}%` }}
      />
    </div>
  );
}
