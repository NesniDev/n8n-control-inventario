// "/" ya no tiene contenido propio: el antiguo "Hoy" vive arriba de /entregas.
// Redireccion del lado del servidor (la guarda de sesion del cliente se
// encarga despues de mandar a cada area a su pagina permitida).

import { redirect } from "next/navigation";

export default function Inicio() {
  redirect("/entregas");
}
