import type { SVGProps, ReactNode } from 'react';
import { Guitar, Piano, Drum, MicVocal, Users, Music } from 'lucide-react';

interface IconProps extends SVGProps<SVGSVGElement> { size?: number; }

function IconBase({ size = 24, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Custom Lucide-style icons for instruments Lucide doesn't ship. */
export function ViolinIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="3.2" r="1.2" />
      <line x1="12" y1="4.4" x2="12" y2="10" />
      <ellipse cx="12" cy="15.5" rx="3.4" ry="5" />
      <path d="M10.3 13.5q-.6 1 0 2" />
      <path d="M13.7 13.5q.6 1 0 2" />
    </IconBase>
  );
}

export function ViolaIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="3" r="1.3" />
      <line x1="12" y1="4.3" x2="12" y2="9.5" />
      <ellipse cx="12" cy="15.8" rx="4" ry="5.8" />
      <path d="M9.8 13.3q-.7 1.2 0 2.4" />
      <path d="M14.2 13.3q.7 1.2 0 2.4" />
    </IconBase>
  );
}

export function CelloIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="2.6" r="1.1" />
      <line x1="12" y1="3.7" x2="12" y2="8.5" />
      <ellipse cx="12" cy="14" rx="3.6" ry="5.2" />
      <line x1="12" y1="19.2" x2="12" y2="22" />
      <path d="M10.2 12q-.6 1 0 2" />
      <path d="M13.8 12q.6 1 0 2" />
    </IconBase>
  );
}

export function DoubleBassIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="2.4" r="1" />
      <line x1="12" y1="3.4" x2="12" y2="7.5" />
      <ellipse cx="12" cy="13.5" rx="4.6" ry="6" />
      <line x1="12" y1="19.5" x2="12" y2="22.5" />
      <path d="M9.8 11q-.8 1.4 0 2.8" />
      <path d="M14.2 11q.8 1.4 0 2.8" />
    </IconBase>
  );
}

export function UkuleleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="9.5" y="2" width="5" height="2.6" rx="0.6" />
      <line x1="10.3" y1="4.6" x2="10.3" y2="11" />
      <line x1="13.7" y1="4.6" x2="13.7" y2="11" />
      <circle cx="12" cy="16" r="4.8" />
      <circle cx="12" cy="16" r="1.6" />
    </IconBase>
  );
}

const INSTRUMENT_ICON_MAP: Record<string, (props: IconProps) => ReactNode> = {
  guitar: (p) => <Guitar {...p} />,
  piano: (p) => <Piano {...p} />,
  drums: (p) => <Drum {...p} />,
  vocal: (p) => <MicVocal {...p} />,
  violin: (p) => <ViolinIcon {...p} />,
  'suzuki violin': (p) => <ViolinIcon {...p} />,
  viola: (p) => <ViolaIcon {...p} />,
  cello: (p) => <CelloIcon {...p} />,
  bass: (p) => <DoubleBassIcon {...p} />,
  ukulele: (p) => <UkuleleIcon {...p} />,
  ensemble: (p) => <Users {...p} />,
};

/** Looks up the right icon (custom or Lucide) for an instrument/group name. Falls back to a generic note. */
export function InstrumentIcon({ name, ...props }: IconProps & { name: string }) {
  const render = INSTRUMENT_ICON_MAP[name.toLowerCase()];
  return render ? <>{render(props)}</> : <Music {...props} />;
}
