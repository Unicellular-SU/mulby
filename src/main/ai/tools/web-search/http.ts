/**
 * Web 搜索 — HTTP 请求辅助函数和 URL 安全检查
 */
import https from 'node:https'
import http from 'node:http'

// ==================== URL 安全检查 ====================

/**
 * 检测 URL 是否指向内网 / 本地地址（防止 SSRF）
 *
 * 覆盖 RFC 1918 私有地址、环回地址、链路本地地址等。
 * 不做 DNS 解析（避免阻塞），仅检查 hostname 字面量。
 */
export function isPrivateUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()

    // 环回地址
    if (hostname === 'localhost' || hostname === '::1') return true
    if (hostname.startsWith('127.')) return true

    // IPv4 私有地址段
    if (hostname.startsWith('10.')) return true
    if (hostname.startsWith('192.168.')) return true
    if (hostname.startsWith('0.')) return true
    // 172.16.0.0 - 172.31.255.255
    if (hostname.startsWith('172.')) {
      const second = Number(hostname.split('.')[1])
      if (second >= 16 && second <= 31) return true
    }

    // 链路本地地址
    if (hostname.startsWith('169.254.')) return true
    // IPv6 私有 / 链路本地
    if (hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80')) return true

    return false
  } catch {
    return true // URL 解析失败视为不安全
  }
}

// ==================== HTTP GET ====================

export function httpGet(input: {
  url: string
  headers?: Record<string, string>
  timeoutMs: number
  maxBytes: number
}): Promise<{ status: number; body: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(input.url)
    const requester = parsedUrl.protocol === 'https:' ? https : http

    const req = requester.request(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'GET',
        headers: input.headers || {}
      },
      (res) => {
        // 跟踪重定向
        const status = Number(res.statusCode || 0)
        if (status >= 300 && status < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, parsedUrl).toString()
          httpGet({ ...input, url: redirectUrl })
            .then(resolve)
            .catch(reject)
          return
        }

        const chunks: Buffer[] = []
        let bytes = 0
        let truncated = false

        res.on('data', (chunk: Buffer) => {
          const data = Buffer.from(chunk)
          if (bytes >= input.maxBytes) {
            truncated = true
            return
          }
          const remaining = input.maxBytes - bytes
          if (data.length <= remaining) {
            chunks.push(data)
            bytes += data.length
          } else {
            chunks.push(data.subarray(0, remaining))
            bytes = input.maxBytes
            truncated = true
          }
        })

        res.on('end', () => {
          resolve({
            status,
            body: Buffer.concat(chunks).toString('utf8'),
            truncated
          })
        })

        res.on('error', (error) => reject(error))
      }
    )

    req.setTimeout(input.timeoutMs, () => {
      req.destroy(new Error('Web fetch request timeout'))
    })

    req.on('error', (error) => reject(error))
    req.end()
  })
}

// ==================== HTTP POST ====================

export function httpPost(input: {
  url: string
  headers?: Record<string, string>
  body: string
  timeoutMs: number
  maxBytes: number
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(input.url)
    const requester = parsedUrl.protocol === 'https:' ? https : http

    const req = requester.request(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(input.body)),
          ...input.headers
        }
      },
      (res) => {
        const status = Number(res.statusCode || 0)
        const chunks: Buffer[] = []
        let bytes = 0

        res.on('data', (chunk: Buffer) => {
          const data = Buffer.from(chunk)
          if (bytes < input.maxBytes) {
            const remaining = input.maxBytes - bytes
            chunks.push(data.length <= remaining ? data : data.subarray(0, remaining))
            bytes += data.length
          }
        })

        res.on('end', () => {
          resolve({
            status,
            body: Buffer.concat(chunks).toString('utf8')
          })
        })

        res.on('error', (error) => reject(error))
      }
    )

    req.setTimeout(input.timeoutMs, () => {
      req.destroy(new Error('HTTP POST request timeout'))
    })

    req.on('error', (error) => reject(error))
    req.write(input.body)
    req.end()
  })
}
