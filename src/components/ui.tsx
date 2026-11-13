import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

/** Small, dependency-free UI primitives. Mobile-first with large tap targets. */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'md' | 'lg' | 'sm';

const variantClass: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-brand-700/50',
  secondary: 'bg-white text-brand-800 ring-1 ring-brand-200 hover:bg-brand-50 disabled:opacity-60',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-700/50',
  ghost: 'text-brand-800 hover:bg-brand-50 disabled:opacity-60',
};

const sizeClass: Record<Size, string> = {
  sm: 'min-h-9 px-3 text-sm',
  md: 'min-h-11 px-4 text-base',
  lg: 'min-h-14 px-5 text-lg',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra?: string) {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:cursor-not-allowed',
    variantClass[variant],
    sizeClass[size],
    extra,
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cx('rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 sm:p-6', className)}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-brand-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-neutral-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

const inputClass =
  'block w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-base text-ink shadow-sm placeholder:text-neutral-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-neutral-100';

export function Input(props: ComponentProps<'input'>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Textarea(props: ComponentProps<'textarea'>) {
  return <textarea {...props} className={cx(inputClass, 'min-h-24', props.className)} />;
}

export function Select(props: ComponentProps<'select'>) {
  return <select {...props} className={cx(inputClass, 'pr-8', props.className)} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-neutral-800">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-neutral-500">{hint}</p> : null}
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type Tone = 'neutral' | 'amber' | 'blue' | 'green' | 'red';
const toneClass: Record<Tone, string> = {
  neutral: 'bg-neutral-100 text-neutral-700 ring-neutral-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  blue: 'bg-sky-50 text-sky-800 ring-sky-200',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  red: 'bg-red-50 text-red-800 ring-red-200',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        toneClass[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Alert({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: 'neutral' | 'success' | 'error' | 'warning';
  title?: string;
  children?: ReactNode;
}) {
  const classes = {
    neutral: 'bg-brand-50 text-brand-900 ring-brand-100',
    success: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
    error: 'bg-red-50 text-red-900 ring-red-200',
    warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  }[tone];
  return (
    <div
      className={cx('rounded-xl p-3 text-sm ring-1', classes)}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? 'mt-1' : ''}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 p-6 text-center">
      <p className="font-medium text-neutral-800">{title}</p>
      {children ? <div className="mt-1 text-sm text-neutral-600">{children}</div> : null}
    </div>
  );
}
