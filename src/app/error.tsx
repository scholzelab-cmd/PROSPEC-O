"use client";

export default function GlobalError({
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="panel mx-auto max-w-xl p-8 text-center">
      <p className="eyebrow">Falha inesperada</p>
      <h1 className="mt-3 text-3xl font-black">
        Não foi possível concluir esta tela
      </h1>
      <p className="mt-3 text-sm text-[var(--muted)]">
        A automação não continuará esta ação até o erro ser resolvido.
      </p>
      <button className="button-primary mt-6" onClick={reset} type="button">
        Tentar novamente
      </button>
    </div>
  );
}
