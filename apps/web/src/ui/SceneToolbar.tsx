import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  type ChangeEvent,
  type ChangeEventHandler,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import {
  useSceneStore,
  type SceneNode,
  type TextDefinition,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_TEXT_ALIGN,
  DEFAULT_FONT_WEIGHT,
} from '../state/scene'
import { uploadAsset, waitForAssetReady } from '../api/assets'
import { useDialogStore } from '../state/dialog'
import { summarizeTileLevels } from '../tiles/tileLevels'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold as BoldIcon,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Circle,
  ImageUp,
  Italic as ItalicIcon,
  Link as LinkIcon,
  Link2Off,
  Lock,
  Redo2,
  RectangleHorizontal,
  Trash2,
  Triangle as TriangleIcon,
  Type as TypeIcon,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react'

const TRIANGLE_POINTS = [
  { x: 0, y: -0.5 },
  { x: 0.5, y: 0.5 },
  { x: -0.5, y: 0.5 },
]

const DEFAULT_FILL = '#38bdf8'
const DEFAULT_STROKE = '#0ea5e9'
const DEFAULT_RECT = { width: 200, height: 160 }
const DEFAULT_ELLIPSE = { width: 200, height: 200 }
const DEFAULT_TRIANGLE = { width: 220, height: 220 }

interface ToolbarIconButtonProps {
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  variant?: 'accent' | 'ghost' | 'danger'
  loading?: boolean
}

type ToolbarCommand = ToolbarIconButtonProps & { key: string }

type ToolbarSection = {
  key: string
  label: string
  commands?: ToolbarCommand[]
  content?: ReactNode
}

