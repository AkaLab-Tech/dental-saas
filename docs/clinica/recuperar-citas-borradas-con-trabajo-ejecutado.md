# Recuperar las citas borradas que se habían llevado el cobro de un trabajo

## Nota de entrega: esto reemplaza lo que te dijimos el 12 de noviembre

El 12 de noviembre te dijimos: *"esas 7 las arreglo yo desde el sistema, no toques nada"*. **Eso ya
no vale, y además son menos: son dos citas, y esas dos las vas a arreglar vos, desde la pantalla.**
Una es de dos clics; la otra lleva cuatro pasos, porque en ese horario hay cargada otra cita que hay
que sacar primero — está en la sección *"Si el sistema no te deja restaurar"*. **Las demás citas
borradas de las listas anteriores no son tuyas**: se están resolviendo por separado y no hay que
tocarlas.

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

- Son **2 trabajos** en total, uno por cita. Si la lista que te llega trae otra cantidad, avisá
  antes de tocar.
- **El resto de las citas borradas que figuraban en las listas anteriores no son tuyas.** Se están
  resolviendo por separado, fuera de la pantalla: no las restaures, no las edites y no las canceles,
  aunque las veas en gris y se parezcan a las dos de la lista. Ésta es la última instrucción sobre
  este tema que te vamos a mandar.
- Si una cita no está en la lista, **no la restaures**, aunque se parezca.
- La lista te dice, por cada cita, **cuál de los dos procedimientos** usar: el **paso a paso** de
  acá abajo (dos clics), o el de **cuatro pasos** de la sección *"Si el sistema no te deja
  restaurar"*. Una de las dos va con el paso a paso corto; la otra, con el de cuatro pasos. El
  procedimiento corto no cambió en nada respecto de lo que ya te habíamos mandado.

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
que es lo que hace que el presupuesto se vea terminado. **Entonces, si al marcar completada no ves
que la cifra se mueva, está bien**: ya se había movido en el paso 4, al restaurar. La cifra se
controla después del paso 4, no después del 5.

## Si el sistema no te deja restaurar

Puede salir este mensaje:

> El doctor ya tiene una cita en este horario. Por favor, selecciona otro horario o doctor.

Significa que en ese mismo horario el doctor tiene hoy otra cita cargada, y el sistema no deja
tener dos.

**Antes acá decía "anotá la fecha y avisá; esa cita se resuelve aparte". Ésta es esa resolución, no
una instrucción nueva que contradiga la anterior.** De las dos citas de la lista, **esto le pasa a
una sola**: la segunda. Se midió qué era esa otra cita que ocupa el horario: es la **misma visita
cargada de nuevo** (mismo paciente, mismo doctor, misma hora, creada poco después de que se borrara
la original) y **está vacía**: no tiene importe escrito, no tiene cobros, no tiene trabajo de
laboratorio, no tiene nada escrito y no tiene ningún trabajo del presupuesto asociado. La lista
firmada te confirma ese chequeo para esa cita; si una cita no está en la lista, no entra en este
procedimiento.

Esperá la lista firmada. **Mientras no llegue, no apliques nada de esta sección** (ni nada de este
documento).

Son cuatro pasos sobre **esa única cita**, y van **uno detrás del otro, sin dejarla a mitad de
camino**. Entre el paso 2 y el paso 3 la cuenta del paciente muestra una cifra que todavía no es la
correcta — la cita restaurada cobra por un rato su propio importe y el trabajo sigue en cero —: eso
es normal y se corrige en el paso 3. Por eso los cuatro pasos se hacen seguidos, en la misma sesión.

1. **Saca del horario la cita duplicada vacía** (la que figura hoy en ese horario y la lista te
   marca como duplicada). En su tarjeta: **⋮** → **Cancelar cita**. Se abre un cartel que avisa que
   *"la cita será marcada como cancelada pero podrá ser restaurada posteriormente"*: confirmá con el
   botón rojo **Cancelar Cita**. El otro botón, **Mantener**, es el que deja todo como está.
   Esa cita duplicada no tiene nada cargado, así que no se pierde ningún dato, y queda en gris por
   si alguna vez hubiera que traerla de vuelta. Es el paso que la instrucción anterior no te daba.
