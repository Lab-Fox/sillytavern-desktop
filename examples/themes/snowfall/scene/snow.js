// Snow for the Snowfall theme. The app tells it what's going on; it never answers.
const canvas = document.getElementById('c'), g = canvas.getContext('2d');
let state = { server: 'stopped', options: { amount: 90, wind: 2, pixels: true } };
let flakes = [];
addEventListener('message', e => { state = e.data; });
function size() { canvas.width = innerWidth; canvas.height = innerHeight; }
addEventListener('resize', size);
size();
const newFlake = top => ({ x: Math.random() * canvas.width, y: top ? -4 : Math.random() * canvas.height, r: 1 + Math.random() * 2, s: 12 + Math.random() * 34 });
let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (now - last < 33) return;   // 30 frames a second is plenty for snow
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const want = Math.round((state.options?.amount ?? 90) * (state.server === 'running' ? 1.5 : 1));
  while (flakes.length < want) flakes.push(newFlake(false));
  flakes.length = want;
  const wind = (state.options?.wind ?? 2) * 6;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = 'rgba(235, 245, 255, .75)';
  for (const f of flakes) {
    f.y += f.s * dt;
    f.x += wind * dt * (f.r / 2);
    if (f.y > canvas.height + 4) Object.assign(f, newFlake(true));
    if (f.x > canvas.width + 4) f.x = -4;
    if (state.options?.pixels === false) { g.beginPath(); g.arc(f.x, f.y, f.r, 0, 6.3); g.fill(); } else g.fillRect(Math.round(f.x), Math.round(f.y), Math.ceil(f.r) + 1, Math.ceil(f.r) + 1);
  }
}
requestAnimationFrame(frame);
