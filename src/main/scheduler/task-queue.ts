/**
 * Task Queue - 最小堆优先队列
 * 用于高效管理任务调度
 */

import type { Task } from './types'

export class TaskQueue {
  private heap: Task[] = []

  /**
   * 获取队列大小
   */
  get size(): number {
    return this.heap.length
  }

  /**
   * 队列是否为空
   */
  isEmpty(): boolean {
    return this.heap.length === 0
  }

  /**
   * 添加任务到队列
   */
  push(task: Task): void {
    if (!task.nextRunTime) {
      throw new Error('Task must have nextRunTime to be queued')
    }
    this.heap.push(task)
    this.bubbleUp(this.heap.length - 1)
  }

  /**
   * 查看最近的任务（不移除）
   */
  peek(): Task | null {
    return this.heap[0] || null
  }

  /**
   * 移除并返回最近的任务
   */
  pop(): Task | null {
    if (this.heap.length === 0) return null
    if (this.heap.length === 1) return this.heap.pop()!

    const top = this.heap[0]
    this.heap[0] = this.heap.pop()!
    this.bubbleDown(0)
    return top
  }

  /**
   * 移除指定任务
   */
  remove(taskId: string): boolean {
    const index = this.heap.findIndex(t => t.id === taskId)
    if (index === -1) return false

    if (index === this.heap.length - 1) {
      this.heap.pop()
      return true
    }

    this.heap[index] = this.heap.pop()!

    // 可能需要向上或向下调整
    const parentIndex = Math.floor((index - 1) / 2)
    if (index > 0 && this.heap[index].nextRunTime! < this.heap[parentIndex].nextRunTime!) {
      this.bubbleUp(index)
    } else {
      this.bubbleDown(index)
    }

    return true
  }

  /**
   * 更新任务（移除后重新插入）
   */
  update(task: Task): boolean {
    const removed = this.remove(task.id)
    if (removed && task.nextRunTime) {
      this.push(task)
    }
    return removed
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.heap = []
  }

  /**
   * 获取所有任务（不保证顺序）
   */
  toArray(): Task[] {
    return [...this.heap]
  }

  /**
   * 向上调整堆
   */
  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      if (this.compare(this.heap[index], this.heap[parentIndex]) >= 0) {
        break
      }
      [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]]
      index = parentIndex
    }
  }

  /**
   * 向下调整堆
   */
  private bubbleDown(index: number): void {
    while (true) {
      let smallest = index
      const left = 2 * index + 1
      const right = 2 * index + 2

      if (left < this.heap.length &&
          this.compare(this.heap[left], this.heap[smallest]) < 0) {
        smallest = left
      }
      if (right < this.heap.length &&
          this.compare(this.heap[right], this.heap[smallest]) < 0) {
        smallest = right
      }
      if (smallest === index) break

      [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]]
      index = smallest
    }
  }

  /**
   * 比较两个任务的优先级
   * 返回负数表示 a 优先级更高，正数表示 b 优先级更高
   */
  private compare(a: Task, b: Task): number {
    // 先比较优先级（高优先级在前）
    const priorityA = a.priority ?? 5
    const priorityB = b.priority ?? 5
    if (priorityA !== priorityB) {
      return priorityB - priorityA  // 优先级高的排在前面
    }

    // 优先级相同，比较执行时间（早的在前）
    return (a.nextRunTime ?? 0) - (b.nextRunTime ?? 0)
  }
}
