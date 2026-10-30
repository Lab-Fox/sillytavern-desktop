// Break reminder — launcher panel. Runs in the launcher's Extensions page
// with two names: `panel` (this extension's card, to fill) and `ext`
// ({ id, invoke(channel, ...args) } to call the handlers in main.js).
// The launcher's own classes (field, row, btn, muted) make it fit in.

panel.innerHTML = `
  <div class="row" style="align-items:flex-end">
    <div class="field"><label>Remind me every (minutes)</label><input type="number" min="1" max="600" style="width:120px"></div>
    <div class="field" style="flex:1;min-width:200px"><label>Message</label><input type="text" maxlength="200"></div>
  </div>
  <div class="row" style="margin-top:12px">
    <button class="btn sm primary" data-save>Save</button>
    <button class="btn sm ghost" data-test>Show it now</button>
    <span class="muted small" data-status></span>
  </div>`;

const minutes = panel.querySelector('input[type=number]');
const message = panel.querySelector('input[type=text]');
const status = panel.querySelector('[data-status]');

ext.invoke('get').then(s => { minutes.value = s.minutes; message.value = s.message; });

panel.querySelector('[data-save]').onclick = async () => {
    const s = await ext.invoke('save', { minutes: minutes.value, message: message.value });
    minutes.value = s.minutes;
    status.textContent = `Saved: every ${s.minutes} minutes.`;
};
panel.querySelector('[data-test]').onclick = async () => {
    const pages = await ext.invoke('test');
    status.textContent = pages ? 'Shown in SillyTavern.' : 'Open SillyTavern first.';
};
