export interface FontStyleRequest {
  fontFamily: string
  fontWeight: number | string
  fontStyle: string
  fontSize: number
}

export interface NormalizedFontDescriptor {
  family: string
  weight: number
  italic: boolean
}

export function extractPrimaryFamily(fontFamily: string): string {
  const primary = fontFamily.split(',')[0] ?? ''
  return primary.replace(/["']/g, '').trim() || 'Inter'
}

export function parseFontWeight(weight: number | string): number {
  if (typeof weight === 'number' && Number.isFinite(weight)) {
    return weight
  }
  if (typeof weight === 'string') {
    const trimmed = weight.trim().toLowerCase()
    if (trimmed === 'normal') return 400
    if (trimmed === 'bold') return 700
    const parsed = Number.parseInt(trimmed, 10)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return 400
}

export function normalizeFontRequest(style: FontStyleRequest): NormalizedFontDescriptor {
  return {
    family: extractPrimaryFamily(style.fontFamily),
    weight: parseFontWeight(style.fontWeight),
    italic: style.fontStyle.toLowerCase() === 'italic',
  }
}

export function descriptorKey(descriptor: NormalizedFontDescriptor): string {
  return `${descriptor.family.toLowerCase()}|${descriptor.weight}|${descriptor.italic ? 'italic' : 'normal'}`
}
