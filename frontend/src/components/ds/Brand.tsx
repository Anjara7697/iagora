/** La marque telle que le code l'a toujours montrée : tuile sombre « ▪ », nom et version. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em] text-foreground">
      <span
        aria-hidden="true"
        className="inline-flex size-6 items-center justify-center rounded-md bg-foreground text-[22px] leading-none text-brand-mark"
      >
        ▪
      </span>
      {/* Menu réduit : la tuile seule ; le nom reste lu par les lecteurs d'écran. */}
      <span className={compact ? "sr-only" : undefined}>IAGORA</span>
      {!compact && (
        <span className="rounded-sm border border-border px-1.5 text-[11px] font-normal text-muted">
          2.0
        </span>
      )}
    </span>
  );
}
