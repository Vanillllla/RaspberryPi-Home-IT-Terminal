import { useState, type FormEvent } from 'react'
import { useTranslation, WidgetSlider, WidgetSwitch, type Plugin, type WidgetProps } from '@terminal/plugin'
import './demo.css'

function labelOf({ settings }: WidgetProps['instance'], t: ReturnType<typeof useTranslation>['t']) {
  return typeof settings.label === 'string' ? settings.label : t('Мой демовиджет')
}

function Widget({ instance }: WidgetProps) {
  const { t } = useTranslation()
  const [count, setCount] = useState(0)
  const [enabled, setEnabled] = useState(false)
  const [checkedEnabled, setCheckedEnabled] = useState(false)
  const [level, setLevel] = useState(0)
  const levelColor = [t('зелёный'), t('жёлтый'), t('красный')][level]

  return <div className="demo-widget">
    <div className="demo-row">
      <strong>{labelOf(instance, t)}</strong>
      <button className="widget-button" onClick={() => setCount(n => n + 1)}>{t('Нажатий: {count}', { count })}</button>
    </div>
    <div className="demo-row">
      <WidgetSwitch label={t("Вкл. / Выкл.")} checked={enabled} onChange={setEnabled} />
      <button className="widget-button" onClick={() => setCheckedEnabled(enabled)}>{t("Проверить")}</button>
      <output className="widget-output widget-status" data-color={checkedEnabled ? 'red' : 'green'}>{t("Статус")}
        <span className="demo-sr-only"> — {checkedEnabled ? t('красный') : t('зелёный')}</span>
      </output>
    </div>
    <div className="demo-row">
      <WidgetSlider label={t("Цвет второго статуса")} min={0} max={2} step={1} value={level}
        valueText={levelColor} onChange={setLevel} />
      <output className="widget-output widget-status" data-color={['green', 'yellow', 'red'][level]}>{t("Статус 2")}<span className="demo-sr-only"> — {levelColor}</span></output>
    </div>
  </div>
}

function Details({ instance }: WidgetProps) {
  const { t } = useTranslation()
  return <div className="demo-details">
    <h3>{labelOf(instance, t)}</h3>
    <dl>
      <dt>{t("Экземпляр")}</dt><dd>{instance.id}</dd>
      <dt>{t("Рабочий стол")}</dt><dd>{instance.desktop_id}</dd>
      <dt>{t("Ячейка")}</dt><dd>{instance.slot + 1}</dd>
      <dt>{t("Плагин")}</dt><dd>{instance.plugin_id}</dd>
    </dl>
  </div>
}

const Settings: NonNullable<Plugin['Settings']> = ({ instance, saveSettings }) => {
  const { t } = useTranslation()
  const [label, setLabel] = useState(() => labelOf(instance, t))
  const [edited, setEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await saveSettings(edited ? { ...instance.settings, label } : instance.settings)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Не удалось сохранить подпись'))
    } finally {
      setSaving(false)
    }
  }

  return <form className="demo-form" onSubmit={submit}>
    <label>{t("Подпись")}<input value={label} disabled={saving} required onChange={e => {
      setEdited(true)
      setLabel(e.target.value)
      setError('')
    }} /></label>
    {error && <p role="alert">{error}</p>}
  </form>
}

export default { Widget, Details, Settings } satisfies Plugin
