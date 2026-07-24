import { createRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { TimePicker } from './TimePicker'

describe('TimePicker', () => {
  it('renders a native input[type="time"]', () => {
    render(<TimePicker aria-label="Hora" value="09:00" onChange={() => {}} />)
    const input = screen.getByLabelText('Hora') as HTMLInputElement
    expect(input.tagName).toBe('INPUT')
    expect(input.type).toBe('time')
  })

  it('accepts and displays an HH:mm value', () => {
    render(<TimePicker aria-label="Hora" value="14:35" onChange={() => {}} />)
    const input = screen.getByLabelText('Hora') as HTMLInputElement
    expect(input.value).toBe('14:35')
  })

  it('calls onChange with the new HH:mm value when the user changes it', () => {
    // Captures target.value synchronously inside the handler, not from the
    // stored event afterward: TimePicker is controlled here (fixed `value`
    // prop), so React resets the DOM node's value back to "09:00" on the
    // next render, and reading event.target.value later off the same node
    // would see that reverted value instead of what the user actually typed.
    const onValueChange = vi.fn()
    render(
      <TimePicker
        aria-label="Hora"
        value="09:00"
        onChange={(e) => onValueChange(e.target.value)}
      />
    )
    const input = screen.getByLabelText('Hora')

    fireEvent.change(input, { target: { value: '13:45' } })

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith('13:45')
  })

  it('forwards the ref to the underlying input element', () => {
    const ref = createRef<HTMLInputElement>()
    render(<TimePicker ref={ref} aria-label="Hora" value="09:00" onChange={() => {}} />)
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
    expect(ref.current?.type).toBe('time')
  })

  it('applies the error border class when error=true', () => {
    render(<TimePicker aria-label="Hora" error value="09:00" onChange={() => {}} />)
    expect(screen.getByLabelText('Hora')).toHaveClass('border-red-300')
  })

  it('applies the default border class when error is not set', () => {
    render(<TimePicker aria-label="Hora" value="09:00" onChange={() => {}} />)
    expect(screen.getByLabelText('Hora')).toHaveClass('border-gray-300')
  })

  it('merges a caller-supplied className with its own styling classes', () => {
    render(<TimePicker aria-label="Hora" className="custom-class" value="09:00" onChange={() => {}} />)
    const input = screen.getByLabelText('Hora')
    expect(input).toHaveClass('custom-class')
    expect(input).toHaveClass('border-gray-300')
  })

  it('applies logical (RTL-safe) padding classes rather than physical left/right ones', () => {
    render(<TimePicker aria-label="Hora" value="09:00" onChange={() => {}} />)
    const input = screen.getByLabelText('Hora')
    expect(input).toHaveClass('ps-3')
    expect(input).toHaveClass('pe-9')
    expect(input.className).not.toMatch(/\bpl-\d/)
    expect(input.className).not.toMatch(/\bpr-\d/)
  })

  it('renders the clock icon absolutely positioned so it does not overlap the native time UI', () => {
    const { container } = render(<TimePicker aria-label="Hora" value="09:00" onChange={() => {}} />)
    const icon = container.querySelector('.lucide-clock')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass('pointer-events-none')
  })

  it('forwards disabled and other native input attributes', () => {
    render(<TimePicker aria-label="Hora" value="09:00" onChange={() => {}} disabled />)
    expect(screen.getByLabelText('Hora')).toBeDisabled()
  })

  describe('react-hook-form register() integration', () => {
    function RegisterHarness({ onSubmit }: { onSubmit: (startTime: string) => void }) {
      const { register, handleSubmit } = useForm<{ startTime: string }>({
        defaultValues: { startTime: '09:00' },
      })
      return (
        <form onSubmit={handleSubmit((data) => onSubmit(data.startTime))}>
          <TimePicker aria-label="Hora de inicio" {...register('startTime')} />
          <button type="submit">save</button>
        </form>
      )
    }

    it('registers with RHF and submits the user-entered HH:mm value', async () => {
      const onSubmit = vi.fn()
      render(<RegisterHarness onSubmit={onSubmit} />)

      const input = screen.getByLabelText('Hora de inicio') as HTMLInputElement
      expect(input.value).toBe('09:00')

      fireEvent.change(input, { target: { value: '16:20' } })
      fireEvent.click(screen.getByRole('button', { name: 'save' }))

      // RHF's handleSubmit resolves its validation asynchronously (a
      // microtask) even with no async validators, so the onSubmit callback
      // fires after the click event, not synchronously within it.
      await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('16:20'))
    })
  })
})
