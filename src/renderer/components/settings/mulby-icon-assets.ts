import type { MulbyIconId } from '../../../shared/floating-ball-icons'
import mulbyV1 from '../../../../resources/icons/mulby-v1.svg'
import mulbyV2 from '../../../../resources/icons/mulby-v2.svg'
import mulbyV3 from '../../../../resources/icons/mulby-v3.svg'
import mulbyV4 from '../../../../resources/icons/mulby-v4.svg'
import mulbyV5 from '../../../../resources/icons/mulby-v5.svg'
import mulbyV6 from '../../../../resources/icons/mulby-v6.svg'
import mulbyV7 from '../../../../resources/icons/mulby-v7.svg'
import mulbyV8 from '../../../../resources/icons/mulby-v8.svg'
import mulbyV9 from '../../../../resources/icons/mulby-v9.svg'
import mulbyV10 from '../../../../resources/icons/mulby-v10.svg'

export interface MulbyIconAsset {
  id: MulbyIconId
  title: string
  previewSrc: string
}

export const MULBY_ICON_ASSETS: MulbyIconAsset[] = [
  { id: 'v1', title: 'Mulby V1', previewSrc: mulbyV1 },
  { id: 'v2', title: 'Mulby V2', previewSrc: mulbyV2 },
  { id: 'v3', title: 'Mulby V3', previewSrc: mulbyV3 },
  { id: 'v4', title: 'Mulby V4', previewSrc: mulbyV4 },
  { id: 'v5', title: 'Mulby V5', previewSrc: mulbyV5 },
  { id: 'v6', title: 'Mulby V6', previewSrc: mulbyV6 },
  { id: 'v7', title: 'Mulby V7', previewSrc: mulbyV7 },
  { id: 'v8', title: 'Mulby V8', previewSrc: mulbyV8 },
  { id: 'v9', title: 'Mulby V9', previewSrc: mulbyV9 },
  { id: 'v10', title: 'Mulby V10', previewSrc: mulbyV10 }
]
