export const widgetControlsSelector = [
  'button', 'a[href]', 'input', 'textarea', 'select', 'label', 'summary', '[tabindex]',
  '[contenteditable]:not([contenteditable="false"])', '[draggable="true"]', 'audio[controls]', 'video[controls]',
  ...['button', 'link', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'textbox',
    'combobox', 'listbox', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab']
    .map(role => '[role~="' + role + '"]'),
].join(',')
