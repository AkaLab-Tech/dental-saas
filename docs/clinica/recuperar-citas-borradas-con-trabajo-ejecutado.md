# Recuperar las citas borradas que se habían llevado el cobro de un trabajo

## Nota de entrega: esto reemplaza lo que te dijimos el 12 de noviembre

El 12 de noviembre te dijimos: *"esas 7 las arreglo yo desde el sistema, no toques nada"*. **Eso ya
no vale: ahora las vas a arreglar vos, y son dos clics.**

Por qué cambió: cuando se buscó cómo repararlas en la base de datos apareció que no hacía falta
ninguna reparación. Lo que pasó es que esas citas fueron **borradas**, y al borrarse se llevaron el
cobro del trabajo que ya estaba hecho. Restaurar la cita vuelve a traer el cobro, y restaurar una
cita es un botón que ya tenés en pantalla. No hace falta tocar la base de datos, y tampoco hace
falta esperar a nadie. Era mejor avisarte esto que dejarte esperando un arreglo que nunca iba a
llegar por otro lado.

Es la segunda vez en pocos días que te corregimos una instrucción (la otra fue la de los
presupuestos en Borrador). No es que las instrucciones se improvisen: se mide primero, y cuando lo
medido contradice lo que se dijo, se avisa en lugar de dejarlo pasar.

## Antes de empezar: esperá la lista firmada

**No restaures nada por tu cuenta.** Vas a recibir una lista con las citas exactas: fecha, hora y
el trabajo que cada una tiene asociado. Esa lista sale de una medición sobre los datos reales y hay
que revisarla y aprobarla antes de aplicar nada.

- Son **7 trabajos** en total. Si la lista que te llega trae otra cantidad, avisá antes de tocar.
- Si una cita no está en la lista, **no la restaures**, aunque se parezca.

## Qué pasó, en una línea

Alguien borró una cita que ya se había hecho, y el trabajo del presupuesto que estaba asociado a
esa cita dejó de cobrarse. El trabajo figura como **Ejecutado**, pero no aparece en la cuenta del
paciente.

## Paso a paso, por cada cita de la lista

1. Mirá en la lista la **fecha** de la cita.
2. Entrá a **Citas** y movete con las flechas hasta el mes de esa fecha.
3. Abrí **Filtro** y tildá **Mostrar canceladas**. La cita borrada aparece en gris, apagada.
4. En la tarjeta de esa cita, abrí el menú de los tres puntos (**⋮**) y elegí **Restaurar**.
   Tiene que aparecer el aviso *"Cita restaurada exitosamente"*. **Acá vuelve el cobro.**
5. En la misma tarjeta, abrí otra vez **⋮** y elegí **Marcar completada**. Se abre *Completar
   cita*: el trabajo ya ejecutado aparece listado con la etiqueta **Ya ejecutado** y la casilla
   tildada y bloqueada. **No tildes nada más y no escribas ningún importe.** Confirmá con
   **Marcar completada**.
6. Entrá a la cuenta del paciente y comprobá que el trabajo ahora figura cobrado. Si el importe que
   ves no coincide con el de la lista, pará y avisá.

El paso 4 es el que recupera la plata. El paso 5 no cobra nada: deja la cita como realmente pasó,
que es lo que hace que el presupuesto se vea terminado.

## Si el sistema no te deja restaurar

Puede salir este mensaje:

> El doctor ya tiene una cita en este horario. Por favor, selecciona otro horario o doctor.

Significa que en ese mismo horario el doctor tiene hoy otra cita cargada, y el sistema no deja
tener dos.

- **No borres, no canceles y no muevas la otra cita** para hacer lugar. La otra cita puede ser real
  y moverla rompe otra cosa.
- Anotá la fecha y la hora, y avisá. Esa cita se resuelve aparte.

## Si la lista marca la cita con "importe propio"

Algunas citas tienen un importe escrito en el campo **Costo** de la cita. En esas, restaurar cobra
el importe de la cita y **no** el del trabajo del presupuesto, así que el resultado no es el que
buscamos. La lista te las va a marcar.

- **No las restaures.** Quedan para una decisión aparte.

## Lo que no hay que hacer, nunca

- **No escribas un importe en el campo Costo de la cita.** Si la cita tiene importe propio, ese
  importe le gana al del presupuesto y el trabajo vuelve a quedar sin cobrar.
- **No cambies el estado del trabajo en el presupuesto** (ni a Pendiente, ni a Ejecutado a mano).
- **No pases el presupuesto de Borrador a Aprobado**, ni lo canceles.
- **No borres ni vuelvas a cargar el presupuesto.** Borrarlo libera las entregas reservadas y
  pierde cobros que ya estaban bien.
- **No restaures citas que no estén en la lista.**

## Qué avisar cuando terminás

Por cada cita, una línea: fecha, si la restauraste o no, y si no, por qué (conflicto de horario,
importe propio, o no la encontraste). Con eso se vuelve a medir y se cierra el tema.
