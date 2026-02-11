import * as fs from 'fs-extra'
import * as path from 'path'
import chalk from 'chalk'
import { copyDefaultIcon } from './assets'
import {
  buildAppTsx,
  buildBackendMain,
  buildIndexHtml,
  buildMulbyTypes,
  buildMainTsx,
  buildReactManifest,
  buildReactPackageJson,
  buildStylesCss,
  buildTsConfig,
  buildUseMulby,
  buildViteConfig,
  buildGitignore,
  buildReactReadme,
  buildPostcssConfig,
  buildTailwindConfig
} from './templates/react/index.js'

export async function createReactProject(targetDir: string, name: string) {
  fs.mkdirSync(targetDir, { recursive: true })
  fs.mkdirSync(path.join(targetDir, 'src'))
  fs.mkdirSync(path.join(targetDir, 'src/ui'))

  copyDefaultIcon(targetDir)
  createReactManifest(targetDir, name)
  createReactPackageJson(targetDir, name)
  createTsConfig(targetDir)
  createViteConfig(targetDir)
  createPostcssConfig(targetDir)
  createTailwindConfig(targetDir)
  createBackendMain(targetDir, name)
  createReactUI(targetDir, name)
  createMulbyTypes(targetDir)
  createGitignore(targetDir)
  createReadme(targetDir, name)

  // 复制 API 参考文档
  const apiDocSrc = path.join(__dirname, '../../..', 'PLUGIN_DEVELOP_PROMPT.md')
  if (fs.existsSync(apiDocSrc)) {
    fs.copyFileSync(apiDocSrc, path.join(targetDir, 'PLUGIN_DEVELOP_PROMPT.md'))
    console.log(chalk.green('  ✓ PLUGIN_DEVELOP_PROMPT.md'))
  }
}

function createReactManifest(targetDir: string, name: string) {
  const manifest = buildReactManifest(name)
  fs.writeJsonSync(path.join(targetDir, 'manifest.json'), manifest, { spaces: 2 })
  console.log(chalk.green('  ✓ manifest.json'))
}

function createReactPackageJson(targetDir: string, name: string) {
  const pkg = buildReactPackageJson(name)
  fs.writeJsonSync(path.join(targetDir, 'package.json'), pkg, { spaces: 2 })
  console.log(chalk.green('  ✓ package.json'))
}

function createTsConfig(targetDir: string) {
  const tsconfig = buildTsConfig()
  fs.writeJsonSync(path.join(targetDir, 'tsconfig.json'), tsconfig, { spaces: 2 })
  console.log(chalk.green('  ✓ tsconfig.json'))
}

function createViteConfig(targetDir: string) {
  const viteConfig = buildViteConfig()
  fs.writeFileSync(path.join(targetDir, 'vite.config.ts'), viteConfig)
  console.log(chalk.green('  ✓ vite.config.ts'))
}

function createPostcssConfig(targetDir: string) {
  const config = buildPostcssConfig()
  fs.writeFileSync(path.join(targetDir, 'postcss.config.js'), config)
  console.log(chalk.green('  ✓ postcss.config.js'))
}

function createTailwindConfig(targetDir: string) {
  const config = buildTailwindConfig()
  fs.writeFileSync(path.join(targetDir, 'tailwind.config.js'), config)
  console.log(chalk.green('  ✓ tailwind.config.js'))
}

function createBackendMain(targetDir: string, name: string) {
  const mainTs = buildBackendMain(name)
  fs.writeFileSync(path.join(targetDir, 'src/main.ts'), mainTs)
  console.log(chalk.green('  ✓ src/main.ts'))
}

function createReactUI(targetDir: string, name: string) {
  fs.mkdirSync(path.join(targetDir, 'src/ui/hooks'), { recursive: true })

  const indexHtml = buildIndexHtml(name)
  fs.writeFileSync(path.join(targetDir, 'src/ui/index.html'), indexHtml)
  console.log(chalk.green('  ✓ src/ui/index.html'))

  const mainTsx = buildMainTsx()
  fs.writeFileSync(path.join(targetDir, 'src/ui/main.tsx'), mainTsx)
  console.log(chalk.green('  ✓ src/ui/main.tsx'))

  const appTsx = buildAppTsx(name)
  fs.writeFileSync(path.join(targetDir, 'src/ui/App.tsx'), appTsx)
  console.log(chalk.green('  ✓ src/ui/App.tsx'))

  const stylesCss = buildStylesCss()
  fs.writeFileSync(path.join(targetDir, 'src/ui/styles.css'), stylesCss)
  console.log(chalk.green('  ✓ src/ui/styles.css'))

  const useMulby = buildUseMulby()
  fs.writeFileSync(path.join(targetDir, 'src/ui/hooks/useMulby.ts'), useMulby)
  console.log(chalk.green('  ✓ src/ui/hooks/useMulby.ts'))
}

function createMulbyTypes(targetDir: string) {
  fs.mkdirSync(path.join(targetDir, 'src/types'), { recursive: true })

  const typesDts = buildMulbyTypes()
  fs.writeFileSync(path.join(targetDir, 'src/types/mulby.d.ts'), typesDts)
  console.log(chalk.green('  ✓ src/types/mulby.d.ts'))
}

function createGitignore(targetDir: string) {
  const gitignore = buildGitignore()
  fs.writeFileSync(path.join(targetDir, '.gitignore'), gitignore)
  console.log(chalk.green('  ✓ .gitignore'))
}

function createReadme(targetDir: string, name: string) {
  const readme = buildReactReadme(name)
  fs.writeFileSync(path.join(targetDir, 'README.md'), readme)
  console.log(chalk.green('  ✓ README.md'))
}