export function SceneToolbar() {
  const FONT_OPTIONS = [
    { label: 'Inter', value: DEFAULT_FONT_FAMILY },
    { label: 'Space Grotesk', value: '"Space Grotesk", "Helvetica Neue", Arial, sans-serif' },
    { label: 'Roboto Mono', value: '"Roboto Mono", monospace' },
  ]
  const [uploading, setUploading] = useState(false)
  const createShape = useSceneStore((state) => state.createShapeNode)
  const createImage = useSceneStore((state) => state.createImageNode)
  const createText = useSceneStore((state) => state.createTextNode)
  const nodes = useSceneStore((state) => state.nodes)
  const selectedIds = useSceneStore((state) => state.selectedIds)
  const selectedCount = selectedIds.length
  const updateFill = useSceneStore((state) => state.updateSelectedFill)
  const updateStroke = useSceneStore((state) => state.updateSelectedStroke)
  const updateCornerRadius = useSceneStore((state) => state.updateSelectedCornerRadius)
  const undo = useSceneStore((state) => state.undo)
  const redo = useSceneStore((state) => state.redo)
  const canUndo = useSceneStore((state) => state.history.past.length > 0)
  const canRedo = useSceneStore((state) => state.history.future.length > 0)
  const lockSelected = useSceneStore((state) => state.lockSelected)
  const deleteNodes = useSceneStore((state) => state.deleteNodes)
  const bringForward = useSceneStore((state) => state.bringSelectedForward)
  const sendBackward = useSceneStore((state) => state.sendSelectedBackward)
  const bringToFront = useSceneStore((state) => state.bringSelectedToFront)
  const sendToBack = useSceneStore((state) => state.sendSelectedToBack)
  const setSelectedAspectRatioLocked = useSceneStore((state) => state.setSelectedAspectRatioLocked)
  const updateTextContent = useSceneStore((state) => state.updateSelectedTextContent)
  const setFontFamily = useSceneStore((state) => state.setSelectedFontFamily)
  const setFontSize = useSceneStore((state) => state.setSelectedFontSize)
  const setTextAlign = useSceneStore((state) => state.setSelectedTextAlign)
  const setLineHeight = useSceneStore((state) => state.setSelectedLineHeight)
  const setFontWeight = useSceneStore((state) => state.setSelectedFontWeight)
  const setFontStyle = useSceneStore((state) => state.setSelectedFontStyle)
  const setUnderline = useSceneStore((state) => state.setSelectedUnderline)
  const worldScale = useSceneStore((state) => state.world.scale)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const toolbarSectionsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const container = toolbarSectionsRef.current
    if (!container) return
    const mediaQuery = window.matchMedia('(max-width: 720px)')
    const handleWheel = (event: WheelEvent) => {
      if (!mediaQuery.matches || !container) return
      if (event.ctrlKey || event.metaKey) return
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      event.preventDefault()
      container.scrollLeft += event.deltaY
    }
    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      container.removeEventListener('wheel', handleWheel)
    }
  }, [])

  const firstSelected = useMemo(() => {
    if (selectedIds.length === 0) return null
    return nodes.find((node) => node.id === selectedIds[0]) ?? null
  }, [nodes, selectedIds])

  const fillValue = firstSelected?.fill ?? DEFAULT_FILL
  const strokeValue = firstSelected?.stroke?.color ?? DEFAULT_STROKE
  const strokeWidthValue = firstSelected?.stroke?.width ?? 2
  const cornerRadiusValue =
    firstSelected?.type === 'shape' && firstSelected.shape?.kind === 'rectangle'
      ? firstSelected.shape.cornerRadius ?? 0
      : 0

  const canEditCornerRadius =
    selectedCount > 0 &&
    selectedIds.every((id) => {
      const node = nodes.find((candidate) => candidate.id === id)
      return node?.type === 'shape' && node.shape?.kind === 'rectangle'
    })

  const zoomFactor = useMemo(() => (worldScale !== 0 ? 1 / worldScale : 1), [worldScale])

  const aspectRatioState = useMemo(() => {
    if (selectedIds.length === 0) return null
    const selectedNodes = selectedIds
      .map((id) => nodes.find((node) => node.id === id))
      .filter((node): node is NonNullable<typeof node> => Boolean(node))
    if (selectedNodes.length === 0) return null
    const firstLock = selectedNodes[0].aspectRatioLocked
    const allSame = selectedNodes.every((node) => node.aspectRatioLocked === firstLock)
    return allSame ? firstLock : 'mixed'
  }, [nodes, selectedIds])

  const aspectRatioChecked = aspectRatioState !== false

  const selectedTextNodes = useMemo(
    () =>
      selectedIds
        .map((id) => nodes.find((node) => node.id === id))
        .filter((node): node is SceneNode & { text: TextDefinition } => Boolean(node && node.type === 'text' && node.text)),
    [nodes, selectedIds],
  )

  const canEditText = selectedTextNodes.length > 0 && selectedTextNodes.length === selectedCount
  const firstTextNode = canEditText ? selectedTextNodes[0] : null
  const textContentValue = firstTextNode?.text?.content ?? ''
  const fontFamilyValue = firstTextNode?.text?.fontFamily ?? DEFAULT_FONT_FAMILY
  const fontSizeValue = firstTextNode?.text?.fontSize ?? DEFAULT_FONT_SIZE
  const lineHeightValue = firstTextNode?.text?.lineHeight ?? DEFAULT_LINE_HEIGHT
  const textAlignValue = firstTextNode?.text?.align ?? DEFAULT_TEXT_ALIGN
  const textIsBold = (firstTextNode?.text?.fontWeight ?? DEFAULT_FONT_WEIGHT) >= 600
  const textIsItalic = (firstTextNode?.text?.fontStyle ?? 'normal') === 'italic'
  const textIsUnderline = Boolean(firstTextNode?.text?.underline)

  const handleAddRect = useCallback(() => {
    createShape(
      { kind: 'rectangle', cornerRadius: 0 },
      {
        name: 'Rectangle',
        size: {
          width: DEFAULT_RECT.width * zoomFactor,
          height: DEFAULT_RECT.height * zoomFactor,
        },
      },
    )
  }, [createShape, zoomFactor])

  const handleAddEllipse = useCallback(() => {
    createShape(
      { kind: 'ellipse' },
      {
        name: 'Ellipse',
        size: {
          width: DEFAULT_ELLIPSE.width * zoomFactor,
          height: DEFAULT_ELLIPSE.height * zoomFactor,
        },
      },
    )
  }, [createShape, zoomFactor])

  const handleAddTriangle = useCallback(() => {
    createShape(
      { kind: 'polygon', points: TRIANGLE_POINTS },
      {
        name: 'Triangle',
        size: {
          width: DEFAULT_TRIANGLE.width * zoomFactor,
          height: DEFAULT_TRIANGLE.height * zoomFactor,
        },
      },
    )
  }, [createShape, zoomFactor])

  const handleAddText = useCallback(() => {
    createText()
  }, [createText])

  const handleUploadClick = useCallback(() => {
    uploadInputRef.current?.click()
  }, [])

  const handleUploadFile: ChangeEventHandler<HTMLInputElement> = useCallback(
    async (event) => {
      const file = event.target.files?.[0]
      if (!file) return
      setUploading(true)
      try {
        const { assetId } = await uploadAsset(file)
        const meta = await waitForAssetReady(assetId)
        const intrinsicWidth = meta.width ?? 512
        const intrinsicHeight = meta.height ?? 512
        const tileLevels = summarizeTileLevels(meta.tiles)
        const maxTileLevel = tileLevels.length > 0 ? tileLevels[tileLevels.length - 1].z : undefined
        createImage(
          {
            assetId,
            intrinsicSize: {
              width: intrinsicWidth,
              height: intrinsicHeight,
            },
            tileLevels: tileLevels.length > 0 ? tileLevels : undefined,
            maxTileLevel,
          },
          {
            name: file.name || 'Image',
            size: {
              width: intrinsicWidth * zoomFactor,
              height: intrinsicHeight * zoomFactor,
            },
          },
        )
      } catch (error) {
        console.error('Failed to upload image asset', error)
        alert('Failed to upload image asset. Please try again.')
      } finally {
        setUploading(false)
        event.target.value = ''
      }
    },
    [createImage, zoomFactor],
  )

  const handleFillChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      updateFill(event.target.value)
    },
    [updateFill],
  )

  const handleStrokeColorChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      updateStroke({ color: event.target.value })
    },
    [updateStroke],
  )

  const handleStrokeWidthChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const width = Number.parseFloat(event.target.value)
      if (!Number.isNaN(width)) {
        updateStroke({ width })
      }
    },
    [updateStroke],
  )

  const handleCornerRadiusChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const radius = Number.parseFloat(event.target.value)
      if (!Number.isNaN(radius)) {
        updateCornerRadius(radius)
      }
    },
    [updateCornerRadius],
  )

  const handleAspectRatioToggle = useCallback(() => {
    if (selectedCount === 0) return
    setSelectedAspectRatioLocked(!aspectRatioChecked)
  }, [selectedCount, aspectRatioChecked, setSelectedAspectRatioLocked])

  const handleLockSelected = useCallback(() => {
    lockSelected()
  }, [lockSelected])

  const requestConfirm = useDialogStore((state) => state.requestConfirm)

  const handleDeleteSelected = useCallback(async () => {
    if (selectedCount === 0) return
    const confirmed = await requestConfirm({
      title: selectedCount === 1 ? 'Delete selected item?' : `Delete ${selectedCount} items?`,
      message:
        selectedCount === 1
          ? 'This will remove the selected node permanently.'
          : 'This will remove all selected nodes permanently.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    })
    if (!confirmed) return
    deleteNodes([...selectedIds])
  }, [deleteNodes, selectedCount, selectedIds, requestConfirm])

  const handleBringForward = useCallback(() => {
    bringForward()
  }, [bringForward])

  const handleSendBackward = useCallback(() => {
    sendBackward()
  }, [sendBackward])

  const handleBringToFront = useCallback(() => {
    bringToFront()
  }, [bringToFront])

  const handleSendToBack = useCallback(() => {
    sendToBack()
  }, [sendToBack])

  const handleTextContentChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      updateTextContent(event.target.value)
    },
    [updateTextContent],
  )

  const handleFontFamilyChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      setFontFamily(event.target.value)
    },
    [setFontFamily],
  )

  const handleFontSizeChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const size = Number.parseFloat(event.target.value)
      if (Number.isFinite(size)) {
        setFontSize(size)
      }
    },
    [setFontSize],
  )

  const handleLineHeightChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const lh = Number.parseFloat(event.target.value)
      if (Number.isFinite(lh)) {
        setLineHeight(lh)
      }
    },
    [setLineHeight],
  )

  const handleTextAlignChange = useCallback(
    (align: TextDefinition['align']) => {
      setTextAlign(align)
    },
    [setTextAlign],
  )

  const handleBoldToggle = useCallback(() => {
    const next = textIsBold ? DEFAULT_FONT_WEIGHT : 700
    setFontWeight(next)
  }, [setFontWeight, textIsBold])

  const handleItalicToggle = useCallback(() => {
    setFontStyle(textIsItalic ? 'normal' : 'italic')
  }, [setFontStyle, textIsItalic])

  const handleUnderlineToggle = useCallback(() => {
    setUnderline(!textIsUnderline)
  }, [setUnderline, textIsUnderline])

  const aspectRatioLabel =
    aspectRatioState === 'mixed'
      ? 'Aspect ratio mixed—click to lock'
      : aspectRatioState === false
        ? 'Lock aspect ratio'
        : 'Unlock aspect ratio'

  const aspectRatioIcon =
    aspectRatioState === 'mixed' ? (
      <Lock size={16} strokeWidth={1.8} className="toolbar-icon-mixed" />
    ) : aspectRatioState === false ? (
      <Link2Off size={16} strokeWidth={1.8} />
    ) : (
      <LinkIcon size={16} strokeWidth={1.8} />
    )

  const styleSectionContent = (
    <div className="toolbar-style-grid">
      <label className="toolbar-style-control">
        <span>Fill</span>
        <div className="color-swatch">
          <input type="color" value={fillValue} onChange={handleFillChange} disabled={selectedCount === 0} />
        </div>
      </label>
      <label className="toolbar-style-control">
        <span>Stroke</span>
        <div className="color-swatch">
          <input type="color" value={strokeValue} onChange={handleStrokeColorChange} disabled={selectedCount === 0} />
        </div>
      </label>
      <label className="toolbar-style-control">
        <span>Width</span>
        <input
          type="number"
          min={0}
          step={1}
          value={strokeWidthValue}
          onChange={handleStrokeWidthChange}
          disabled={selectedCount === 0}
        />
      </label>
      <label className="toolbar-style-control">
        <span>Radius</span>
        <input
          type="number"
          min={0}
          step={1}
          value={cornerRadiusValue}
          onChange={handleCornerRadiusChange}
          disabled={!canEditCornerRadius}
        />
      </label>
      <div className="toolbar-style-control toolbar-style-control--aspect">
        <span>Aspect Ratio</span>
        <button
          type="button"
          className={`toolbar-aspect-toggle${
            aspectRatioState === true ? ' toolbar-aspect-toggle--locked' : ''
          }${aspectRatioState === 'mixed' ? ' toolbar-aspect-toggle--mixed' : ''}`}
          onClick={handleAspectRatioToggle}
          disabled={selectedCount === 0}
          aria-pressed={aspectRatioState === true}
          aria-label={aspectRatioLabel}
        >
          <span aria-hidden="true">{aspectRatioIcon}</span>
          <span className="sr-only">{aspectRatioLabel}</span>
        </button>
      </div>
    </div>
  )

  const [textPanelStyle, setTextPanelStyle] = useState({ top: 16, left: 16 })
  const textPanelRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!canEditText) return
    const updatePosition = () => {
      const toolbar = document.querySelector('.scene-toolbar')
      const margin = 16
      const panelRect = textPanelRef.current?.getBoundingClientRect()
      const panelWidth = panelRect?.width ?? 280
      const panelHeight = panelRect?.height ?? 220
      if (!toolbar) {
        setTextPanelStyle({ top: margin, left: margin })
        return
      }
      const toolbarRect = toolbar.getBoundingClientRect()
      const preferRight = toolbarRect.left < window.innerWidth / 2
      let left = preferRight ? toolbarRect.right + margin : toolbarRect.left - panelWidth - margin
      if (left + panelWidth > window.innerWidth - margin) {
        left = window.innerWidth - panelWidth - margin
      }
      if (left < margin) {
        left = margin
      }
      const preferTop = toolbarRect.top < window.innerHeight / 2
      let top = preferTop ? toolbarRect.top : window.innerHeight - panelHeight - margin
      if (top + panelHeight > window.innerHeight - margin) {
        top = window.innerHeight - panelHeight - margin
      }
      if (top < margin) {
        top = margin
      }
      setTextPanelStyle({ top, left })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [canEditText, textContentValue, fontFamilyValue, fontSizeValue, lineHeightValue, textAlignValue])

  const toolbarSections: ToolbarSection[] = [
    {
      key: 'canvas',
      label: 'Canvas',
      commands: [
        {
          key: 'rect',
          label: 'Rectangle',
          icon: <RectangleHorizontal size={16} strokeWidth={1.8} />,
          onClick: handleAddRect,
          variant: 'accent',
        },
        {
          key: 'ellipse',
          label: 'Ellipse',
          icon: <Circle size={16} strokeWidth={1.8} />,
          onClick: handleAddEllipse,
          variant: 'accent',
        },
        {
          key: 'triangle',
          label: 'Triangle',
          icon: <TriangleIcon size={16} strokeWidth={1.8} />,
          onClick: handleAddTriangle,
          variant: 'accent',
        },
        {
          key: 'text',
          label: 'Text',
          icon: <TypeIcon size={16} strokeWidth={1.8} />,
          onClick: handleAddText,
          variant: 'accent',
        },
        {
          key: 'upload',
          label: 'Upload image',
          icon: <ImageUp size={16} strokeWidth={1.8} />,
          onClick: handleUploadClick,
          disabled: uploading,
          loading: uploading,
          variant: 'accent',
        },
      ],
    },
    {
      key: 'style',
      label: 'Style',
      content: styleSectionContent,
    },
    {
      key: 'actions',
      label: 'Actions',
      commands: [
        {
          key: 'lock',
          label: 'Lock selection',
          icon: <Lock size={16} strokeWidth={1.8} />,
          onClick: handleLockSelected,
          disabled: selectedCount === 0,
        },
        {
          key: 'delete',
          label: 'Delete selection',
          icon: <Trash2 size={16} strokeWidth={1.8} />,
          onClick: handleDeleteSelected,
          disabled: selectedCount === 0,
          variant: 'danger',
        },
      ],
    },
    {
      key: 'history',
      label: 'History',
      commands: [
        { key: 'undo', label: 'Undo', icon: <Undo2 size={16} strokeWidth={1.8} />, onClick: undo, disabled: !canUndo },
        { key: 'redo', label: 'Redo', icon: <Redo2 size={16} strokeWidth={1.8} />, onClick: redo, disabled: !canRedo },
      ],
    },
    {
      key: 'layers',
      label: 'Layer Order',
      commands: [
        {
          key: 'forward',
          label: 'Bring forward',
          icon: <ChevronUp size={16} strokeWidth={1.8} />,
          onClick: handleBringForward,
          disabled: selectedCount === 0,
        },
        {
          key: 'backward',
          label: 'Send backward',
          icon: <ChevronDown size={16} strokeWidth={1.8} />,
          onClick: handleSendBackward,
          disabled: selectedCount === 0,
        },
        {
          key: 'front',
          label: 'Bring to front',
          icon: <ArrowUpToLine size={16} strokeWidth={1.8} />,
          onClick: handleBringToFront,
          disabled: selectedCount === 0,
        },
        {
          key: 'back',
          label: 'Send to back',
          icon: <ArrowDownToLine size={16} strokeWidth={1.8} />,
          onClick: handleSendToBack,
          disabled: selectedCount === 0,
        },
      ],
    },
  ]

  return (
    <>
      <aside className="scene-toolbar" role="toolbar" aria-label="Scene actions">
        <div className="toolbar-sections" ref={toolbarSectionsRef}>
        {toolbarSections.map((section) => (
          <section key={section.key} className="toolbar-section">
            <p className="toolbar-label">{section.label}</p>
            {section.commands && section.commands.length > 0 && (
              <div className="toolbar-icon-list">
                {section.commands.map(({ key, ...command }) => (
                  <ToolbarIconButton key={key} {...command} />
                ))}
              </div>
            )}
            {section.content ?? null}
          </section>
        ))}
      </div>
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          onChange={handleUploadFile}
          style={{ display: 'none' }}
        />
      </aside>
      {canEditText && (
        <TextInspectorPanel
          panelRef={textPanelRef}
          style={textPanelStyle}
          textValue={textContentValue}
          onTextChange={handleTextContentChange}
          fontFamily={fontFamilyValue}
          onFontFamilyChange={handleFontFamilyChange}
          fontSize={fontSizeValue}
          onFontSizeChange={handleFontSizeChange}
          lineHeight={lineHeightValue}
          onLineHeightChange={handleLineHeightChange}
          textAlign={textAlignValue}
          onAlignChange={handleTextAlignChange}
          fontOptions={FONT_OPTIONS}
          isBold={textIsBold}
          onToggleBold={handleBoldToggle}
          isItalic={textIsItalic}
          onToggleItalic={handleItalicToggle}
          isUnderline={textIsUnderline}
          onToggleUnderline={handleUnderlineToggle}
        />
      )}
    </>
  )
}

