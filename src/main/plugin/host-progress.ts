import type { ToolProgressResponse } from './host-protocol'

export interface PendingToolProgressRequest {
  onToolProgress?: (progress: ToolProgressResponse['payload']) => void
}

export interface ToolProgressHostLike {
  pendingRequests: Map<string, PendingToolProgressRequest>
}

export function routeHostToolProgress(host: ToolProgressHostLike, message: ToolProgressResponse): void {
  const pending = host.pendingRequests.get(message.id)
  if (!pending?.onToolProgress) return
  pending.onToolProgress(message.payload)
}
