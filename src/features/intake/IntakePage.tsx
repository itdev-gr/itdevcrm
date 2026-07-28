import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ArrowRight, ChevronLeft, Loader2, Check, PartyPopper } from 'lucide-react';
import { missingItems } from '@/lib/clientIntake';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/lib/documentTitle';
import {
  IntakeApiError,
  loadForm,
  saveDraft,
  submitForm,
} from './intakeApi';
import {
  EMPTY_FORM_STATE,
  computePatch,
  hydrateFormState,
  mergeDraft,
  normalizeForServer,
} from './intakeDraft';
import { firstErrorStep, validateAll, validateStep } from './intakeValidation';
import { StepAbout } from './steps/StepAbout';
import { StepMaterials } from './steps/StepMaterials';
import { StepWebsite } from './steps/StepWebsite';
import { StepReview } from './steps/StepReview';
import type {
  IntakeFieldErrors,
  IntakeFieldKey,
  IntakeFileRow,
  IntakeFileState,
  IntakeFormState,
  IntakeLang,
  IntakeLogo,
} from './types';

const TOTAL_STEPS = 4;
const DRAFT_PREFIX = 'intake-draft-';
const AUTOSAVE_MS = 800;
const RETRY_MS = 4000;

type Phase = 'loading' | 'error' | 'form' | 'success';

function loadLocalDraft(token: string): IntakeFormState | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + token);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return hydrateFormState(parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}

function saveLocalDraft(token: string, state: IntakeFormState): void {
  try {
    localStorage.setItem(DRAFT_PREFIX + token, JSON.stringify(state));
  } catch {
    /* private mode / quota — the server draft is the real backstop */
  }
}

function normalizeLang(value: string | null | undefined): IntakeLang {
  return value === 'en' ? 'en' : 'el';
}

