import { useEffect, useState } from 'react'
import { useTranslation, type Plugin } from '@terminal/plugin'
import './clock.css'

const formats = Object.fromEntries(['ru', 'en'].map(language => [language, {
  time: new Intl.DateTimeFormat(language, { timeStyle: 'medium' }),
  weekday: new Intl.DateTimeFormat(language, { weekday: 'long' }),
  date: new Intl.DateTimeFormat(language, { dateStyle: 'long' }),
}]))

function Clock() {
  const { language } = useTranslation()
  const { time, weekday, date } = formats[language]
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
