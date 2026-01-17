interface PluginContext {
  api: {
    clipboard: {
      readText: () => string
      writeText: (text: string) => Promise<void>
      readImage: () => ArrayBuffer | null
      getFormat: () => string
    }
    notification: {
      show: (message: string, type?: string) => void
    }
  }
  input?: string
  featureCode?: string
}

function digitUppercase(n: number): string {
  const fraction = ['角', '分']
  const digit = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
  const unit = [['元', '万', '亿'], ['', '拾', '佰', '仟']]
  const head = n < 0 ? '欠' : ''
  n = Math.abs(n)
  let s = ''

  for (let i = 0; i < fraction.length; i++) {
    s += (digit[Math.floor(n * 10 * Math.pow(10, i)) % 10] + fraction[i]).replace(/零./, '')
  }
  s = s || '整'
  n = Math.floor(n)

  for (let i = 0; i < unit[0].length && n > 0; i++) {
    let p = ''
    for (let j = 0; j < unit[1].length && n > 0; j++) {
      p = digit[n % 10] + unit[1][j] + p
      n = Math.floor(n / 10)
    }
    s = p.replace(/(零.)*零$/, '').replace(/^$/, '零') + unit[0][i] + s
  }
  return head + s.replace(/(零.)*零元/, '元')
    .replace(/(零.)+/g, '零')
    .replace(/^整$/, '零元整')
}

export function onLoad() {
  console.log('[currency-converter] 插件已加载')
}

export function onUnload() {
  console.log('[currency-converter] 插件已卸载')
}

export function onEnable() {
  console.log('[currency-converter] 插件已启用')
}

export function onDisable() {
  console.log('[currency-converter] 插件已禁用')
}

export async function run(context: PluginContext) {
  const { clipboard, notification } = context.api
  let text = context.input

  if (!text) {
    try {
      text = await clipboard.readText()
    } catch (e) {
      // Ignore clipboard error
    }
  }

  if (!text) {
    notification.show('请输入数字金额', 'warning')
    return
  }

  // Remove commas if present (e.g. 1,000.00)
  text = text.replace(/,/g, '').trim()

  const num = parseFloat(text)

  if (isNaN(num)) {
    notification.show('无效的数字金额', 'error')
    return
  }

  // Limit max value to avoid precision issues slightly beyond trillions
  if (num > 9999999999999.99) {
    notification.show('金额过大', 'error')
    return;
  }

  try {
    const result = digitUppercase(num)
    await clipboard.writeText(result)
    notification.show(`已复制: ${result}`)
  } catch (e) {
    notification.show('转换失败', 'error')
    console.error(e)
  }
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
