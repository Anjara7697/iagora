/** La marque telle que le code l'a toujours montrée : tuile sombre « ▪ », nom et version. */
export function Brand() {
  return (
    <span className="flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em] text-foreground">
      <span
        aria-hidden="true"
        className="inline-flex size-6 items-center justify-center rounded-md bg-foreground text-[22px] leading-none text-[#a79bf0]"
      >
        ▪
      </span>
      IAGORA
      <span className="rounded-sm border border-border px-1.5 font-mono text-[11px] font-normal text-muted">
        2.0
      </span>
    </span>
  );
}
