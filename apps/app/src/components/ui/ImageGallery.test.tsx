import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ImageGallery } from './ImageGallery'
import { AttachmentModule } from '@dental/shared'
import * as attachmentApi from '@/lib/attachment-api'

// Mock permissions hook
const mockCan = vi.fn(() => true)
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: mockCan, canAny: vi.fn(), canAll: vi.fn() }),
}))

// Mock attachment API
vi.mock('@/lib/attachment-api', () => ({
  listAttachments: vi.fn(),
  deleteAttachment: vi.fn(),
}))

// Mock useImageUrl to return a direct URL
vi.mock('@/hooks/useAuthImage', () => ({
  useImageUrl: (id: string | null) => id ? `http://localhost:5001/api/attachments/file/${id}?token=mock` : null,
}))

describe('ImageGallery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCan.mockReturnValue(true)
  })

  it('should show loading state initially', () => {
    vi.mocked(attachmentApi.listAttachments).mockImplementation(
      () => new Promise(() => {})
    )

    render(
      <ImageGallery
        module={AttachmentModule.PATIENTS}
        entityId="patient-1"
      />
    )

    // Should show a loading spinner
    expect(document.querySelector('.animate-spin')).toBeTruthy()
  })

  it('should show empty state when no attachments', async () => {
    vi.mocked(attachmentApi.listAttachments).mockResolvedValue([])

    render(
      <ImageGallery
        module={AttachmentModule.PATIENTS}
        entityId="patient-1"
      />
    )

    await waitFor(() => {
      // In test env without i18n setup, the raw key is rendered
      expect(screen.getByText(/attachments\.noImages|No images|No hay imágenes|لا توجد صور/i)).toBeInTheDocument()
    })
  })

  it('should render thumbnails for each attachment', async () => {
    const mockAttachments = [
      { id: '1', module: 'PATIENTS', entityId: 'p1', filename: 'img1.png', mimeType: 'image/png', sizeBytes: 1024, description: null, createdAt: '2024-01-01' },
      { id: '2', module: 'PATIENTS', entityId: 'p1', filename: 'img2.jpg', mimeType: 'image/jpeg', sizeBytes: 2048, description: null, createdAt: '2024-01-02' },
    ]
    vi.mocked(attachmentApi.listAttachments).mockResolvedValue(mockAttachments as never)

    render(
      <ImageGallery
        module={AttachmentModule.PATIENTS}
        entityId="p1"
      />
    )

    await waitFor(() => {
      const images = document.querySelectorAll('img')
      expect(images).toHaveLength(2)
    })
  })

  // Task #218: thumbnail grid widened to make better use of large screens.
  it('renders the thumbnail grid with the widened responsive column classes', async () => {
    const mockAttachments = [
      { id: '1', module: 'PATIENTS', entityId: 'p1', filename: 'img1.png', mimeType: 'image/png', sizeBytes: 1024, description: null, createdAt: '2024-01-01' },
    ]
    vi.mocked(attachmentApi.listAttachments).mockResolvedValue(mockAttachments as never)

    render(
      <ImageGallery
        module={AttachmentModule.PATIENTS}
        entityId="p1"
      />
    )

    await waitFor(() => {
      expect(document.querySelectorAll('img')).toHaveLength(1)
    })

    const grid = document.querySelector('img')?.closest('.grid')
    expect(grid).not.toBeNull()
    expect(grid).toHaveClass('grid-cols-3', 'sm:grid-cols-4', 'md:grid-cols-6', 'lg:grid-cols-8', 'gap-3')
  })

  it('should re-fetch when refreshKey changes', async () => {
    vi.mocked(attachmentApi.listAttachments).mockResolvedValue([])

    const { rerender } = render(
      <ImageGallery
        module={AttachmentModule.PATIENTS}
        entityId="p1"
        refreshKey={0}
      />
    )

    await waitFor(() => {
      expect(attachmentApi.listAttachments).toHaveBeenCalledTimes(1)
    })

    rerender(
      <ImageGallery
        module={AttachmentModule.PATIENTS}
        entityId="p1"
        refreshKey={1}
      />
    )

    await waitFor(() => {
      expect(attachmentApi.listAttachments).toHaveBeenCalledTimes(2)
    })
  })
})
