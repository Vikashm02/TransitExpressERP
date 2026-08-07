export default function Header() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b bg-card px-4 sm:px-6 lg:px-8">
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold text-foreground sm:text-lg">
          Transjit Express TMS
        </h2>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span className="hidden text-sm font-medium text-foreground sm:inline">
          Admin
        </span>

        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          A
        </div>
      </div>
    </header>
  );
}
