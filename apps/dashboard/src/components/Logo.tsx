// Logotipo del panel: logo de la empresa (public/logo-empresa.jpg, el mismo de
// la app movil, con "Comercializadora") como unica pieza visual, sin texto al
// lado. Lleva un nombre accesible; la imagen es decorativa. La animacion de
// entrada (clase `logo-marca` en globals.css) corre una vez al montar y solo
// si `animado`; con movimiento reducido queda estatica.

import Image from "next/image";

export type TamanoLogo = "compacto" | "grande";

const NOMBRE_ACCESIBLE = "Panel de despachos, El Imperio";

const ESTILOS: Record<
  TamanoLogo,
  { raiz: string; marca: string; px: number }
> = {
  compacto: {
    raiz: "flex-row gap-2.5",
    marca: "h-10 w-10 rounded-md",
    px: 40,
  },
  grande: {
    raiz: "flex-col gap-4 text-center",
    marca: "h-28 w-28 rounded-xl",
    px: 112,
  },
};

export function Logo({
  tamano,
  animado = false,
  className = "",
}: {
  tamano: TamanoLogo;
  animado?: boolean;
  className?: string;
}) {
  const e = ESTILOS[tamano];
  return (
    <span
      role="img"
      aria-label={NOMBRE_ACCESIBLE}
      className={`inline-flex items-center ${e.raiz} ${className}`}
    >
      <Image
        src="/logo-empresa.jpg"
        alt=""
        aria-hidden
        width={e.px}
        height={e.px}
        priority
        className={`${e.marca} shrink-0 object-cover ring-1 ring-line-strong ${animado ? "logo-marca" : ""}`}
      />
    </span>
  );
}
