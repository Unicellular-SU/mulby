import { app } from 'electron'
import { join } from 'path'

export function getNativeBuildAddonPathCandidates(fileName: string): string[] {
  if (!app.isPackaged) {
    return [
      join(app.getAppPath(), 'native', 'build', 'Release', fileName)
    ]
  }

  return [
    join(process.resourcesPath, 'app.asar.unpacked', 'native', 'build', 'Release', fileName),
    join(process.resourcesPath, 'native', 'build', 'Release', fileName)
  ]
}
