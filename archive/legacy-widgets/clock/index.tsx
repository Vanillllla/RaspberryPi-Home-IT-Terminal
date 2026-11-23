import { useEffect, useState } from 'react'
import { useTranslation, type Plugin, type WidgetProps } from '@terminal/plugin'
import './clock.css'

const formats = Object.fromEntries(['ru', 'en'].map(language => [language, {
  time: new Intl.DateTimeFormat(language, { timeStyle: 'medium' }),
  weekday: new Intl.DateTimeFormat(language, { weekday: 'long' }),
  date: new Intl.DateTimeFormat(language, { dateStyle: 'long' }),
  compactDate: new Intl.DateTimeFormat(language, { weekday: 'short', day: 'numeric', month: 'short' }),
}]))

function Clock({ instance }: WidgetProps) {
  const { language } = useTranslation()
  const { time, weekday, date, compactDate } = formats[language]
  const compact = instance.height === 1
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <div className={compact ? 'clock clock--compact' : 'clock'}>
    <time dateTime={now.toISOString()}>{time.format(now)}</time>
    {compact ? <div className="clock-day" title={date.format(now)}>{compactDate.format(now)}</div> : <>
      <div className="clock-day">{weekday.format(now)}</div>
      <div>{date.format(now)}</div>
    </>}
  </div>
}

export default { Widget: Clock } satisfies Plugin
