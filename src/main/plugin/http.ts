import { net } from 'electron'

export interface HttpRequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'
  headers?: Record<string, string>
  body?: string | object
  timeout?: number
}

export interface HttpResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  data: string
}

export class PluginHttp {
  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    const { url, method = 'GET', headers = {}, body, timeout = 30000 } = options

    return new Promise((resolve, reject) => {
      const request = net.request({
        url,
        method
      })

      // 设置请求头
      for (const [key, value] of Object.entries(headers)) {
        request.setHeader(key, value)
      }

      // 设置超时
      const timer = setTimeout(() => {
        request.abort()
        reject(new Error('Request timeout'))
      }, timeout)

      const responseChunks: Buffer[] = []
      const responseHeaders: Record<string, string> = {}

      request.on('response', (response) => {
        // 收集响应头
        for (const [key, value] of Object.entries(response.headers)) {
          responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value || ''
        }

        response.on('data', (chunk) => {
          responseChunks.push(chunk)
        })

        response.on('end', () => {
          clearTimeout(timer)
          const data = Buffer.concat(responseChunks).toString('utf-8')
          resolve({
            status: response.statusCode,
            statusText: response.statusMessage || '',
            headers: responseHeaders,
            data
          })
        })

        response.on('error', (error: Error) => {
          clearTimeout(timer)
          reject(error)
        })
      })

      request.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })

      // 发送请求体
      if (body) {
        const bodyStr = typeof body === 'object' ? JSON.stringify(body) : body
        if (typeof body === 'object' && !headers['Content-Type']) {
          request.setHeader('Content-Type', 'application/json')
        }
        request.write(bodyStr)
      }

      request.end()
    })
  }

  // 便捷方法
  async get(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request({ url, method: 'GET', headers })
  }

  async post(url: string, body?: string | object, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request({ url, method: 'POST', body, headers })
  }

  async put(url: string, body?: string | object, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request({ url, method: 'PUT', body, headers })
  }

  async delete(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request({ url, method: 'DELETE', headers })
  }
}
