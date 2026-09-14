import Link from "next/link";

const navigation = [
  { href: "/", label: "Visão geral" },
  { href: "/leads", label: "Leads" },
  { href: "/funnels/clients", label: "Funil de clientes" },
  { href: "/funnels/affiliates", label: "Funil de afiliados" },
  { href: "/jobs", label: "Fila de jobs" },
  { href: "/experiments", label: "Experimentos" },
  { href: "/exceptions", label: "Exceções" },
  { href: "/settings", label: "Configurações" }
];

export function Sidebar({
  companyName,
  instagramHandle
}: {
  companyName: string;
  instagramHandle: string | null;
}) {
  return (
    <aside
      className="desktop-sidebar sticky top-0 h-screen border-r border-[var(--line)] bg-[#090d13]/95 p-5 backdrop-blur"
      aria-label="Navegação principal"
    >
      <div className="mb-8 flex items-center gap-3">
        <div
          className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--accent)] font-black text-[#04130d]"
          aria-hidden="true"
        >
          P
        </div>
        <div className="min-w-0">
          <p className="truncate font-bold">{companyName}</p>
          <p className="truncate text-xs text-[var(--muted)]">
            {instagramHandle ?? "Sistema comercial"}
          </p>
        </div>
      </div>

      <nav className="grid gap-1" aria-label="Seções do sistema">
        {navigation.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium text-[#bdc7d4] transition hover:bg-[var(--surface-strong)] hover:text-white"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-8 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-xs leading-5 text-[var(--muted)]">
        Primeiro contato pelo Chrome. Respostas continuam somente pela API oficial.
      </div>
    </aside>
  );
}
