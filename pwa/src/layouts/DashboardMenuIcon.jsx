export default function DashboardMenuIcon({ name }) {
  const common = {
    className: 'h-4 w-4',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  };

  const icons = {
    home: <path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" />,
    farm: (
      <>
        <path d="M3 21h18" />
        <path d="M5 21v-8l7-4 7 4v8" />
        <path d="M10 21v-5h4v5" />
      </>
    ),
    lot: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M12 4v16M4 12h16" />
      </>
    ),
    workers: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="16" cy="10" r="2.5" />
        <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
        <path d="M13 20a4 4 0 0 1 8 0" />
      </>
    ),
    inventory: (
      <>
        <path d="M4 7h16v13H4z" />
        <path d="M9 7V4h6v3" />
        <path d="M4 12h16" />
      </>
    ),
    spray: (
      <>
        <path d="M6 10h8l2 2v6H6z" />
        <path d="M9 10V7h4v3" />
        <path d="M16 13h3M18.5 11.5 21 10M18.5 14.5 21 16" />
      </>
    ),
    production: (
      <>
        <path d="M4 20V9M10 20V4M16 20v-7M22 20V12" />
      </>
    ),
    tasks: (
      <>
        <path d="M8 7h12M8 12h12M8 17h12" />
        <path d="m4 7 1.5 1.5L7 6.8M4 12l1.5 1.5L7 11.8M4 17l1.5 1.5L7 16.8" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </>
    ),
    assets: (
      <>
        <path d="M4 20h16M6 20V8h12v12M9 8V5h6v3" />
        <path d="M9 13h6" />
      </>
    ),
    expenses: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v8M9.5 10.5c0-1 1-1.8 2.5-1.8s2.5.8 2.5 1.8-1 1.8-2.5 1.8-2.5.8-2.5 1.8 1 1.8 2.5 1.8 2.5-.8 2.5-1.8" />
      </>
    ),
    payroll: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </>
    ),
    stats: (
      <>
        <path d="M4 20V10M10 20V6M16 20v-9M22 20V4" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 1 1-4 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 1 1 0-4h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2H9a1 1 0 0 0 .6-.9V4a2 2 0 1 1 4 0v.2a1 1 0 0 0 .6.9h.2a1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1v.2a1 1 0 0 0 .9.6H20a2 2 0 1 1 0 4h-.2a1 1 0 0 0-.9.6z" />
      </>
    ),
    password: (
      <>
        <circle cx="8.5" cy="12" r="3.5" />
        <path d="M12 12h8M17 12v2M20 12v2" />
      </>
    ),
    plan: (
      <>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M8 9h8M8 13h5" />
      </>
    ),
    factory: (
      <>
        <path d="M3 21h18" />
        <path d="M5 21V9l4 2V9l4 2V6l6 3v12" />
      </>
    ),
    avocado: (
      <>
        <path d="M12 3c4.5 0 7 3.6 7 8 0 4-2.7 8-7 8s-7-4-7-8c0-4.4 2.5-8 7-8z" />
        <circle cx="12" cy="12" r="2.2" />
      </>
    ),
    harvest: (
      <>
        <path d="M4 20h16" />
        <path d="M7 20v-6M12 20v-9M17 20v-5" />
        <path d="M6 10c1.5-1.8 3.5-2.4 6-2" />
      </>
    ),
  };

  return <svg {...common}>{icons[name] || icons.home}</svg>;
}
