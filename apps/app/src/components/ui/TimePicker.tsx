import { forwardRef, type InputHTMLAttributes } from 'react'
import { Clock } from 'lucide-react'

export interface TimePickerProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  error?: boolean
}

/**
 * A styled `<input type="time">` matching the app's other inputs. Kept as a
 * thin wrapper (rather than a fully custom widget) so it stays register()-
 * compatible with react-hook-form and forwards its ref for RHF's validation
 * focus-on-error behavior.
 */
export const TimePicker = forwardRef<HTMLInputElement, TimePickerProps>(
  ({ error, className, ...props }, ref) => {
    return (
      <div className="relative">
        <input
          ref={ref}
          type="time"
          className={`w-full ps-3 pe-9 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm ${
            error ? 'border-red-300' : 'border-gray-300'
          } ${className ?? ''}`}
          {...props}
        />
        <Clock className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
      </div>
    )
  }
)

TimePicker.displayName = 'TimePicker'

export default TimePicker
