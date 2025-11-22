import { create } from 'zustand'

type UploadStatus = 'idle' | 'uploading' | 'ready' | 'error'

interface UploadOverlayState {
  status: UploadStatus
  message: string
  open: boolean
  start: (message?: string) => void
  complete: (message?: string, autoCloseMs?: number) => void
  fail: (message?: string, autoCloseMs?: number) => void
  dismiss: () => void
}

const DEFAULT_MESSAGE = 'Uploading image…'

export const useUploadOverlayStore = create<UploadOverlayState>((set) => ({
  status: 'idle',
  message: DEFAULT_MESSAGE,
  open: false,
  start: (message) =>
    set(() => ({
      status: 'uploading',
      message: message ?? DEFAULT_MESSAGE,
      open: true,
    })),
  complete: (message, autoCloseMs = 800) =>
    set((state) => {
      if (!state.open) return state
      if (autoCloseMs > 0) {
        window.setTimeout(() => {
          useUploadOverlayStore.getState().dismiss()
        }, autoCloseMs)
      }
      return {
        ...state,
        status: 'ready',
        message: message ?? 'Image ready',
      }
    }),
  fail: (message, autoCloseMs = 1200) =>
    set((state) => {
      if (!state.open) return state
      if (autoCloseMs > 0) {
        window.setTimeout(() => {
          useUploadOverlayStore.getState().dismiss()
        }, autoCloseMs)
      }
      return {
        ...state,
        status: 'error',
        message: message ?? 'Upload failed',
      }
    }),
  dismiss: () =>
    set(() => ({
      status: 'idle',
      message: DEFAULT_MESSAGE,
      open: false,
    })),
}))
