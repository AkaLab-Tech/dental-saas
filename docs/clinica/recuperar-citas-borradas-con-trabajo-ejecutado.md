# Dos citas para recuperar

Esto es el procedimiento que se le manda a la asistente de la clínica. Va
acompañado de una lista firmada que nombra las dos citas: paciente, fecha, hora,
doctora, trabajo e importe. Esa lista sale de una medición sobre los datos de
producción, se revisa antes de mandar nada, y **no se guarda acá**: los nombres
de pacientes no entran al repositorio. Cuando este texto se manda por WhatsApp,
los datos de la lista se escriben dentro de cada procedimiento, en lugar de
«la cita 1» y «la cita 2», para que ella no tenga que cruzar dos mensajes
mientras opera.

Por qué es tan corto: la versión anterior traía además el historial de las dos
correcciones de instrucción, del 12/11 y del 16/11, y el porqué de cada regla.
Eso se le dice de viva voz al entregarlo. En el papel que ella sigue mientras
opera, estorbaba.

Tres cosas que esta versión corrigió y conviene no volver a romper:

- Cada procedimiento termina con su propio control contra el importe esperado.
  Cuando se fundieron en un solo control al final, un error en la primera cita
  recién se notaba con la segunda ya editada.
- Lo común a las dos citas se dice una sola vez, sin etiquetas de cantidad.
  Rotular una «dos clics» y la otra «cuatro pasos» no la ayudaba a operar, y las
  etiquetas dejaron de coincidir con sus propias listas en cuanto una cambió.
- El paso que restaura tiene su propia salida por si la cita gris no aparece.
  Sin ella, quien no la encuentra queda con la repetida ya cancelada y la
  original sin restaurar, que es el estado a medio camino que el procedimiento
  prohíbe.

Tres prohibiciones del documento viejo no están acá: no volver la línea a
Pendiente ni ponerla en Ejecutado a mano, no pasar el presupuesto de Borrador a
Aprobado ni cancelarlo, y no borrarlo y volver a cargarlo. Las tres viven en
[presupuestos-ejecutados-sin-cargo.md](presupuestos-ejecutados-sin-cargo.md),
bajo «Lo que no hay que hacer», que es la ficha que ella lee primero. Son las
mismas reglas, no siempre con las mismas palabras: la de Pendiente se completó
ahí para no perder la mitad del «ni a Ejecutado a mano».

---

**Dos citas para recuperar**

La lista firmada te dice, de cada una: paciente, fecha, hora, doctora, trabajo e
importe que tiene que volver a cobrarse. Son esas dos y nada más que esas dos.

De las dos, una sola tiene un importe escrito en **Costo** y una cita repetida
en su mismo horario. La lista te marca cuál es.

**Para encontrar cualquiera de las dos**

Entrá a **Citas**, andá con las flechas hasta el mes de esa fecha, abrí
**Filtro** y tildá **Mostrar canceladas**. La cita aparece en gris, en su día y
hora.

Hacelo siempre desde **Citas**. Desde la ficha del paciente las borradas se ven,
pero no te dan el menú **⋮**.

**La primera cita: dos cosas**

1. En la tarjeta gris: **⋮**, **Restaurar**. Acá vuelve la plata.
2. **⋮**, **Marcar completada**. El trabajo ya viene tildado y bloqueado, no
   tildes nada más y no escribas ningún importe.

Listo. Entrá a su ficha y fijate que el trabajo figure cobrado por el importe de
la lista. Si ves otro número, parás y avisás antes de seguir con la segunda.

**La segunda cita: lo mismo, más dos cosas que la primera no tiene**

En ese horario hay **dos** citas: la gris que vamos a recuperar, y una activa
que es la misma visita cargada de nuevo y está vacía. Por eso acá el orden
importa, y los cuatro pasos van seguidos, sin dejarla por la mitad.

1. **Primero sacá la repetida**, que es la única diferencia real con la primera.
   En la cita **activa**: **⋮**, **Cancelar cita**, y confirmá con el botón rojo
   **Cancelar Cita**. Es la que no tiene nada cargado, no se pierde ningún dato.
2. Ahora sí, en la gris: **⋮**, **Restaurar**. Igual que en la primera. Si no la
   ves, fijate que **Mostrar canceladas** siga tildado. Si aun así no aparece,
   parás y avisás sin tocar nada más: la repetida ya está cancelada y eso no
   rompe nada, pero no sigas sola desde ahí.
3. **Después vaciá el Costo**, que es la otra diferencia. **⋮**, **Editar**,
   borrá el importe que la lista te indica del campo **Costo ($)** hasta dejarlo
   vacío, **Guardar Cambios**. **No escribas nada en Pagado ($)**
   aunque te deje: en esta cita el trabajo lo cobra el presupuesto, y un número
   ahí sería un cobro de más.
4. **⋮**, **Marcar completada**, igual que en la primera.

Entre el paso 2 y el 3 su cuenta va a mostrar una cifra que no es la correcta.
Es normal, se arregla en el 3.

Al final entrá a su ficha y fijate que el trabajo figure cobrado por el importe
de la lista. Si ves otro número, parás y avisás.

**Con estas dos**

No les cambies el horario ni la fecha. Si en alguno de esos dos horarios aparece
una cita más de las que dice la lista, parás y avisás. No canceles otra cita
para hacerle lugar.

**Con todas las demás**

No restaures ninguna otra cita borrada, aunque la veas en gris y se parezca. Las
de las listas viejas no son tuyas, ésas se resuelven por fuera de la pantalla.

En el resto del sistema seguí trabajando como siempre. Las dos advertencias del
paso 3 de la segunda cita valen para esa ventana y nada más: el campo
**Pagado ($)** se usa con normalidad en las demás citas.

Antes de empezar anotá lo que muestran hoy las dos fichas, para comparar después.

Cuando termines mandá una línea por cita: fecha, si la hiciste o no, y si no,
por qué.
