// Renders plain text with bare http(s):// URLs turned into clickable links —
// e.g. a pasted YouTube link in a note just works, no embed player needed.
export function linkify(text: string): React.ReactNode[] {
  return text.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part)
      ? <a key={i} href={part} target="_blank" rel="noreferrer" className="underline break-all" style={{ color: 'var(--sage-dk)' }}>{part}</a>
      : part
  );
}
