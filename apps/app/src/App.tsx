import { Routes, Route, Navigate } from 'react-router'
import LoginPage from '@pages/auth/LoginPage'
import RegisterPage from '@pages/auth/RegisterPage'
import RegisterSuccessPage from '@pages/auth/RegisterSuccessPage'
import UnauthorizedPage from '@pages/auth/UnauthorizedPage'
import ForgotPasswordPage from '@pages/auth/ForgotPasswordPage'
import ResetPasswordPage from '@pages/auth/ResetPasswordPage'
import DashboardPage from '@pages/dashboard/DashboardPage'
import DoctorsPage from '@pages/doctors/DoctorsPage'
import DoctorDetailPage from '@pages/doctors/DoctorDetailPage'
import PatientsPage from '@pages/patients/PatientsPage'
import PatientDetailPage from '@pages/patients/PatientDetailPage'
import PatientDebtsPage from '@pages/patients/PatientDebtsPage'
import AppointmentsPage from '@pages/appointments/AppointmentsPage'
import { LabworksPage } from '@pages/labworks/LabworksPage'
import { ExpensesPage } from '@pages/expenses/ExpensesPage'
import BudgetDetailPage from '@pages/budgets/BudgetDetailPage'
import SettingsPage from '@pages/settings/SettingsPage'
import { UsersPage } from '@pages/users/UsersPage'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import AppLayout from '@/components/layout/AppLayout'

// Admin pages
import AdminLayout from '@/components/admin/AdminLayout'
import AdminSetupPage from '@pages/admin/AdminSetupPage'
import AdminLoginPage from '@pages/admin/AdminLoginPage'
import { AdminForgotPasswordPage } from '@pages/admin/AdminForgotPasswordPage'
import { AdminResetPasswordPage } from '@pages/admin/AdminResetPasswordPage'
import AdminDashboardPage from '@pages/admin/AdminDashboardPage'
import AdminTenantsPage from '@pages/admin/AdminTenantsPage'
import AdminTenantDetailPage from '@pages/admin/AdminTenantDetailPage'
import AdminUsersPage from '@pages/admin/AdminUsersPage'
import AdminUserDetailPage from '@pages/admin/AdminUserDetailPage'

function App() {
  return (
    <Routes>
      {/* Public auth routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/register/success" element={<RegisterSuccessPage />} />
      <Route path="/unauthorized" element={<UnauthorizedPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Clinic-specific routes (from welcome email) */}
      <Route path="/:clinicSlug/login" element={<LoginPage />} />
      <Route path="/:clinicSlug/reset-password" element={<ResetPasswordPage />} />

      {/* Protected tenant routes with AppLayout */}
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/doctors" element={<DoctorsPage />} />
        <Route path="/doctors/:id" element={<DoctorDetailPage />} />
        <Route path="/patients" element={<PatientsPage />} />
        <Route path="/patients/debts" element={<PatientDebtsPage />} />
        <Route path="/patients/:id" element={<PatientDetailPage />} />
        <Route
          path="/patients/:patientId/budgets/:id"
          element={<BudgetDetailPage />}
        />
        <Route path="/appointments" element={<AppointmentsPage />} />
        <Route path="/labworks" element={<LabworksPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      {/* Admin routes (separate auth flow) */}
      <Route path="/admin/setup" element={<AdminSetupPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin/forgot-password" element={<AdminForgotPasswordPage />} />
      <Route path="/admin/reset-password" element={<AdminResetPasswordPage />} />

      {/* Protected admin routes */}
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboardPage />} />
        <Route path="tenants" element={<AdminTenantsPage />} />
        <Route path="tenants/:id" element={<AdminTenantDetailPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="users/:id" element={<AdminUserDetailPage />} />
      </Route>
    </Routes>
  )
}

export default App
