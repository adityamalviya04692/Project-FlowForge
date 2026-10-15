import type { ReactNode, SVGProps } from 'react';
import type { NodeKind } from '../pipeline/types';

const PATHS: Record<NodeKind, ReactNode> = {
  source: (
    <>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
      <path d="M4.5 5.5v6c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8v-6" />
      <path d="M4.5 11.5v6c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8v-6" />
    </>
  ),
  filter: <path d="M3.5 5h17l-6.5 7.6V18l-4 2v-7.4z" />,
  select: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15M14.5 4.5v15" />
    </>
  ),
  derive: <path d="M9 20.5c2.2 0 2.7-1.6 3.2-4.2l2-9.3c.5-2.4 1.1-3.5 3.3-3.5M8 10.5h8.5" />,
  dedupe: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
      <path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  window: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M3.5 15h17M9.5 10v9.5" />
    </>
  ),
  sort: <path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5" />,
  join: (
    <>
      <circle cx="9" cy="12" r="5.8" />
      <circle cx="15" cy="12" r="5.8" />
    </>
  ),
  aggregate: <path d="M18 4.5H6.5l6 7.5-6 7.5H18" />,
  union: <path d="M6.5 4v8a5.5 5.5 0 0 0 11 0V4" />,
  quality: (
    <>
      <path d="M12 3 4.5 6v5.6c0 4.6 3.2 8.2 7.5 9.4 4.3-1.2 7.5-4.8 7.5-9.4V6z" />
      <path d="m9 12 2.2 2.2L15.2 10" />
    </>
  ),
  output: <path d="M12 3.5V15M7.5 10.5 12 15l4.5-4.5M5 20.5h14" />,
};

type P = SVGProps<SVGSVGElement> & { size?: number };

const svg = (children: ReactNode, { size = 18, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    {children}
  </svg>
);

export const KindIcon = ({ kind, ...p }: P & { kind: NodeKind }) => svg(PATHS[kind], p);

export const Icon = {
  play: (p: P = {}) => svg(<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />, p),
  save: (p: P = {}) => svg(<><path d="M5 3.5h11l3.5 3.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5Z" /><path d="M7.5 3.5v5h8v-5M7.5 20.5v-6h9v6" /></>, p),
  open: (p: P = {}) => svg(<path d="M3.5 7.5V18A1.5 1.5 0 0 0 5 19.5h14a1.5 1.5 0 0 0 1.5-1.5V9.5A1.5 1.5 0 0 0 19 8h-7l-2-3H5a1.5 1.5 0 0 0-1.5 1.5Z" />, p),
  tidy: (p: P = {}) => svg(<><rect x="3.5" y="4" width="6" height="5" rx="1.5" /><rect x="14.5" y="4" width="6" height="5" rx="1.5" /><rect x="9" y="15" width="6" height="5" rx="1.5" /><path d="M6.5 9v2.5h11V9M12 11.5V15" /></>, p),
  search: (p: P = {}) => svg(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>, p),
  trash: (p: P = {}) => svg(<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />, p),
  sparkle: (p: P = {}) => svg(<path d="M12 3.5 13.8 9 19.5 10.5 13.8 12 12 17.5 10.2 12 4.5 10.5 10.2 9z" />, p),
  upload: (p: P = {}) => svg(<path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15" />, p),
  github: (p: P = {}) => svg(<path d="M9 19c-4 1.3-4-2-5.5-2.5M14.5 21v-3.4c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.7 4.7 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6.2 0C6.1 2.9 5.1 3.2 5.1 3.2a4.3 4.3 0 0 0-.1 3.2A4.7 4.7 0 0 0 3.7 9.6c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />, p),
  code: (p: P = {}) => svg(<path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5" />, p),
  table: (p: P = {}) => svg(<><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M3.5 15h17M10 4.5v15" /></>, p),
  alert: (p: P = {}) => svg(<><path d="M12 3.5 2.8 19.5h18.4z" /><path d="M12 10v4M12 17v.5" /></>, p),
  download: (p: P = {}) => svg(<path d="M12 4v11.5M7.5 11 12 15.5 16.5 11M4.5 20h15" />, p),
  copy: (p: P = {}) => svg(<><rect x="8.5" y="8.5" width="12" height="12" rx="2.5" /><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" /></>, p),
};
