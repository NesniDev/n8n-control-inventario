// Estado de la conexion en tiempo real (ver useEntregasEnVivo).
export function IndicadorEnVivo({ enVivo }: { enVivo: boolean }) {
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
        enVivo ? "border-ok/50 text-ok-fg" : "border-line-strong text-subtle"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${enVivo ? "bg-ok-fg" : "bg-subtle"}`} />
      {enVivo ? "En vivo" : "Conectando..."}
    </span>
  );
}
