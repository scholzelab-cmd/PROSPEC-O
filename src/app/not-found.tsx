import Link from "next/link";

export default function NotFound() {
  return (
    <div className="panel mx-auto max-w-xl p-8 text-center">
      <p className="eyebrow">Página não encontrada</p>
      <h1 className="mt-3 text-3xl font-black">Este registro não existe</h1>
      <p className="mt-3 text-sm text-[var(--muted)]">
        Ele pode ter sido removido ou o endereço está incorreto.
      </p>
      <Link className="button-primary mt-6" href="/">
        Voltar à visão geral
      </Link>
    </div>
  );
}
