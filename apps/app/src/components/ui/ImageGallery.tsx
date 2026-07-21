import { useState, useEffect, useCallback } from 'react'
import { ImageIcon, Loader2, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Permission } from '@dental/shared'
import type { AttachmentModule, AttachmentInfo } from '@dental/shared'
import { usePermissions } from '@/hooks/usePermissions'
import { listAttachments, deleteAttachment } from '@/lib/attachment-api'
import { useImageUrl } from '@/hooks/useAuthImage'
import { ImageLightbox } from './ImageLightbox'

interface ImageGalleryProps {
  module: AttachmentModule
  entityId: string
  refreshKey?: number
}

function ThumbnailImage({ attachment, onClick }: { attachment: AttachmentInfo; onClick: () => void }) {
  const url = useImageUrl(attachment.id)

  return (
    <button
      onClick={onClick}
      className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 hover:opacity-90 transition-opacity"
    >
      {url ? (
        <img
          src={url}
          alt={attachment.filename}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="flex items-center justify-center w-full h-full">
          <ImageIcon className="h-6 w-6 text-gray-300" />
        </div>
      )}
    </button>
  )
}

export function ImageGallery({ module, entityId, refreshKey = 0 }: ImageGalleryProps) {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const [attachments, setAttachments] = useState<AttachmentInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const canDelete = can(Permission.ATTACHMENTS_DELETE)

  const fetchAttachments = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listAttachments(module, entityId)
      setAttachments(data)
    } catch {
      // Silently fail - empty gallery
    } finally {
      setLoading(false)
    }
  }, [module, entityId])

  useEffect(() => {
    fetchAttachments()
  }, [fetchAttachments, refreshKey])

  const handleDelete = async (attachmentId: string) => {
    setDeletingId(attachmentId)
    try {
      await deleteAttachment(attachmentId)
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId))
      setConfirmDeleteId(null)
    } catch {
      // Error silently
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    )
  }

  if (attachments.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-gray-400">
        <ImageIcon className="h-8 w-8 mx-auto mb-2 text-gray-300" />
        {t('attachments.noImages')}
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
        {attachments.map((att, index) => (
          <div key={att.id} className="relative group">
            <ThumbnailImage
              attachment={att}
              onClick={() => setLightboxIndex(index)}
            />

            {/* Delete button overlay */}
            {canDelete && (
              <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {confirmDeleteId === att.id ? (
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleDelete(att.id)}
                      disabled={deletingId === att.id}
                      className="px-1.5 py-0.5 bg-red-600 text-white text-xs rounded shadow-sm hover:bg-red-700 disabled:opacity-50"
                    >
                      {deletingId === att.id ? '...' : t('common.yes')}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-1.5 py-0.5 bg-gray-600 text-white text-xs rounded shadow-sm hover:bg-gray-700"
                    >
                      {t('common.no')}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmDeleteId(att.id)
                    }}
                    className="p-1 bg-black/50 text-white rounded shadow-sm hover:bg-black/70 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <ImageLightbox
          attachments={attachments}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </>
  )
}
