# Crossword Multiplayer — Refactored MVC Structure

This is the full-stack, clean-separation refactor of the original monolithic `index.html`.

---

## Folder Structure

```
crossword-app/
│
├── package.json
│
├── public/                         ← Static frontend (served by Express)
│   │
│   ├── css/
│   │   ├── main.css                ← Global resets, tokens, shared components
│   │   ├── lobby.css               ← Lobby / waiting-room specific styles
│   │   ├── game.css                ← In-game grid, clues, sidebar styles
│   │   └── pixel-art.css           ← Avatar drawing tool styles
│   │
│   ├── pages/
│   │   ├── index.html              ← Home screen (create / join)
│   │   ├── lobby.html              ← Waiting room / voting
│   │   └── game.html               ← In-game crossword
│   │
│   └── js/
│       ├── state.js                ← Shared app state & routing helpers
│       ├── api.service.js          ← Centralised fetch wrapper (all API calls)
│       ├── ui.helpers.js           ← Reusable DOM utilities (toast, swatches…)
│       └── controllers/
│           ├── home.controller.js  ← Home page logic
│           ├── lobby.controller.js ← Lobby page logic
│           └── game.controller.js  ← In-game logic (grid, clues, scores…)
│
└── server/
    ├── server.js                   ← Express entry point
    │
    ├── routes/
    │   ├── lobby.routes.js         ← /api/lobbies/*
    │   ├── game.routes.js          ← /api/games/*
    │   └── puzzle.routes.js        ← /api/puzzles/*
    │
    ├── controllers/
    │   ├── lobby.controller.js     ← Lobby request handlers
    │   ├── game.controller.js      ← Game request handlers
    │   └── puzzle.controller.js    ← Puzzle catalogue handlers
    │
    └── models/
        ├── lobby.model.js          ← Lobby CRUD (in-memory store)
        ├── game.model.js           ← Game state & scoring logic
        └── puzzle.model.js         ← Puzzle catalogue & seed data
```

---

## Design Principles

### MVC Separation
| Layer       | Location                    | Responsibility                        |
|-------------|-----------------------------|---------------------------------------|
| **Model**   | `server/models/*.model.js`  | Data structures, storage, business logic |
| **View**    | `public/pages/*.html` + CSS | Pure HTML structure; zero logic       |
| **Controller** | `server/controllers/` + `public/js/controllers/` | Wire view ↔ model; handle user events |

### Frontend Module Pattern
- All pages load a single `<script type="module">` controller.
- Controllers import from shared `state.js`, `api.service.js`, and `ui.helpers.js`.
- **No inline JS in HTML** — every `onclick` from the original file is replaced with `addEventListener`.
- Navigation between pages uses `sessionStorage` to pass lobby code and player ID.

### Server-Side
- **Routes** map HTTP verbs + paths → controller functions (no logic).
- **Controllers** validate input, call models, format responses.
- **Models** own all data mutations and business rules.

---

## Getting Started

```bash
npm install
npm run dev        # node --watch (auto-restart on change)
# or
npm start
```

Open [http://localhost:3000](http://localhost:3000).

---

## API Reference

### Lobbies
| Method  | Path                                    | Action               |
|---------|-----------------------------------------|----------------------|
| POST    | `/api/lobbies`                          | Create lobby         |
| GET     | `/api/lobbies/:code`                    | Get lobby state      |
| POST    | `/api/lobbies/:code/join`               | Join lobby           |
| PATCH   | `/api/lobbies/:code/players/:id`        | Update player        |
| DELETE  | `/api/lobbies/:code/players/:id`        | Leave / kick player  |
| PATCH   | `/api/lobbies/:code/mode`               | Set game mode        |
| POST    | `/api/lobbies/:code/votes`              | Cast vote            |
| DELETE  | `/api/lobbies/:code/votes/:id`          | Remove vote          |
| PATCH   | `/api/lobbies/:code/host`               | Transfer host        |
| POST    | `/api/lobbies/:code/chat`               | Send chat message    |
| POST    | `/api/lobbies/:code/start`              | Start game           |

### Games
| Method  | Path                                    | Action               |
|---------|-----------------------------------------|----------------------|
| GET     | `/api/games/:code/state`                | Get game state       |
| POST    | `/api/games/:code/cells`                | Submit letter        |
| POST    | `/api/games/:code/check`                | Check cells          |
| POST    | `/api/games/:code/reveal`               | Reveal cells         |
| POST    | `/api/games/:code/chat`                 | Send chat message    |
| PATCH   | `/api/games/:code/players/:id`          | Update player profile|
| POST    | `/api/games/:code/forfeit`              | Forfeit game         |

### Puzzles
| Method  | Path                 | Action              |
|---------|----------------------|---------------------|
| GET     | `/api/puzzles`       | List puzzles        |
| GET     | `/api/puzzles/:id`   | Get puzzle summary  |

---

## Firebase Real-Time Sync

The game uses Firebase Realtime Database for low-latency multiplayer sync.
Include `firebase.js` (your config script) **before** the page controller script.
It should expose `window._fb = { db, ref, onValue, set, update, remove }`.

The controllers fall back to REST polling if `window._fb` is not present.

---

## Extending

- **Add a puzzle**: Add an entry to the `CATALOGUE` array in `server/models/puzzle.model.js`.
- **Add a page**: Create `public/pages/mypage.html` + `public/js/controllers/mypage.controller.js`.
- **Add an API endpoint**: Add a handler to the relevant controller and register the route in the routes file.
