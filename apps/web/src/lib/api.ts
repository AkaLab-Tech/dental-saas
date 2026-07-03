const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

export type BudgetStatus = "DRAFT" | "APPROVED" | "PARTIAL" | "COMPLETED" | "CANCELLED";

export interface PublicBudgetItem {
  id: string;
  description: string;
  toothNumber: string | null;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  plannedAppointmentType: string | null;
  status: string;
  notes: string | null;
  order: number;
}

export interface PublicBudgetTenant {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  logo: string | null;
  currency: string;
  language: string;
}

export interface PublicBudgetPatient {
  firstName: string;
  lastName: string;
}

export interface PublicBudgetData {
  id: string;
  status: BudgetStatus;
  notes: string | null;
  validUntil: string | null;
  totalAmount: string;
  createdAt: string;
  items: PublicBudgetItem[];
  patient: PublicBudgetPatient;
  tenant: PublicBudgetTenant;
}

export type FetchPublicBudgetResult =
  | { ok: true; data: PublicBudgetData }
  | { ok: false; status: "not-found" | "error" };

export async function fetchPublicBudget(token: string): Promise<FetchPublicBudgetResult> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/public/budgets/${encodeURIComponent(token)}`);

    if (response.status === 404) {
      return { ok: false, status: "not-found" };
    }

    if (!response.ok) {
      return { ok: false, status: "error" };
    }

    const body = (await response.json()) as { success: boolean; data: PublicBudgetData };
    return { ok: true, data: body.data };
  } catch {
    return { ok: false, status: "error" };
  }
}
