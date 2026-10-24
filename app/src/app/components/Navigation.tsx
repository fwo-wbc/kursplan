'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarDays,
  CalendarRange,
  Users,
  ArrowRightLeft,
  LayoutDashboard,
  Bookmark,
  Tags,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Hauptnavigation in drei logische Blöcke gegliedert, optisch getrennt
 * durch dezente vertikale Trennlinien:
 *
 * - Block „Kurse“:    Kursmanagement, Monatsübersicht, Reservierungen
 * - Block „Personal“: Trainerverfügbarkeiten, Trainer verwalten
 * - Block „System“:   Kurstransfer (der Sync-Button sitzt unten in der
 *                     Aktionszeile der Kursmanagement-Seite)
 */
type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  external?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Kurse',
    items: [
      { href: '/', label: 'Kursmanagement', icon: LayoutDashboard },
      { href: '/kalender', label: 'Monatsübersicht', icon: CalendarDays },
      { href: '/reservierungen', label: 'Reservierungen', icon: Bookmark },
      {
        href: '/kursthemen',
        label: 'Kursthemen',
        icon: Tags,
      },
    ],
  },
  {
    label: 'Personal',
    items: [
      {
        href: '/trainer/verfuegbarkeit',
        label: 'Trainerverfügbarkeiten',
        icon: CalendarRange,
      },
      { href: '/trainer', label: 'Trainer verwalten', icon: Users },
    ],
  },
  {
    label: 'System',
    items: [
      {
        href: '/Kurstransfer/index.html',
        label: 'Kurstransfer',
        icon: ArrowRightLeft,
        external: true,
      },
    ],
  },
];

// Flache Liste über alle Blöcke, wird nur für die Aktiverkennung verwendet.
const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

export default function Navigation() {
  const pathname = usePathname();

  // Aktiverkennung über "längsten Präfix-Treffer": Ein Unterpfad wie
  // /trainer/zeitplan markiert den übergeordneten Menüpunkt (/trainer),
  // während /trainer/verfuegbarkeit weiterhin exakt seinem eigenen Eintrag
  // zugeordnet bleibt (keine Doppel-Markierung).
  const aktiverHref =
    [...NAV_ITEMS]
      .filter(
        (item) =>
          pathname === item.href ||
          (item.href !== '/' &&
            pathname.startsWith(item.href.endsWith('/') ? item.href : `${item.href}/`))
      )
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;

  return (
    <nav
      className="flex flex-wrap items-center gap-1"
      aria-label="Hauptnavigation"
    >
      {NAV_GROUPS.map((group, groupIndex) => {
        return (
          <div
            key={group.label}
            className={`flex flex-wrap items-center gap-1 ${
              groupIndex > 0 ? 'border-l border-slate-300 pl-4 ml-2' : ''
            }`}
          >
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = aktiverHref === item.href;

              // Statische HTML-Datei (Kurstransfer) liegt außerhalb der Next.js-Routen
              // und wird deshalb als normales <a>-Element gerendert.
              if (item.external) {
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  >
                    <Icon className="w-4 h-4 text-cd-blue" />
                    {item.label}
                  </a>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                    isActive
                      ? 'bg-cd-blue text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 ${isActive ? 'text-white' : 'text-cd-blue'}`}
                  />
                  {item.label}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}