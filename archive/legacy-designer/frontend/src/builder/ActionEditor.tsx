import { useTranslation } from '../i18n'
import { actionKinds, actionName, contextExpression, itemLabel, type Action, type Item } from './model'

interface Props { action: Action; items: Item[]; update: (change: Partial<Action>) => void }

export function ActionEditor({ action, items, update }: Props) {
  const { t: translate } = useTranslation()
  const receivers = items.filter(e => e.kind === 'text' || e.kind === 'indicator')
  const senders = items.filter(e => ['button', 'switch', 'slider'].includes(e.kind) && e.command && e.command === action.command)
  function toggle(id: string, checked: boolean) {
    update({ targets: checked ? [...action.targets, { element: id, field: action.kind === 'reach' ?
      (items.find(e => e.id === id)?.kind === 'indicator' ? 'color' : 'text') : '' }] :
      action.targets.filter(t => t.element !== id) })
  }
  return <>
    <label>{translate('Выполнить')}<select value={action.kind} onChange={e => {
      const kind = e.target.value as Action['kind']
      update({ kind, name: action.defaultName || action.name === translate(actionKinds[action.kind]) ? translate(actionKinds[kind]) : action.name })
    }}>{Object.entries(actionKinds).map(([id, label]) => <option key={id} value={id}>{translate(label)}</option>)}</select></label>
    <label>{translate('Название действия')}<input value={actionName(action, translate)} onChange={e => update({ name: e.target.value, defaultName: false })} /></label>
    <label>{translate('Запуск')}<select value={action.trigger} onChange={e => update({ trigger: e.target.value as Action['trigger'] })}>
      <option value="timer">{translate('По таймеру')}</option><option value="command">{translate('По команде')}</option>
    </select></label>
    {action.trigger === 'timer' ?
      <label>{translate('Интервал, с')}<input type="number" min="1" step="1" value={action.interval} onChange={e => update({ interval: Number(e.target.value) })} /></label> :
      <><label>{translate('Команда запуска')}<input value={action.command} onChange={e => update({ command: e.target.value })} /></label>
        <small>{translate('Элементы-отправители ·')} {senders.map(e => itemLabel(e, translate)).join(', ') || translate('не выбраны')}</small></>}
    {action.kind === 'reach' && <>
      <label>{translate('IP или имя хоста')}<input value={action.host} onChange={e => update({ host: e.target.value })} /></label>
      <label>{translate('Порт TCP (пусто для ICMP)')}<input type="number" min="1" max="65535" value={action.port ?? ''}
        onChange={e => update({ port: e.target.value ? Number(e.target.value) : null })} /></label>
    </>}
    {action.kind === 'http' && <>
      <label>URL<input type="url" placeholder="http://server/api/status" value={action.url} onChange={e => update({ url: e.target.value })} /></label>
      <label>{translate('Поле JSON')}<input placeholder="cpu.temperature" value={action.path} onChange={e => update({ path: e.target.value })} /></label>
    </>}
    {action.kind === 'python' && <>
      <label>{translate('Код Python')}<textarea rows={7} spellCheck={false} value={action.code} onChange={e => update({ code: e.target.value })} /></label>
      <small>{translate('Чтобы вывести цветное число, верните словарь с ключами text и color. Для текстового получателя оставьте «Поле результата» пустым.')}</small>
      <details><summary>{translate('Значения в context')}</summary>{items.map(e =>
        <p key={e.id}>{itemLabel(e, translate)} · <code>{contextExpression(e.id)}</code></p>)}</details>
    </>}
    <fieldset><legend>{translate('Получатели результата')}</legend>
      {!receivers.length && <small>{translate('Добавьте текст или индикатор.')}</small>}
      {receivers.map(e => {
        const target = action.targets.find(t => t.element === e.id)
        return <div className="builder-binding" key={e.id}>
          <label className="builder-check"><input type="checkbox" checked={!!target}
            onChange={event => toggle(e.id, event.target.checked)} />{itemLabel(e, translate)}</label>
          {target && <label>{translate('Поле результата')}<input value={target.field} placeholder={translate('Весь результат')}
            onChange={event => update({ targets: action.targets.map(t =>
              t.element === e.id ? { ...t, field: event.target.value } : t) })} /></label>}
        </div>
      })}
      {action.targets.filter(t => !receivers.some(e => e.id === t.element)).map(t =>
        <button key={t.element} onClick={() => toggle(t.element, false)}>{translate('Убрать связь с удалённым {id}', { id: t.element })}</button>)}
    </fieldset>
  </>
}