function ToolbarIconButton({ label, icon, onClick, disabled, variant = 'ghost', loading = false }: ToolbarIconButtonProps) {
  const ariaLabel = loading ? `${label} (in progress)` : label
  return (
    <button
      type="button"
      className={`toolbar-icon-button toolbar-icon-button--${variant}`}
      onClick={onClick}
      title={ariaLabel}
      aria-label={ariaLabel}
      disabled={disabled || loading}
      aria-busy={loading}
    >
      <span className={loading ? 'toolbar-icon toolbar-icon--spin' : 'toolbar-icon'} aria-hidden="true">
        {icon}
      </span>
      <span className="sr-only">{ariaLabel}</span>
    </button>
  )
}

interface TextInspectorPanelProps {
  panelRef: RefObject<HTMLDivElement | null>
  style: { top: number; left: number }
  textValue: string
  onTextChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  fontFamily: string
  onFontFamilyChange: (event: ChangeEvent<HTMLSelectElement>) => void
  fontSize: number
  onFontSizeChange: (event: ChangeEvent<HTMLInputElement>) => void
  lineHeight: number
  onLineHeightChange: (event: ChangeEvent<HTMLInputElement>) => void
  textAlign: TextDefinition['align']
  onAlignChange: (align: TextDefinition['align']) => void
  fontOptions: { label: string; value: string }[]
  isBold: boolean
  onToggleBold: () => void
  isItalic: boolean
  onToggleItalic: () => void
  isUnderline: boolean
  onToggleUnderline: () => void
}

