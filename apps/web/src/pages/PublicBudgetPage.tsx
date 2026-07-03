import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Loader2, AlertCircle, FileText } from "lucide-react";
import {
  fetchPublicBudget,
  type BudgetStatus,
  type PublicBudgetData,
} from "@/lib/api";

type Language = "es" | "en" | "ar";

const LABELS: Record<Language, Record<string, string>> = {
  es: {
    loading: "Cargando presupuesto...",
    notFoundTitle: "Presupuesto no disponible",
    notFoundBody:
      "Este enlace no es válido o ya no está activo. Contacta a la clínica para solicitar un nuevo enlace.",
    errorTitle: "No pudimos cargar el presupuesto",
    errorBody: "Ocurrió un error de conexión. Intenta nuevamente.",
    retry: "Reintentar",
    patient: "Paciente",
    status: "Estado",
    validUntil: "Válido hasta",
    description: "Descripción",
    tooth: "Diente",
    quantity: "Cant.",
    unitPrice: "Precio unit.",
    lineTotal: "Total",
    total: "Total del presupuesto",
    notes: "Notas",
    createdAt: "Emitido el",
  },
  en: {
    loading: "Loading budget...",
    notFoundTitle: "Budget not available",
    notFoundBody:
      "This link is invalid or no longer active. Contact the clinic to request a new link.",
    errorTitle: "We couldn't load the budget",
    errorBody: "A connection error occurred. Please try again.",
    retry: "Retry",
    patient: "Patient",
    status: "Status",
    validUntil: "Valid until",
    description: "Description",
    tooth: "Tooth",
    quantity: "Qty",
    unitPrice: "Unit price",
    lineTotal: "Total",
    total: "Budget total",
    notes: "Notes",
    createdAt: "Issued on",
  },
  ar: {
    loading: "جارٍ تحميل الميزانية...",
    notFoundTitle: "الميزانية غير متاحة",
    notFoundBody:
      "هذا الرابط غير صالح أو لم يعد نشطًا. تواصل مع العيادة لطلب رابط جديد.",
    errorTitle: "تعذر تحميل الميزانية",
    errorBody: "حدث خطأ في الاتصال. حاول مرة أخرى.",
    retry: "إعادة المحاولة",
    patient: "المريض",
    status: "الحالة",
    validUntil: "صالحة حتى",
    description: "الوصف",
    tooth: "السن",
    quantity: "الكمية",
    unitPrice: "سعر الوحدة",
    lineTotal: "الإجمالي",
    total: "إجمالي الميزانية",
    notes: "ملاحظات",
    createdAt: "تاريخ الإصدار",
  },
};

const STATUS_LABELS: Record<Language, Record<BudgetStatus, string>> = {
  es: {
    DRAFT: "Borrador",
    APPROVED: "Aprobado",
    PARTIAL: "Parcial",
    COMPLETED: "Completado",
    CANCELLED: "Cancelado",
  },
  en: {
    DRAFT: "Draft",
    APPROVED: "Approved",
    PARTIAL: "Partial",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
  },
  ar: {
    DRAFT: "مسودة",
    APPROVED: "معتمدة",
    PARTIAL: "جزئية",
    COMPLETED: "مكتملة",
    CANCELLED: "ملغاة",
  },
};

const STATUS_STYLES: Record<BudgetStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-700 border-gray-200",
  APPROVED: "bg-blue-100 text-blue-700 border-blue-200",
  PARTIAL: "bg-amber-100 text-amber-700 border-amber-200",
  COMPLETED: "bg-green-100 text-green-700 border-green-200",
  CANCELLED: "bg-red-100 text-red-700 border-red-200",
};

function toLanguage(value: string): Language {
  return value === "en" || value === "ar" ? value : "es";
}

function localeFor(language: Language): string {
  if (language === "en") return "en-US";
  if (language === "ar") return "ar";
  return "es-ES";
}

