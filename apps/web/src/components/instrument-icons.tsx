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

/**
 * Custom Lucide-style icons for instruments Lucide doesn't ship.
 * Each uses a different body silhouette (not just a scaled ellipse) so the
 * violin family reads as visually distinct at a glance — violin is a narrow
 * front-on hourglass, viola is the same shape shown at an angle, cello has
 * flat wide shoulders, bass guitar is a different instrument family entirely.
 */
export function ViolinIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="3" r="1" />
      <line x1="12" y1="4" x2="12" y2="9.2" />
      <path d="M9 11c0-1.4.7-2.4 3-2.4s3 1 3 2.4c0 1.3-1 1.9-1.8 2.8-.5.6-.9 1.3-1.2 2.2-.3-.9-.7-1.6-1.2-2.2-.8-.9-1.8-1.5-1.8-2.8Z" />
      <path d="M8.6 17.4c0 1.6.7 2.7 3.4 2.7s3.4-1.1 3.4-2.7c0-1.1-.7-1.7-1.6-2.4" />
      <path d="M10.4 13q-.5.8 0 1.6" />
      <path d="M13.6 13q.5.8 0 1.6" />
    </IconBase>
  );
}

export function ViolaIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <g transform="rotate(18 12 12)">
        <circle cx="12" cy="2.6" r="1.1" />
        <line x1="12" y1="3.7" x2="12" y2="9.3" />
        <path d="M8.6 11.3c0-1.5.8-2.6 3.4-2.6s3.4 1.1 3.4 2.6c0 1.4-1.1 2.1-2 3.1-.6.6-1 1.4-1.4 2.4-.4-1-.8-1.8-1.4-2.4-.9-1-2-1.7-2-3.1Z" />
        <path d="M8.1 18.1c0 1.8.8 3 3.9 3s3.9-1.2 3.9-3c0-1.2-.8-1.9-1.8-2.6" />
      </g>
    </IconBase>
  );
}

export function CelloIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="2.4" r="1" />
      <line x1="12" y1="3.4" x2="12" y2="7.6" />
      <path d="M7.6 9.2c0-.9.5-1.6 4.4-1.6s4.4.7 4.4 1.6c0 1-.9 1.5-1.8 2.3-1.2 1-2 2.3-2.6 3.8-.6-1.5-1.4-2.8-2.6-3.8-.9-.8-1.8-1.3-1.8-2.3Z" />
      <path d="M7.1 17.4c0 2 1 3.5 4.9 3.5s4.9-1.5 4.9-3.5c0-1.3-.9-2.1-2.1-2.9" />
      <line x1="12" y1="21.5" x2="12" y2="23.5" />
      <path d="M10 12.5q-.5.9 0 1.8" />
      <path d="M14 12.5q.5.9 0 1.8" />
    </IconBase>
  );
}

export function BassGuitarIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="9.3" y="1" width="3.6" height="2.4" rx="0.5" />
      <circle cx="10.1" cy="1.7" r="0.35" fill="currentColor" />
      <circle cx="11.9" cy="1.7" r="0.35" fill="currentColor" />
      <line x1="11.1" y1="3.4" x2="11.6" y2="13" />
      <path d="M10.8 13c-2.8.2-4.3 1.6-4.3 3.6 0 2.4 2 4.2 5.3 4.2 1 0 1.9-.2 2.6-.5.9-.4 1.7-.4 2.4.2.5.5 1.3.6 1.9.1.7-.5.7-1.5 0-2.1-1-.9-1.1-1.8-.6-2.7.5-1 .4-2.1-.6-2.8-1.4-1-3.7-.2-6.7.2Z" />
      <line x1="8.5" y1="15.8" x2="15.5" y2="16.6" />
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
  'susuki violin': (p) => <ViolinIcon {...p} />,
  viola: (p) => <ViolaIcon {...p} />,
  cello: (p) => <CelloIcon {...p} />,
  'bass guitar': (p) => <BassGuitarIcon {...p} />,
  ukulele: (p) => <UkuleleIcon {...p} />,
  ensemble: (p) => <Users {...p} />,
};

/** Looks up the right icon (custom or Lucide) for an instrument/group name. Falls back to a generic note. */
export function InstrumentIcon({ name, ...props }: IconProps & { name: string }) {
  const render = INSTRUMENT_ICON_MAP[name.toLowerCase()];
  return render ? <>{render(props)}</> : <Music {...props} />;
}
