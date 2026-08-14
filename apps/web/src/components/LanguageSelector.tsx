import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { languages, type LanguageCode } from "../i18n";

// Ported from apps/app's components/ui/LanguageSelector.tsx dropdown variant.
// apps/web cannot import across the app package boundary, so this is a copy,
// trimmed to the dropdown shape the landing header needs.
export function LanguageSelector() {
  const { i18n } = useTranslation();

  const handleLanguageChange = (code: LanguageCode) => {
    i18n.changeLanguage(code);
  };

  return (
    <div className="relative">
      <Globe className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
      <select
        value={i18n.resolvedLanguage ?? i18n.language}
        onChange={(e) => handleLanguageChange(e.target.value as LanguageCode)}
        aria-label="Language"
        className="pl-8 pr-6 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none cursor-pointer hover:bg-gray-50"
      >
        {languages.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.nativeName}
          </option>
        ))}
      </select>
    </div>
  );
}