2. **Restaurá la cita original.** Filtro → **Mostrar canceladas**, y en la tarjeta gris: **⋮** →
   **Restaurar**. Ahora sí la acepta. Hacelo desde la pantalla **Citas**: en la ficha del paciente
   las citas borradas se ven en gris pero no ofrecen el menú **⋮**.
3. **Vaciá el campo Costo de la cita restaurada.** Esta cita tiene un importe escrito en **Costo**,
   y la lista firmada te lo dice. **⋮** → **Editar**, borrá lo que haya en **Costo ($)** hasta que
   quede vacío, y confirmá con **Guardar Cambios**. Recién acá se puede: una cita borrada sólo
   ofrece **Restaurar**, no **Editar**. Vaciarlo es lo que hace que se cobre el trabajo del
   presupuesto y no el importe de la cita.
   **Dentro de esa ventana no toques las casillas de los trabajos del presupuesto**, ni para tildar
   ni para destildar, ni siquiera en un trabajo que no tenga nada que ver. Si tocás cualquiera de
   esas casillas, el sistema te vuelve a escribir solo un importe en **Costo** — incluso después de
   que lo hayas vaciado — y eso deshace justamente lo que este paso vino a hacer. Tocá **sólo** el
   campo **Costo ($)**. **Tampoco escribas nada en Pagado ($)**: en esta cita ese campo puede
   quedar habilitado, y cualquier número que escribas ahí carga un cobro nuevo.
4. **Marcá la cita como completada**, igual que en el paso a paso de arriba: **⋮** → **Marcar
   completada**, sin tildar nada más y sin escribir ningún importe.

Después de los cuatro pasos, mirá la cuenta del paciente: tiene que figurar cobrado el trabajo, por
el importe que dice la lista. Si no coincide, **pará y avisá**.

- **No muevas la cita de horario** ni le cambies la fecha a ninguna de las dos.
- Si en ese horario hay **otra cita más** que la lista no menciona, **pará y avisá**: ese caso no se
  resuelve con este procedimiento.
- Si en el paso 2 el sistema **igual** no te deja restaurar, **pará y avisá**. No canceles ninguna
  otra cita para hacerle lugar.

## Si la lista marca la cita con "importe propio"

Una cita puede tener un importe escrito en su campo **Costo**. En esas, restaurar cobra el importe
de la cita y **no** el del trabajo del presupuesto.

Antes acá decía *"no las restaures, quedan para una decisión aparte"*. Esa decisión ya se tomó, y de
las dos citas de la lista **esto le pasa a una sola: la segunda**, la misma que tiene el conflicto
de horario. Por eso su procedimiento es el de cuatro pasos de la sección anterior, y el paso 3 es
justamente vaciar ese campo.

- **La primera cita de la lista no tiene importe escrito en Costo.** No le vacíes nada ni le
  escribas nada: va con el paso a paso corto, restaurar y marcar completada.
- **No hay una tercera cita.** Si te llega una cita con importe propio que no es la segunda de la
  lista, **pará y avisá**: no la restaures ni le vacíes el **Costo**.
- Las citas borradas con importe propio que figuraban en las listas anteriores **no son tuyas**: se
  resuelven aparte, fuera de la pantalla.

## Lo que no hay que hacer, nunca

- **No escribas un importe en el campo Costo de la cita.** Si la cita tiene importe propio, ese
  importe le gana al del presupuesto y el trabajo vuelve a quedar sin cobrar. **Vaciar** ese campo
  en las citas que la lista marca con *"vaciar Costo"* (paso 3) es lo contrario de escribir un
  importe, y es parte del procedimiento: esta regla no lo prohíbe.
- **No cambies el estado del trabajo en el presupuesto** (ni a Pendiente, ni a Ejecutado a mano).
- **No pases el presupuesto de Borrador a Aprobado**, ni lo canceles.
- **No borres ni vuelvas a cargar el presupuesto.** Borrarlo libera las entregas reservadas y
  pierde cobros que ya estaban bien.
- **No restaures citas que no estén en la lista.**

## Qué avisar cuando terminás

Por cada cita, una línea: fecha, si la restauraste o no, y si no, por qué (apareció otra cita más
en el horario, no la encontraste, o el importe no coincidió). Si usaste el procedimiento de cuatro
pasos, decí también si llegaste a los cuatro o en qué paso te quedaste. Con eso se vuelve a medir y
se cierra el tema.