function TextInspectorPanel(props: TextInspectorPanelProps) {
  const {
    panelRef,
    style,
    textValue,
    onTextChange,
    fontFamily,
    onFontFamilyChange,
    fontSize,
    onFontSizeChange,
    lineHeight,
    onLineHeightChange,
    textAlign,
    onAlignChange,
    fontOptions,
    isBold,
    onToggleBold,
    isItalic,
    onToggleItalic,
    isUnderline,
    onToggleUnderline,
  } = props

  const content = (
    <div ref={panelRef} className="text-inspector" style={{ top: style.top, left: style.left }}>
      <header>
        <TypeIcon size={16} />
        <span>Text</span>
      </header>
      <label className="toolbar-style-control toolbar-style-control--block">
        <span>Content</span>
        <textarea value={textValue} onChange={onTextChange} rows={3} />
      </label>
      <label className="toolbar-style-control">
        <span>Font</span>
        <select value={fontFamily} onChange={onFontFamilyChange}>
          {fontOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="toolbar-style-control">
        <span>Size</span>
        <input type="number" min={4} step={1} value={fontSize} onChange={onFontSizeChange} />
      </label>
      <label className="toolbar-style-control">
        <span>Line Height</span>
        <input type="number" min={0.5} max={4} step={0.05} value={lineHeight} onChange={onLineHeightChange} />
      </label>
      <div className="toolbar-style-control toolbar-style-control--justify">
        <span>Style</span>
        <div className="toolbar-align-group" role="group" aria-label="Text style">
          <button
            type="button"
            className={`toolbar-align-button${isBold ? ' toolbar-align-button--active' : ''}`}
            onClick={onToggleBold}
            aria-pressed={isBold}
          >
            <BoldIcon size={16} />
          </button>
          <button
            type="button"
            className={`toolbar-align-button${isItalic ? ' toolbar-align-button--active' : ''}`}
            onClick={onToggleItalic}
            aria-pressed={isItalic}
          >
            <ItalicIcon size={16} />
          </button>
          <button
            type="button"
            className={`toolbar-align-button${isUnderline ? ' toolbar-align-button--active' : ''}`}
            onClick={onToggleUnderline}
            aria-pressed={isUnderline}
          >
            <UnderlineIcon size={16} />
          </button>
        </div>
      </div>
      <div className="toolbar-style-control toolbar-style-control--justify">
        <span>Align</span>
        <div className="toolbar-align-group" role="group" aria-label="Text alignment">
          <button
            type="button"
            className={`toolbar-align-button${textAlign === 'left' ? ' toolbar-align-button--active' : ''}`}
            onClick={() => onAlignChange('left')}
            aria-pressed={textAlign === 'left'}
          >
            <AlignLeft size={16} />
          </button>
          <button
            type="button"
            className={`toolbar-align-button${textAlign === 'center' ? ' toolbar-align-button--active' : ''}`}
            onClick={() => onAlignChange('center')}
            aria-pressed={textAlign === 'center'}
          >
            <AlignCenter size={16} />
          </button>
          <button
            type="button"
            className={`toolbar-align-button${textAlign === 'right' ? ' toolbar-align-button--active' : ''}`}
            onClick={() => onAlignChange('right')}
            aria-pressed={textAlign === 'right'}
          >
            <AlignRight size={16} />
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
