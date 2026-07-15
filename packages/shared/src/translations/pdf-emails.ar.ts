export default {
  "pdf": {
    "patient": {
      "title": "التاريخ الطبي للمريض",
      "information": "معلومات المريض",
      "fullName": "الاسم الكامل",
      "dateOfBirth": "تاريخ الميلاد",
      "age": "العمر",
      "years": "سنوات",
      "gender": "الجنس",
      "phone": "الهاتف",
      "email": "البريد الإلكتروني",
      "address": "العنوان",
      "dentalChartNotes": "ملاحظات مخطط الأسنان",
      "appointmentHistory": "سجل المواعيد",
      "records": "سجلات",
      "noAppointments": "لا توجد مواعيد مسجلة",
      "confidentialNotice": "يحتوي هذا المستند على معلومات طبية سرية."
    },
    "appointment": {
      "receipt": "إيصال الموعد",
      "patientInformation": "معلومات المريض",
      "appointmentDetails": "تفاصيل الموعد",
      "date": "التاريخ",
      "time": "الوقت",
      "duration": "المدة",
      "minutes": "دقائق",
      "status": "الحالة",
      "type": "النوع",
      "attendingDoctor": "الطبيب المعالج",
      "name": "الاسم",
      "specialty": "التخصص",
      "license": "رقم الترخيص",
      "treatmentNotes": "ملاحظات العلاج",
      "totalCost": "التكلفة الإجمالية",
      "paymentStatus": "حالة الدفع",
      "paid": "مدفوع",
      "pending": "معلق",
      "informationalNotice": "هذا المستند للأغراض الإعلامية فقط."
    },
    "labwork": {
      "title": "طلب المختبر",
      "labName": "المختبر",
      "orderDetails": "تفاصيل الطلب",
      "patient": "المريض",
      "assignedDoctors": "الطبيب (الأطباء) المعين(ون)",
      "price": "السعر",
      "notes": "ملاحظات",
      "delivered": "تم التسليم",
      "pendingDelivery": "بانتظار التسليم"
    },
    "budget": {
      "title": "ميزانية العلاج",
      "budgetFor": "ميزانية لـ",
      "validUntil": "صالحة حتى",
      "createdOn": "أُنشئت في",
      "table": {
        "item": "#",
        "description": "الوصف",
        "tooth": "السن",
        "qty": "الكمية",
        "unitPrice": "سعر الوحدة",
        "lineTotal": "الإجمالي",
        "status": "الحالة"
      },
      "total": "الإجمالي",
      "notes": "ملاحظات",
      "status": {
        "DRAFT": "مسودة",
        "APPROVED": "معتمدة",
        "PARTIAL": "جزئية",
        "COMPLETED": "مكتملة",
        "CANCELLED": "ملغاة"
      },
      "itemStatus": {
        "PENDING": "معلّق",
        "SCHEDULED": "مجدول",
        "IN_PROGRESS": "قيد التنفيذ",
        "EXECUTED": "منفذ",
        "CANCELLED": "ملغى"
      },
      "footer": "هذه الميزانية هي تقدير وقد تخضع للتغيير."
    },
    "common": {
      "generatedOn": "تم الإنشاء في",
      "at": "الساعة",
      "doctor": "د.",
      "phone": "هاتف"
    },
    "table": {
      "date": "التاريخ",
      "type": "النوع",
      "doctor": "الطبيب",
      "status": "الحالة",
      "cost": "التكلفة",
      "notes": "الملاحظات",
      "andMore": "... و {{count}} موعد آخر"
    }
  },
  "email": {
    "welcome": {
      "subject": "مرحباً بك في نظام Alveo",
      "preview": "مرحباً بك في نظام Alveo! عيادتك \"{{clinicName}}\" جاهزة.",
      "heading": "🦷 مرحباً بك في نظام Alveo!",
      "greeting": "مرحباً {{firstName}}،",
      "thankYou": "شكراً لتسجيل {{clinicName}} في نظام Alveo. نظام إدارة عيادتك جاهز للاستخدام!",
      "asOwner": "كمالك للعيادة، يمكنك الآن:",
      "addStaff": "إضافة أطباء وموظفين",
      "managePatients": "إدارة سجلات المرضى",
      "scheduleAppointments": "جدولة المواعيد",
      "trackLabworks": "تتبع أعمال المختبر والنفقات",
      "generateReports": "إنشاء التقارير والتحليلات",
      "buttonText": "الانتقال إلى لوحة تحكم عيادتك",
      "questions": "إذا كان لديك أي أسئلة، قم بالرد على هذا البريد الإلكتروني أو اتصل بفريق الدعم لدينا.",
      "signature": "— فريق نظام Alveo",
      "dashboardLink": "الانتقال إلى لوحة التحكم"
    },
    "passwordReset": {
      "subject": "إعادة تعيين كلمة مرور نظام Alveo",
      "preview": "إعادة تعيين كلمة مرور نظام Alveo",
      "heading": "🔐 طلب إعادة تعيين كلمة المرور",
      "greeting": "مرحباً {{firstName}}،",
      "message": "تلقينا طلباً لإعادة تعيين كلمة المرور لحساب المسؤول الخاص بك في نظام Alveo. انقر على الزر أدناه لتعيين كلمة مرور جديدة:",
      "buttonText": "إعادة تعيين كلمة المرور",
      "expiryWarning": "⏱️ ستنتهي صلاحية هذا الرابط خلال {{minutes}} دقيقة.",
      "securityNotice": "🔒 ملاحظة أمنية: إذا لم تطلب إعادة تعيين كلمة المرور هذه، يمكنك تجاهل هذا البريد الإلكتروني بأمان. ستبقى كلمة المرور الخاصة بك دون تغيير.",
      "signature": "— فريق نظام Alveo",
      "linkInstructions": "إذا لم يعمل الزر، انسخ والصق هذا الرابط في متصفحك:"
    }
  },
  "status": {
    "scheduled": "مجدولة",
    "confirmed": "مؤكدة",
    "in_progress": "قيد التنفيذ",
    "completed": "مكتملة",
    "cancelled": "ملغاة",
    "no_show": "لم يحضر",
    "rescheduled": "أعيد جدولتها"
  },
  "gender": {
    "MALE": "ذكر",
    "FEMALE": "أنثى",
    "OTHER": "آخر",
    "PREFER_NOT_TO_SAY": "يفضل عدم الإفصاح"
  }
} as const
