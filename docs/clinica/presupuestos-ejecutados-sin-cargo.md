# Presupuestos con un ítem ejecutado que no cobra

Hay presupuestos donde un ítem figura como **Ejecutado** pero el trabajo nunca se cobra: el
presupuesto muestra 0 cobrado y el saldo del paciente queda a favor. Pasa cuando el ítem se marcó
Ejecutado desde el presupuesto, sin pasar por una cita. El cobro lo crea la cita, no el
presupuesto, así que un ítem ejecutado sin cita asociada no genera ningún cargo.

Esto ya no puede volver a pasar: el sistema rechaza marcar un ítem como Ejecutado desde el
presupuesto. Los presupuestos que quedaron así se arreglan con el procedimiento de abajo.

## El procedimiento

Los cuatro pasos van **en este orden y el orden es obligatorio**. Si se intenta el paso 2 antes del
paso 1, el presupuesto no ofrece Aprobado: mientras tenga un ítem en Ejecutado, la única opción que
aparece es Cancelado.

1. En el presupuesto, editá la línea y volvé su estado a **Pendiente**.
2. Cambiá el estado del presupuesto de **Borrador** a **Aprobado** (ahora sí aparece la opción).
3. En la cita del paciente, asociá la línea a la cita, que la deja agendada.
4. Confirmá en esa cita que la línea se ejecutó. Ese paso crea el cargo.

## Lo que no hay que hacer

- **Cancelado no es el paso.** Cuando el presupuesto solo ofrece Cancelado, eso significa que
  todavía falta el paso 1, no que haya que cancelar. Cancelar el presupuesto no genera el cobro y
  saca el trabajo de la cuenta del paciente.
- **No borres ni vuelvas a cargar el presupuesto.** Borrar y reingresar no arregla nada y puede
  sacar cobros que ya estaban bien: al borrar el presupuesto se liberan las entregas reservadas y
  se pierden los cargos de las líneas que sí estaban asociadas a una cita.

## Si el estado que ves no es el que guardaste

Puede pasar que la pantalla siga mostrando el estado anterior después de guardar. **Recargá el
presupuesto** (volvé a abrirlo) antes de concluir que el paso falló. No repitas el paso ni pruebes
otro estado: lo guardado es lo que se ve después de recargar.

## Cómo saber que quedó bien

Al terminar el paso 4, el presupuesto muestra el importe de esa línea como cobrado y el saldo a
favor del paciente baja en ese mismo importe. Si el importe cobrado sigue en 0, la línea quedó
agendada pero sin confirmar: repetí el paso 4.
