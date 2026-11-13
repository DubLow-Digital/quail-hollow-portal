'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/components/ui';

const LINKS = [
  { href: '/admin', label: 'Dashboard', exact: true },
  { href: '/admin/clients', label: 'Clients' },
  { href: '/admin/document-types', label: 'Document types' },
  { href: '/admin/bundles', label: 'Bundles' },
  { href: '/admin/audit', label: 'Audit log' },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="mx-auto max-w-6xl overflow-x-auto px-2">
      <ul className="flex gap-1">
        {LINKS.map((link) => {
          const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm',
                  active
                    ? 'border-accent-400 font-semibold text-white'
                    : 'border-transparent text-brand-100 hover:text-white',
                )}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
