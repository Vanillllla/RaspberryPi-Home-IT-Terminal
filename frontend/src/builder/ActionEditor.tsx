import { actionKinds, type Action, type Item } from './model'

interface Props { action: Action; items: Item[]; update: (change: Partial<Action>) => void }

export function ActionEditor({ action, items, update }: Props) {
  const receivers = items.filter(e => e.kind === 'text' || e.kind === 'indicator')
  const senders = items.filter(e => ['button', 'switch', 'slider'].includes(e.kind) && e.command && e.command === action.command)
  function toggle(id: string, checked: boolean) {
    update({ targets: checked ? [...action.targets, { element: id, field: action.kind === 'reach' ?
      (items.find(e => e.id === id)?.kind === 'indicator' ? 'color' : 'text') : '' }] :
      action.targets.filter(t => t.element !== id) })
  }
  return <>
    <label>Выполнить<select value={action.kind} onChange={e => {
      const kind = e.target.value as Action['kind']
      update({ kind, name: action.name === actionKinds[action.kind] ? actionKinds[kind] : action.name })
    }}>{Object.entries(actionKinds).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <label>Название действия<input value={action.name} onChange={e => update({ name: e.target.value })} /></label>
    <label>Запуск<select value={action.trigger} onChange={e => update({ trigger: e.target.value as Action['trigger'] })}>
      <option value="timer">По таймеру</option><option value="command">По команде</option>
    </select></label>
    {action.trigger === 'timer' ?
      <label>Интервал, с<input type="number" min="1" step="1" value={action.interval} onChange={e => update({ interval: Number(e.target.value) })} /></label> :
      <><label>Команда запуска<input value={action.command} onChange={e => update({ command: e.target.value })} /></label>
        <small>Отправители · {senders.map(e => e.label).join(', ') || 'не выбраны'}</small></>}
    {action.kind === 'reach' && <>
      <label>IP или имя хоста<input value={action.host} onChange={e => update({ host: e.target.value })} /></label>
      <label>Порт TCP (пусто для ICMP)<input type="number" min="1" max="65535" value={action.port ?? ''}
        onChange={e => update({ port: e.target.value ? Number(e.target.value) : null })} /></label>
    </>}
    {action.kind === 'http' && <>
      <label>URL<input type="url" placeholder="http://server/api/status" value={action.url} onChange={e => update({ url: e.target.value })} /></label>
      <label>Поле JSON<input placeholder="cpu.temperature" value={action.path} onChange={e => update({ path: e.target.value })} /></label>
    </>}
    {action.kind === 'python' && <>
      <label>Код Python<textarea rows={7} spellCheck={false} value={action.code} onChange={e => update({ code: e.target.value })} /></label>
      <details><summary>Значения в context</summary>{items.map(e =>
        <p key={e.id}>{e.label} · <code>{'context["values"]["' + e.id + '"]'}</code></p>)}</details>
    </>}
    <fieldset><legend>Получатели результата</legend>
      {!receivers.length && <small>Добавьте текст или индикатор.</small>}
      {receivers.map(e => {
        const target = action.targets.find(t => t.element === e.id)
        return <div className="builder-binding" key={e.id}>
          <label className="builder-check"><input type="checkbox" checked={!!target}
            onChange={event => toggle(e.id, event.target.checked)} />{e.label}</label>
          {target && <label>Поле результата<input value={target.field} placeholder="Весь результат"
            onChange={event => update({ targets: action.targets.map(t =>
              t.element === e.id ? { ...t, field: event.target.value } : t) })} /></label>}
        </div>
      })}
      {action.targets.filter(t => !receivers.some(e => e.id === t.element)).map(t =>
        <button key={t.element} onClick={() => toggle(t.element, false)}>Убрать связь с удалённым {t.element}</button>)}
    </fieldset>
  </>
}
