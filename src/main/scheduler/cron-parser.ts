/**
 * Cron Parser - Cron 表达式解析器
 * 使用 cron-parser 库解析和计算 cron 表达式
 */

const cronParser = require('cron-parser')

export class CronParser {
  /**
   * 验证 cron 表达式是否合法
   */
  validate(expression: string): boolean {
    try {
      cronParser.parseExpression(expression, {
        tz: 'Asia/Shanghai'
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * 计算下次执行时间
   */
  getNextTime(expression: string, after?: Date): Date {
    try {
      const interval = cronParser.parseExpression(expression, {
        currentDate: after || new Date(),
        tz: 'Asia/Shanghai'
      })
      return interval.next().toDate()
    } catch (error) {
      throw new Error(`Invalid cron expression: ${expression}`)
    }
  }

  /**
   * 计算多个下次执行时间
   */
  getNextTimes(expression: string, count: number, after?: Date): Date[] {
    try {
      const interval = cronParser.parseExpression(expression, {
        currentDate: after || new Date(),
        tz: 'Asia/Shanghai'
      })
      const times: Date[] = []
      for (let i = 0; i < count; i++) {
        times.push(interval.next().toDate())
      }
      return times
    } catch (error) {
      throw new Error(`Invalid cron expression: ${expression}`)
    }
  }

  /**
   * 获取 cron 表达式的可读描述
   */
  describe(expression: string): string {
    try {
      const parts = expression.trim().split(/\s+/)

      // 支持 6 位格式: 秒 分 时 日 月 周
      if (parts.length !== 6) {
        return '无效的 cron 表达式'
      }

      const [sec, min, hour, day, month, weekday] = parts

      // 构建描述
      const descriptions: string[] = []

      // 周期性描述
      if (this.isEvery(sec, min, hour, day, month, weekday)) {
        return this.describeEvery(sec, min, hour)
      }

      // 时间描述
      if (hour !== '*' || min !== '*' || sec !== '*') {
        descriptions.push(this.describeTime(sec, min, hour))
      }

      // 日期描述
      if (day !== '*') {
        descriptions.push(`每月${day}号`)
      }

      // 星期描述
      if (weekday !== '*') {
        descriptions.push(this.describeWeekday(weekday))
      }

      // 月份描述
      if (month !== '*') {
        descriptions.push(this.describeMonth(month))
      }

      return descriptions.join('，') || '每秒'
    } catch {
      return '无效的 cron 表达式'
    }
  }

  /**
   * 判断是否为周期性表达式
   */
  private isEvery(sec: string, min: string, hour: string, day: string, month: string, weekday: string): boolean {
    return (sec.includes('*/') || min.includes('*/') || hour.includes('*/')) &&
           day === '*' && month === '*' && weekday === '*'
  }

  /**
   * 描述周期性表达式
   */
  private describeEvery(sec: string, min: string, hour: string): string {
    if (sec.startsWith('*/')) {
      const interval = parseInt(sec.substring(2))
      return `每${interval}秒`
    }
    if (min.startsWith('*/')) {
      const interval = parseInt(min.substring(2))
      return `每${interval}分钟`
    }
    if (hour.startsWith('*/')) {
      const interval = parseInt(hour.substring(2))
      return `每${interval}小时`
    }
    return '周期执行'
  }

  /**
   * 描述时间
   */
  private describeTime(sec: string, min: string, hour: string): string {
    const parts: string[] = []

    if (hour !== '*') {
      if (hour.includes('-')) {
        const [start, end] = hour.split('-')
        parts.push(`${start}点到${end}点`)
      } else {
        parts.push(`${hour}点`)
      }
    }

    if (min !== '*') {
      parts.push(`${min}分`)
    }

    if (sec !== '*' && sec !== '0') {
      parts.push(`${sec}秒`)
    }

    return parts.join('')
  }

  /**
   * 描述星期
   */
  private describeWeekday(weekday: string): string {
    const weekdayMap: Record<string, string> = {
      '0': '周日',
      '1': '周一',
      '2': '周二',
      '3': '周三',
      '4': '周四',
      '5': '周五',
      '6': '周六',
      '7': '周日'
    }

    if (weekday.includes('-')) {
      const [start, end] = weekday.split('-')
      return `${weekdayMap[start]}到${weekdayMap[end]}`
    }

    if (weekday.includes(',')) {
      const days = weekday.split(',').map(d => weekdayMap[d])
      return days.join('、')
    }

    return weekdayMap[weekday] || weekday
  }

  /**
   * 描述月份
   */
  private describeMonth(month: string): string {
    if (month.includes('-')) {
      const [start, end] = month.split('-')
      return `${start}月到${end}月`
    }

    if (month.includes(',')) {
      const months = month.split(',').map(m => `${m}月`)
      return months.join('、')
    }

    return `${month}月`
  }
}
