import Link from "next/link";

// Header link to the setup guide: full label from sm up, short one on phones; the accessible
// name is always the full one
export function SetupLink() {
  return (
    <Link
      href="/setup"
      aria-label="Guia de configuração"
      className="flex-none text-sm text-areia underline-offset-4 transition-colors hover:text-papel hover:underline"
    >
      <span className="hidden sm:inline">Guia de configuração</span>
      <span className="sm:hidden">Configurar</span>
    </Link>
  );
}
