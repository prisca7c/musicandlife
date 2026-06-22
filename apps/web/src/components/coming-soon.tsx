export function ComingSoon({ phase, title }: { phase: number; title: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center">
      <div className="text-4xl mb-4">🚧</div>
      <h2 className="text-xl font-semibold text-gray-700 mb-2">{title}</h2>
      <p className="text-sm text-gray-400">Coming in Phase {phase}</p>
    </div>
  );
}