export function IntakePage() {
  const { token = '' } = useParams<{ token: string }>();
  const { i18n } = useTranslation('intake');

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorCode, setErrorCode] = useState<string>('generic');
  const [lang, setLang] = useState<IntakeLang>('el');

  const [form, setForm] = useState<IntakeFormState>(EMPTY_FORM_STATE);
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<IntakeFieldErrors>({});

  const [clientName, setClientName] = useState<string | null>(null);
  const [logo, setLogo] = useState<IntakeLogo | null>(null);
  const [files, setFiles] = useState<IntakeFileRow[]>([]);
  const [initialStatus, setInitialStatus] = useState<string>('draft');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitMissing, setSubmitMissing] = useState<string[]>([]);

  const t = useMemo<TFunction>(() => i18n.getFixedT(lang, 'intake'), [i18n, lang]);

  const formRef = useRef(form);
  const lastSavedRef = useRef<IntakeFormState>(EMPTY_FORM_STATE);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Holds the latest autosave implementation so timers can call it without the
  // callback referencing itself (which the react-hooks rules forbid).
  const flushRef = useRef<() => void>(() => {});

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  useDocumentTitle(clientName ? `${clientName} · ${t('meta.title')}` : t('meta.title'));

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) {
      setErrorCode('not_found');
      setPhase('error');
      return;
    }
    let cancelled = false;
    setPhase('loading');
    loadForm(token)
      .then((res) => {
        if (cancelled) return;
        const server = hydrateFormState(res.data);
        lastSavedRef.current = server;
        setForm(mergeDraft(res.data, loadLocalDraft(token)));
        setClientName(res.client_name);
        setLogo(res.logo);
        setFiles(res.files);
        setInitialStatus(res.status);
        setLang(normalizeLang(res.locale));
        setPhase('form');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorCode(err instanceof IntakeApiError ? err.code : 'generic');
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // ── Autosave (debounced patch diff, silent 429 retry) ───────────────────────
  useEffect(() => {
    flushRef.current = () => {
      const current = formRef.current;
      const patch = computePatch(lastSavedRef.current, current);
      if (Object.keys(patch).length === 0) return;
      saveDraft(token, { patch })
        .then(() => {
          lastSavedRef.current = current;
        })
        .catch((err: unknown) => {
          if (err instanceof IntakeApiError && err.status === 429) {
            if (retryTimer.current) clearTimeout(retryTimer.current);
            retryTimer.current = setTimeout(() => flushRef.current(), RETRY_MS);
          }
          // Other failures: the localStorage copy holds; the next edit reschedules.
        });
    };
  }, [token]);

  useEffect(() => {
    if (phase !== 'form') return;
    saveLocalDraft(token, form);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => flushRef.current(), AUTOSAVE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [form, phase, token]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  // ── Handlers ────────────────────────────────────────────────────────────────
  const updateForm = useCallback((partial: Partial<IntakeFormState>) => {
    setForm((f) => ({ ...f, ...partial }));
  }, []);

  const onFileState = useCallback((state: IntakeFileState) => {
    setLogo(state.logo);
    setFiles(state.files);
  }, []);

  function changeLang(next: IntakeLang) {
    if (next === lang) return;
    setLang(next);
    saveDraft(token, { locale: next }).catch(() => {
      /* language is cosmetic; ignore save failures */
    });
  }

  function scrollTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goNext() {
    const stepErrors = validateStep(step, form, t);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      return;
    }
    setErrors({});
    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
    scrollTop();
  }

  function goBack() {
    setErrors({});
    setStep((s) => Math.max(1, s - 1));
    scrollTop();
  }

  function goToStep(target: number) {
    setStep(target);
    scrollTop();
  }

  async function handleSubmit() {
    const allErrors = validateAll(form, t);
    if (Object.keys(allErrors).length > 0) {
      setErrors(allErrors);
      const target = firstErrorStep(allErrors);
      if (target) goToStep(target);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await submitForm(token, {
        data: normalizeForServer(form),
        locale: lang,
      });
      lastSavedRef.current = form;
      setSubmitMissing(res.missing_items);
      setInitialStatus('submitted');
      setPhase('success');
      scrollTop();
    } catch (err) {
      if (err instanceof IntakeApiError && err.status === 400 && err.fields) {
        const mapped: IntakeFieldErrors = {};
        for (const key of Object.keys(err.fields) as IntakeFieldKey[]) {
          mapped[key] = t('errors.invalid');
        }
        setErrors(mapped);
        const target = firstErrorStep(mapped);
        if (target) goToStep(target);
      } else {
        setSubmitError(t('errors.submit_failed'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const liveMissing = useMemo(
    () =>
      missingItems({
        logo_path: logo?.path ?? null,
        fileCount: files.length,
        data: normalizeForServer(form),
      }),
    [logo, files, form],
  );

  const stepTitle = t(`steps.${['about', 'materials', 'website', 'review'][step - 1]}.title`);
  const stepSubtitle = t(
    `steps.${['about', 'materials', 'website', 'review'][step - 1]}.subtitle`,
  );

  return (
    <Shell lang={lang} onLang={changeLang} t={t}>
      {phase === 'loading' && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="size-7 animate-spin text-[#1a9696]" />
        </div>
      )}

      {phase === 'error' && <StatusScreen code={errorCode} t={t} />}

      {phase === 'success' && (
        <SuccessScreen
          missing={submitMissing}
          onBack={() => {
            setPhase('form');
            goToStep(1);
          }}
          t={t}
        />
      )}

      {phase === 'form' && (
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5 sm:p-8">
          {/* Whose form this is — a wrong recipient must see it immediately
              (real case: two clients shared one link and mixed their data). */}
          {clientName && (
            <div className="mb-5 inline-flex max-w-full items-center gap-2 rounded-full bg-[#15243b]/5 px-3 py-1.5 text-sm font-semibold text-[#15243b] ring-1 ring-[#15243b]/10">
              <span className="truncate">{t('chrome.form_for', { name: clientName })}</span>
            </div>
          )}
          {initialStatus === 'submitted' && (
            <div className="mb-5 rounded-xl bg-[#1a9696]/8 px-4 py-3 text-sm text-[#0f5f5f] ring-1 ring-[#1a9696]/20">
              {t('resubmit_banner')}
            </div>
          )}

          {/* Progress */}
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between text-xs font-medium text-[#667085]">
              <span>{t('chrome.step_of', { current: step, total: TOTAL_STEPS })}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e8ebf0]">
              <div
                className="h-full rounded-full bg-[#1a9696] transition-all duration-300 ease-out"
                style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
              />
            </div>
          </div>

          {/* Heading */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight text-[#15243b]">{stepTitle}</h1>
            <p className="mt-1 text-sm text-[#667085]">{stepSubtitle}</p>
          </div>

          {/* Step body */}
          {step === 1 && (
            <StepAbout form={form} updateForm={updateForm} errors={errors} t={t} />
          )}
          {step === 2 && (
            <StepMaterials
              token={token}
              logo={logo}
              files={files}
              onFileState={onFileState}
              t={t}
            />
          )}
          {step === 3 && (
            <StepWebsite form={form} updateForm={updateForm} errors={errors} t={t} />
          )}
          {step === 4 && (
            <StepReview
              form={form}
              logo={logo}
              files={files}
              missing={liveMissing}
              onEdit={goToStep}
              t={t}
            />
          )}

          {submitError && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-600">
              {submitError}
            </p>
          )}

          {/* Footer */}
          <div className="mt-8 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={goBack}
              disabled={step === 1}
              className="h-11 rounded-full border-[#d9dee7] px-5 text-sm font-semibold text-[#15243b] disabled:opacity-40"
            >
              <ChevronLeft className="size-4" />
              {t('chrome.back')}
            </Button>

            {step < TOTAL_STEPS ? (
              <Button
                type="button"
                onClick={goNext}
                className="h-11 rounded-full bg-[#1a9696] px-6 text-sm font-semibold text-white hover:bg-[#178787]"
              >
                {t('chrome.next')}
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="h-11 rounded-full bg-[#1a9696] px-6 text-sm font-semibold text-white hover:bg-[#178787]"
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                {submitting ? t('chrome.submitting') : t('chrome.submit')}
              </Button>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({
  lang,
  onLang,
  t,
  children,
}: {
  lang: IntakeLang;
  onLang: (l: IntakeLang) => void;
  t: TFunction;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f6f8fb] text-[#15243b]">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-5 pt-6 pb-2 sm:px-8">
        <img src="/logoitdev.png" alt="IT DEV" className="h-8 w-auto object-contain sm:h-9" />
        <LangToggle lang={lang} onLang={onLang} t={t} />
      </header>
      <main className="mx-auto max-w-2xl px-5 pb-16 pt-4 sm:px-8">{children}</main>
    </div>
  );
}

function LangToggle({
  lang,
  onLang,
  t,
}: {
  lang: IntakeLang;
  onLang: (l: IntakeLang) => void;
  t: TFunction;
}) {
  return (
    <div
      className="inline-flex items-center rounded-full bg-white p-0.5 text-xs font-semibold ring-1 ring-[#e8ebf0]"
      role="group"
      aria-label={t('lang.label')}
    >
      {(['el', 'en'] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => onLang(code)}
          aria-pressed={lang === code}
          className={
            lang === code
              ? 'rounded-full bg-[#1a9696] px-3 py-1.5 text-white'
              : 'rounded-full px-3 py-1.5 text-[#667085] hover:text-[#15243b]'
          }
        >
          {t(`lang.${code}`)}
        </button>
      ))}
    </div>
  );
}

function StatusScreen({ code, t }: { code: string; t: TFunction }) {
  const isNetwork = code === 'generic' || code === 'unknown';
  return (
    <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5">
      <h1 className="text-xl font-bold text-[#15243b]">
        {isNetwork ? t('status.error_title') : t('status.inactive_title')}
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#667085]">
        {isNetwork ? t('status.error_body') : t('status.inactive_body')}
      </p>
      {isNetwork && (
        <Button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 h-11 rounded-full bg-[#1a9696] px-6 text-sm font-semibold text-white hover:bg-[#178787]"
        >
          {t('status.retry')}
        </Button>
      )}
    </div>
  );
}

function SuccessScreen({
  missing,
  onBack,
  t,
}: {
  missing: string[];
  onBack: () => void;
  t: TFunction;
}) {
  return (
    <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5">
      <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-[#1a9696]/10">
        <PartyPopper className="size-7 text-[#1a9696]" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-[#15243b]">{t('success.title')}</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[#667085]">
        {t('success.body')}
      </p>

      {missing.length > 0 && (
        <div className="mx-auto mt-6 max-w-md rounded-xl border border-amber-200 bg-amber-50 p-4 text-left">
          <p className="text-sm font-semibold text-amber-900">{t('success.missing_intro')}</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {missing.map((key) => (
              <li
                key={key}
                className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900"
              >
                {t(`missing.${key}`)}
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-xs text-amber-800">{t('success.link_active')}</p>
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        onClick={onBack}
        className="mt-6 h-11 rounded-full border-[#d9dee7] px-6 text-sm font-semibold text-[#15243b]"
      >
        {t('success.back_to_form')}
      </Button>
    </div>
  );
}
