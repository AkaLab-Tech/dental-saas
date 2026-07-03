export default {
  "pdf": {
    "patient": {
      "title": "Patient Medical History",
      "information": "Patient Information",
      "fullName": "Full Name",
      "dateOfBirth": "Date of Birth",
      "age": "Age",
      "years": "years",
      "gender": "Gender",
      "phone": "Phone",
      "email": "Email",
      "address": "Address",
      "dentalChartNotes": "Dental Chart Notes",
      "appointmentHistory": "Appointment History",
      "records": "records",
      "noAppointments": "No appointments recorded",
      "confidentialNotice": "This document contains confidential medical information."
    },
    "appointment": {
      "receipt": "Appointment Receipt",
      "patientInformation": "Patient Information",
      "appointmentDetails": "Appointment Details",
      "date": "Date",
      "time": "Time",
      "duration": "Duration",
      "minutes": "minutes",
      "status": "Status",
      "type": "Type",
      "attendingDoctor": "Attending Doctor",
      "name": "Name",
      "specialty": "Specialty",
      "license": "License #",
      "treatmentNotes": "Treatment Notes",
      "totalCost": "Total Cost",
      "paymentStatus": "Payment Status",
      "paid": "PAID",
      "pending": "PENDING",
      "informationalNotice": "This document is for informational purposes only."
    },
    "budget": {
      "title": "Treatment Budget",
      "budgetFor": "Budget for",
      "validUntil": "Valid until",
      "createdOn": "Created on",
      "table": {
        "item": "#",
        "description": "Description",
        "tooth": "Tooth",
        "qty": "Qty",
        "unitPrice": "Unit Price",
        "lineTotal": "Total",
        "status": "Status"
      },
      "total": "Total",
      "notes": "Notes",
      "status": {
        "DRAFT": "Draft",
        "APPROVED": "Approved",
        "PARTIAL": "Partial",
        "COMPLETED": "Completed",
        "CANCELLED": "Cancelled"
      },
      "itemStatus": {
        "PENDING": "Pending",
        "SCHEDULED": "Scheduled",
        "IN_PROGRESS": "In progress",
        "EXECUTED": "Executed",
        "CANCELLED": "Cancelled"
      },
      "footer": "This budget is an estimate and may be subject to change."
    },
    "common": {
      "generatedOn": "Generated on",
      "at": "at",
      "doctor": "Dr.",
      "phone": "Tel"
    },
    "table": {
      "date": "Date",
      "type": "Type",
      "doctor": "Doctor",
      "status": "Status",
      "cost": "Cost",
      "notes": "Notes",
      "andMore": "... and {{count}} more appointments"
    }
  },
  "email": {
    "welcome": {
      "subject": "Welcome to Alveo System",
      "preview": "Welcome to Alveo System! Your clinic \"{{clinicName}}\" is ready.",
      "heading": "🦷 Welcome to Alveo System!",
      "greeting": "Hello {{firstName}},",
      "thankYou": "Thank you for registering {{clinicName}} with Alveo System. Your clinic management system is ready to use!",
      "asOwner": "As the clinic owner, you can now:",
      "addStaff": "Add doctors and staff",
      "managePatients": "Manage patient records",
      "scheduleAppointments": "Schedule appointments",
      "trackLabworks": "Track labworks and expenses",
      "generateReports": "Generate reports and analytics",
      "buttonText": "Go to your clinic dashboard",
      "questions": "If you have any questions, reply to this email or contact our support team.",
      "signature": "— The Alveo System Team",
      "dashboardLink": "Go to Dashboard"
    },
    "passwordReset": {
      "subject": "Reset your Alveo System password",
      "preview": "Reset your Alveo System password",
      "heading": "🔐 Password Reset Request",
      "greeting": "Hello {{firstName}},",
      "message": "We received a request to reset the password for your Alveo System admin account. Click the button below to set a new password:",
      "buttonText": "Reset Password",
      "expiryWarning": "⏱️ This link will expire in {{minutes}} minutes.",
      "securityNotice": "🔒 Security Notice: If you didn't request this password reset, you can safely ignore this email. Your password will remain unchanged.",
      "signature": "— The Alveo System Team",
      "linkInstructions": "If the button doesn't work, copy and paste this link into your browser:"
    }
  },
  "status": {
    "scheduled": "Scheduled",
    "confirmed": "Confirmed",
    "in_progress": "In Progress",
    "completed": "Completed",
    "cancelled": "Cancelled",
    "no_show": "No Show",
    "rescheduled": "Rescheduled"
  },
  "gender": {
    "MALE": "Male",
    "FEMALE": "Female",
    "OTHER": "Other",
    "PREFER_NOT_TO_SAY": "Prefer not to say"
  }
} as const
