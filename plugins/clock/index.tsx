import { useEffect, useState } from 'react'
import type { Plugin } from '@terminal/plugin'
import './clock.css'

const time = new Intl.DateTimeFormat('ru-RU', { timeStyle: 'medium' })
const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' })
const date = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' })

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <div className="clock">
    <time dateTime={now.toISOString()}>{time.format(now)}</time>
    <div className="clock-day">{weekday.format(now)}</div>
    <div>{date.format(now)}</div>
  </div>
}

export default { Widget: Clock } satisfies Plugin
