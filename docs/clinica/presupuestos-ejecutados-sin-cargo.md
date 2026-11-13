# Presupuestos en Borrador con una línea Ejecutada: no los toques, salvo el grupo de 7

## Corrección

Lo que decía este documento antes estaba equivocado. El procedimiento de cuatro pasos que se
publicó para estos presupuestos no hay que aplicarlo, y si ya empezaste a hacerlo, pará donde estás
y avisá. Estos presupuestos no tienen el problema que ese procedimiento suponía.

## Cómo reconocer uno de estos registros

Es un presupuesto en estado **Borrador** que tiene una línea en estado **Ejecutado**. Es la
combinación que antes se creía rota. Si ves esa combinación, no hace falta arreglar nada.

## Lo que se midió

Se revisaron todos los registros con esa combinación, 48 en total. Esto es lo medido, no una
suposición:

- 41 ya están cobrados: el trabajo figura asociado a una cita y se cobra, o la cita ya lleva su
  propio importe. En esos casos no falta ningún cargo.
- 7 tienen la línea asociada solo a una cita cancelada o dada de baja.

## Qué hacer

Para los 41 que ya están cobrados, una sola cosa: avisá cuál es el registro y no cambies nada. Con
el aviso alcanza; no hay nada que corregir en pantalla.

Para el grupo de 7, el de la cita dada de baja, **ahora sí hay un procedimiento** y es tuyo:
[Recuperar las citas borradas que se habían llevado el cobro de un
trabajo](recuperar-citas-borradas-con-trabajo-ejecutado.md). Seguilo solo con la lista aprobada en
la mano, y solo para las citas que estén en esa lista.

## Lo que no hay que hacer

- **No vuelvas la línea a Pendiente.**
- **No pases el presupuesto de Borrador a Aprobado.**
- **No canceles el presupuesto.** Cancelarlo no genera ningún cobro y saca el trabajo de la cuenta
  del paciente.
- **No borres ni vuelvas a cargar el presupuesto.** Borrar y reingresar no arregla nada y puede
  sacar cobros que ya estaban bien: al borrar el presupuesto se liberan las entregas reservadas y
  se pierden los cargos de las líneas que sí estaban asociadas a una cita.

## Lo que queda abierto

El grupo chico de 7, el de la cita dada de baja, ya se midió: esos 7 **sí** tienen trabajo sin
cobrar, y la causa es que la cita a la que estaba asociado el trabajo fue borrada; al borrarse se
llevó el cobro. Eso ya no está en estudio y ya tiene procedimiento: se arregla restaurando la cita
desde la pantalla de Citas, que es algo que podés hacer vos.

El cómo está en [Recuperar las citas borradas que se habían llevado el cobro de un
trabajo](recuperar-citas-borradas-con-trabajo-ejecutado.md), que además explica por qué esto
reemplaza el "esas 7 las arreglo yo, no toques nada" del 12 de noviembre.

Lo único que queda abierto es cuáles son las citas exactas: no se aplica nada antes de que te
llegue la lista aprobada.
