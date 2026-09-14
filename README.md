# NetDefenders: MULTITASKER

A fast-paced arcade game where you defend your network across four fronts — **simultaneously**.

## How to Play

You manage four defense panels at once. Each panel is a different minigame with its own threats. If a panel's health hits zero, it crashes and you lose a life. Lose all your lives and the game is over.

### Panels

| Panel | Goal | Controls |
|-------|------|----------|
| **FIREWALL** | Click incoming threats to destroy them before they reach the bottom | Mouse click |
| **PACKET ROUTER** | Guide falling packets to the matching colored port | Click lanes or press 1-4 |
| **DECRYPTOR** | Type the letters on each threat to decrypt it before it expires | Keyboard |
| **INTRUSION GRID** | Place turrets on the grid to auto-fire on incoming bots | Mouse click |

### Scoring

- You earn points passively for every active panel
- Blocking threats, routing packets correctly, and decrypting earn bonus points
- Chaining successes builds a combo multiplier
- Each wave increases difficulty — threats spawn faster and hit harder
- Surviving to a new wave revives one crashed panel at partial health

## Tech

- TypeScript + Canvas 2D
- Vite for dev/build
- No external dependencies — pure browser game
