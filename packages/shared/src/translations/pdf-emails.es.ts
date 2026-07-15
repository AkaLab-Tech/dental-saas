export default {
  "pdf": {
    "patient": {
      "title": "Historial Médico del Paciente",
      "information": "Información del Paciente",
      "fullName": "Nombre Completo",
      "dateOfBirth": "Fecha de Nacimiento",
      "age": "Edad",
      "years": "años",
      "gender": "Género",
      "phone": "Teléfono",
      "email": "Correo Electrónico",
      "address": "Dirección",
      "dentalChartNotes": "Notas del Odontograma",
      "appointmentHistory": "Historial de Citas",
      "records": "registros",
      "noAppointments": "No hay citas registradas",
      "confidentialNotice": "Este documento contiene información médica confidencial."
    },
    "appointment": {
      "receipt": "Recibo de Cita",
      "patientInformation": "Información del Paciente",
      "appointmentDetails": "Detalles de la Cita",
      "date": "Fecha",
      "time": "Hora",
      "duration": "Duración",
      "minutes": "minutos",
      "status": "Estado",
      "type": "Tipo",
      "attendingDoctor": "Doctor Atendiente",
      "name": "Nombre",
      "specialty": "Especialidad",
      "license": "Licencia #",
      "treatmentNotes": "Notas de Tratamiento",
      "totalCost": "Costo Total",
      "paymentStatus": "Estado de Pago",
      "paid": "PAGADO",
      "pending": "PENDIENTE",
      "informationalNotice": "Este documento es solo con fines informativos."
    },
    "labwork": {
      "title": "Orden de Laboratorio",
      "labName": "Laboratorio",
      "orderDetails": "Detalles de la Orden",
      "patient": "Paciente",
      "assignedDoctors": "Doctor(es) Asignado(s)",
      "price": "Precio",
      "notes": "Notas",
      "delivered": "ENTREGADO",
      "pendingDelivery": "PENDIENTE DE ENTREGA"
    },
    "budget": {
      "title": "Presupuesto de Tratamiento",
      "budgetFor": "Presupuesto para",
      "validUntil": "Válido hasta",
      "createdOn": "Creado el",
      "table": {
        "item": "#",
        "description": "Descripción",
        "tooth": "Diente",
        "qty": "Cant.",
        "unitPrice": "Precio Unitario",
        "lineTotal": "Total",
        "status": "Estado"
      },
      "total": "Total",
      "notes": "Notas",
      "status": {
        "DRAFT": "Borrador",
        "APPROVED": "Aprobado",
        "PARTIAL": "Parcial",
        "COMPLETED": "Completado",
        "CANCELLED": "Cancelado"
      },
      "itemStatus": {
        "PENDING": "Pendiente",
        "SCHEDULED": "Programado",
        "IN_PROGRESS": "En curso",
        "EXECUTED": "Ejecutado",
        "CANCELLED": "Cancelado"
      },
      "footer": "Este presupuesto es una estimación y puede estar sujeto a cambios."
    },
    "common": {
      "generatedOn": "Generado el",
      "at": "a las",
      "doctor": "Dr.",
      "phone": "Tel"
    },
    "table": {
      "date": "Fecha",
      "type": "Tipo",
      "doctor": "Doctor",
      "status": "Estado",
      "cost": "Costo",
      "notes": "Notas",
      "andMore": "... y {{count}} citas más"
    }
  },
  "email": {
    "welcome": {
      "subject": "Bienvenido a Alveo System",
      "preview": "¡Bienvenido a Alveo System! Tu clínica \"{{clinicName}}\" está lista.",
      "heading": "🦷 ¡Bienvenido a Alveo System!",
      "greeting": "Hola {{firstName}},",
      "thankYou": "Gracias por registrar {{clinicName}} en Alveo System. ¡Tu sistema de gestión de clínica está listo para usar!",
      "asOwner": "Como propietario de la clínica, ahora puedes:",
      "addStaff": "Agregar doctores y personal",
      "managePatients": "Gestionar registros de pacientes",
      "scheduleAppointments": "Programar citas",
      "trackLabworks": "Rastrear trabajos de laboratorio y gastos",
      "generateReports": "Generar reportes y análisis",
      "buttonText": "Ir al panel de tu clínica",
      "questions": "Si tienes alguna pregunta, responde a este correo o contacta a nuestro equipo de soporte.",
      "signature": "— El Equipo de Alveo System",
      "dashboardLink": "Ir al Panel"
    },
    "passwordReset": {
      "subject": "Restablece tu contraseña de Alveo System",
      "preview": "Restablece tu contraseña de Alveo System",
      "heading": "🔐 Solicitud de Restablecimiento de Contraseña",
      "greeting": "Hola {{firstName}},",
      "message": "Recibimos una solicitud para restablecer tu contraseña de tu cuenta de administrador de Alveo System. Haz clic en el botón de abajo para establecer una nueva contraseña:",
      "buttonText": "Restablecer Contraseña",
      "expiryWarning": "⏱️ Este enlace expirará en {{minutes}} minutos.",
      "securityNotice": "🔒 Aviso de Seguridad: Si no solicitaste este restablecimiento de contraseña, puedes ignorar este correo de forma segura. Tu contraseña permanecerá sin cambios.",
      "signature": "— El Equipo de Alveo System",
      "linkInstructions": "Si el botón no funciona, copia y pega este enlace en tu navegador:"
    }
  },
  "status": {
    "scheduled": "Programada",
    "confirmed": "Confirmada",
    "in_progress": "En Progreso",
    "completed": "Completada",
    "cancelled": "Cancelada",
    "no_show": "No Asistió",
    "rescheduled": "Reprogramada"
  },
  "gender": {
    "MALE": "Masculino",
    "FEMALE": "Femenino",
    "OTHER": "Otro",
    "PREFER_NOT_TO_SAY": "Prefiere no decir"
  }
} as const
