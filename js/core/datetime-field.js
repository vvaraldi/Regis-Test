/**
 * DateTimeField - ONE "date and time" field for every report form (Inspections, Infractions, Signalisations, Météo).
 *
 * The page writes a plain <input type="datetime-local">. Where the browser really has that field (current Chrome,
 * Samsung Internet, Firefox and Safari on phones) nothing changes. Where it does not (a very old browser or WebView
 * turns it into a plain text box that accepts anything), init() swaps it for the two native fields, a date and a
 * time, side by side - and the page does not notice: the original input keeps its id, its `.value`
 * ("YYYY-MM-DDTHH:mm" or ""), its "change" event, its `is-invalid` and `disabled` states.
 *
 *   DateTimeField.init(input)            // once, after the page is drawn; returns the input
 *   DateTimeField.set(input, new Date()) // fill it (to the minute)
 *   DateTimeField.read(input)            // a Date (local time), or null when empty / not a real date
 *   DateTimeField.supported()            // does this browser have a real datetime-local field?
 *   DateTimeField.format(date)           // "YYYY-MM-DDTHH:mm"
 *   DateTimeField.parse(text)            // the same text back to a Date, or null
 *
 * init(input, { force: true }) always builds the two-field version (used by the tests).
 */
const DateTimeField = (() => {
  const pad = n => String(n).padStart(2, '0');

  function format(d) {
    if (!(d instanceof Date) || isNaN(d)) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // "YYYY-MM-DDTHH:mm" (seconds ignored) -> Date in local time; a day that does not exist (31 April) is refused
  function parse(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(text || '').trim());
    if (!m) return null;
    const [y, mo, d, h, mi] = m.slice(1).map(Number);
    const date = new Date(y, mo - 1, d, h, mi);
    const real = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && date.getHours() === h && date.getMinutes() === mi;
    return real ? date : null;
  }

  // A browser without the field makes the type fall back to "text"; one with it cleans up a bad value
  function supported() {
    try {
      const probe = document.createElement('input');
      probe.setAttribute('type', 'datetime-local');
      if (probe.type !== 'datetime-local') return false;
      probe.value = 'not a date';
      return probe.value === '';
    } catch (e) { return false; }
  }

  const valueProperty = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

  function init(input, options) {
    if (!input || input.dataset.dtf) return input;
    if (!(options && options.force) && supported()) { input.dataset.dtf = 'native'; return input; }
    input.dataset.dtf = 'pair';

    const id = input.id || ('dtf' + Math.random().toString(36).slice(2, 8));
    const wasRequired = input.required;
    const make = (type, suffix, label, placeholder, pattern) => {
      const el = document.createElement('input');
      el.type = type; el.id = id + '-' + suffix; el.className = input.className;
      el.setAttribute('aria-label', label); el.placeholder = placeholder; el.setAttribute('pattern', pattern);
      el.required = wasRequired; el.disabled = input.disabled;
      el.style.cssText = 'flex:1 1 0; min-width: 0;';
      return el;
    };
    const dateInput = make('date', 'date', 'Date', 'AAAA-MM-JJ', '\\d{4}-\\d{2}-\\d{2}');
    const timeInput = make('time', 'time', 'Heure', 'HH:MM', '\\d{2}:\\d{2}');
    const wrap = document.createElement('div');
    wrap.className = 'dtf-pair';
    wrap.style.cssText = 'display:flex; gap:0.5rem;';
    wrap.append(dateInput, timeInput);

    // the original stays in the form (the page reads and writes it) but out of sight and out of the browser's checks
    input.type = 'text';
    input.required = false;
    input.style.display = 'none';
    input.insertAdjacentElement('beforebegin', wrap);
    const label = input.id && document.querySelector(`label[for="${input.id}"]`);
    if (label) label.setAttribute('for', dateInput.id);

    const split = text => { const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(text || '')); return m ? [m[1], m[2]] : ['', '']; };
    let internal = false;
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return valueProperty.get.call(input); },
      set(v) {
        valueProperty.set.call(input, v);
        if (!internal) { const [d, t] = split(v); dateInput.value = d; timeInput.value = t; }
      }
    });
    const fromPair = () => {
      const next = dateInput.value && timeInput.value ? `${dateInput.value}T${timeInput.value}` : '';
      if (next === input.value) return;
      internal = true; input.value = next; internal = false;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    [dateInput, timeInput].forEach(el => { el.addEventListener('input', fromPair); el.addEventListener('change', fromPair); });

    // the page marks the original (is-invalid, disabled): show it on the two visible fields
    const mirror = () => {
      [dateInput, timeInput].forEach(el => { el.classList.toggle('is-invalid', input.classList.contains('is-invalid')); el.disabled = input.disabled; });
    };
    new MutationObserver(mirror).observe(input, { attributes: true, attributeFilter: ['class', 'disabled'] });
    const [d0, t0] = split(input.value); dateInput.value = d0; timeInput.value = t0;
    return input;
  }

  const set = (input, date) => { input.value = format(date); };
  const read = input => parse(input && input.value);

  return { init, set, read, supported, format, parse };
})();