function formatDate(value: string, language: Language): string {
  return new Intl.DateTimeFormat(localeFor(language), {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}

type PageState =
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "error" }
  | { kind: "success"; data: PublicBudgetData };

export function PublicBudgetPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<PageState>({ kind: "loading" });

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    setState({ kind: "loading" });

    fetchPublicBudget(token).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState({ kind: result.status === "not-found" ? "not-found" : "error" });
        return;
      }
      setState({ kind: "success", data: result.data });
    });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token) {
    return (
      <CenteredMessage
        icon={<FileText className="w-10 h-10 text-gray-400" />}
        title={LABELS.es.notFoundTitle}
        message={LABELS.es.notFoundBody}
      />
    );
  }

  if (state.kind === "loading") {
    return <CenteredMessage icon={<Loader2 className="w-10 h-10 animate-spin text-blue-600" />} message={LABELS.es.loading} />;
  }

  if (state.kind === "not-found") {
    return (
      <CenteredMessage
        icon={<FileText className="w-10 h-10 text-gray-400" />}
        title={LABELS.es.notFoundTitle}
        message={LABELS.es.notFoundBody}
      />
    );
  }

  if (state.kind === "error") {
    return (
      <CenteredMessage
        icon={<AlertCircle className="w-10 h-10 text-red-500" />}
        title={LABELS.es.errorTitle}
        message={LABELS.es.errorBody}
        onRetry={() => window.location.reload()}
        retryLabel={LABELS.es.retry}
      />
    );
  }

  return <BudgetView data={state.data} />;
}

function CenteredMessage({
  icon,
  title,
  message,
  onRetry,
  retryLabel,
}: {
  icon: React.ReactNode;
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center max-w-md">
        <div className="flex justify-center mb-4">{icon}</div>
        {title && <h1 className="text-xl font-semibold text-gray-900 mb-2">{title}</h1>}
        <p className="text-gray-600">{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-6 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
          >
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function BudgetView({ data }: { data: PublicBudgetData }) {
  const language = toLanguage(data.tenant.language);
  const t = LABELS[language];
  const statusLabel = STATUS_LABELS[language][data.status];
  const isRtl = language === "ar";

  const currencyFormatter = new Intl.NumberFormat(localeFor(language), {
    style: "currency",
    currency: data.tenant.currency,
  });

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Tenant header */}
        <div className="border-b border-gray-200 px-6 py-6 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            {data.tenant.logo ? (
              <img
                src={data.tenant.logo}
                alt={data.tenant.name}
                className="w-12 h-12 rounded-lg object-cover"
              />
            ) : (
              <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-lg">
                  {data.tenant.name.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <div>
              <h1 className="text-lg font-bold text-gray-900">{data.tenant.name}</h1>
              <p className="text-sm text-gray-500">
                {[data.tenant.email, data.tenant.phone, data.tenant.address]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${STATUS_STYLES[data.status]}`}
          >
            {statusLabel}
          </span>
        </div>

        {/* Patient + meta */}
        <div className="px-6 py-4 grid sm:grid-cols-3 gap-4 border-b border-gray-200 text-sm">
          <div>
            <p className="text-gray-500">{t.patient}</p>
            <p className="font-medium text-gray-900">
              {data.patient.firstName} {data.patient.lastName}
            </p>
          </div>
          <div>
            <p className="text-gray-500">{t.createdAt}</p>
            <p className="font-medium text-gray-900">{formatDate(data.createdAt, language)}</p>
          </div>
          {data.validUntil && (
            <div>
              <p className="text-gray-500">{t.validUntil}</p>
              <p className="font-medium text-gray-900">{formatDate(data.validUntil, language)}</p>
            </div>
          )}
        </div>

        {/* Items table */}
        <div className="px-6 py-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 border-b border-gray-200">
                <th className={`py-2 font-medium ${isRtl ? "text-right" : "text-left"}`}>{t.description}</th>
                <th className={`py-2 font-medium ${isRtl ? "text-right" : "text-left"}`}>{t.tooth}</th>
                <th className="py-2 font-medium text-right">{t.quantity}</th>
                <th className="py-2 font-medium text-right">{t.unitPrice}</th>
                <th className="py-2 font-medium text-right">{t.lineTotal}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-3 text-gray-900">{item.description}</td>
                  <td className="py-3 text-gray-600">{item.toothNumber || "—"}</td>
                  <td className="py-3 text-right text-gray-600">{item.quantity}</td>
                  <td className="py-3 text-right text-gray-600">
                    {currencyFormatter.format(Number(item.unitPrice))}
                  </td>
                  <td className="py-3 text-right font-medium text-gray-900">
                    {currencyFormatter.format(Number(item.totalPrice))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Total */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end items-center gap-4">
          <span className="text-gray-600 font-medium">{t.total}</span>
          <span className="text-xl font-bold text-gray-900">
            {currencyFormatter.format(Number(data.totalAmount))}
          </span>
        </div>

        {/* Notes */}
        {data.notes && (
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
            <p className="text-sm text-gray-500 mb-1">{t.notes}</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{data.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
