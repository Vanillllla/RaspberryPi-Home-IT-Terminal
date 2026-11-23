# Developing an element module

Create elements/pulse-button/manifest.json and Component.tsx. The folder name equals the type ID and the component has a default export. Keep styles, helper components and a README in the same directory. See elements/circular-gauge/ for a working independent module.

```json
{
  "apiVersion": 1, "id": "pulse-button", "version": "1.0.0",
  "name": {"ru": "Импульс", "en": "Pulse"},
  "description": {"ru": "Передаёт счётчик на сервер", "en": "Send a count to the server"},
  "defaultFrame": {"x": 0, "y": 0, "w": 128, "h": 48},
  "properties": {
    "count": {"type": "number", "default": 0, "min": 0,
              "label": {"ru": "Счётчик", "en": "Count"}},
    "label": {"type": "string", "default": "Pulse", "localized": true,
              "label": {"ru": "Подпись", "en": "Caption"}}
  },
  "strings": {"Pulse": {"ru": "Импульс", "en": "Pulse"}},
  "events": {"onPulse": {"description": {"ru": "Нажатие", "en": "Pressed"}, "writes": ["count"]}}
}
```

```tsx
import type { ElementProps } from '@terminal/element'

export default function PulseButton({ properties, emit }: ElementProps) {
  return <button onClick={() => emit('onPulse', { count: Number(properties.count) + 1 })}>
    {String(properties.label)} · {Number(properties.count)}
  </button>
}
```

The backend discovers manifests at startup. Vite discovers components at elements/*/Component.tsx. Restart the backend and dev server or rebuild the frontend. Pulse appears in palette search, the inspector, event bindings and element reference. Add it to a view and create an onPulse handler. For example, `ctx.set("pulseButton1", "count", ctx.get("pulseButton1", "count"), persist=True)` retains the current count. Open another browser to verify that both clients receive the same value.

## Contract

- apiVersion selects the platform contract, currently 1. version identifies the module release. id is a permanent type identifier. Supply ru and en names and descriptions.
- properties maps names to types, defaults and bilingual labels. An optional description provides an inspector tooltip and reference text. Supported kinds are string, number, boolean, color, choice and json. Colors accept CSS names or hex, choice uses options, and number supports min and max. Use json for chart data. Declare secrets in project instance settings.
- events maps event names to bilingual descriptions. writes lists the properties the component may change in the same event. For example, onChange with writes ["value"] applies input and invokes its handler together. A button can declare an empty writes array. Python can change any declared property.
- The resolved React properties already include project and instance values. localized translates presentation strings through strings. Python reads the source value. ElementProps includes node id, properties, language, emit(name, changes?) and asset(filename). asset resolves a raster resource from widgets/<id>/assets/. Use language for captions and date formatting.
- container: true enables children. Render them inside a box with defined width and height. The engine handles child layout. A leaf can usually render one accessible control filling its frame.
- Keep authoritative values on the server. React can keep an input draft until commit or a slider position during a gesture. Schedule monitoring and retain sample history in the widget project.
- Use semantic buttons, accessible field labels and keyboard navigation. Scope CSS to the component. A React error boundary isolates render failures. An absent type displays a placeholder in its original frame.

## Releasing a version

Add properties with defaults. Keep existing property names and semantics stable for installed projects. For incompatible contracts publish a new type ID and explicitly update the projects. After updating, verify the manifest, TypeScript build, two instances and both languages. Registry and reference entries derive from the installed package.
