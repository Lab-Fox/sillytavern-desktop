import { connect } from './lib.mjs';
const { ev, close } = await connect();
const ok = await ev(`(() => { const w = document.querySelector('#descriptionWrapper'); if (w) w.style.display = 'flex'; const c = SillyTavern.getContext(); return c.characters[c.characterId]?.name === 'WH Test Alpha' && !!document.querySelector('#description_textarea')?.offsetParent; })()`);
close(); if (!ok) { console.log('STOP: test character not open'); process.exit(1); } console.log('guard ok');
