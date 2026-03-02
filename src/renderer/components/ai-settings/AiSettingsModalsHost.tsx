import type { ComponentProps } from 'react'
import {
  AddModelModal,
  AddProviderModal,
  ApiKeyManagerModal,
  DefaultParamsModal,
  FetchedModelsModal,
  GlobalDefaultModelModal
} from './AiSettingsModals'

interface AiSettingsModalsHostProps {
  fetchedModelsModalProps: ComponentProps<typeof FetchedModelsModal>
  apiKeyManagerModalProps: ComponentProps<typeof ApiKeyManagerModal>
  addProviderModalProps: ComponentProps<typeof AddProviderModal>
  addModelModalProps: ComponentProps<typeof AddModelModal>
  defaultParamsModalProps: ComponentProps<typeof DefaultParamsModal>
  globalDefaultModelModalProps: ComponentProps<typeof GlobalDefaultModelModal>
}

export default function AiSettingsModalsHost({
  fetchedModelsModalProps,
  apiKeyManagerModalProps,
  addProviderModalProps,
  addModelModalProps,
  defaultParamsModalProps,
  globalDefaultModelModalProps
}: AiSettingsModalsHostProps) {
  return (
    <>
      <FetchedModelsModal {...fetchedModelsModalProps} />
      <ApiKeyManagerModal {...apiKeyManagerModalProps} />
      <AddProviderModal {...addProviderModalProps} />
      <AddModelModal {...addModelModalProps} />
      <DefaultParamsModal {...defaultParamsModalProps} />
      <GlobalDefaultModelModal {...globalDefaultModelModalProps} />
    </>
  )
}
