---
applyTo: '**'
---
# 🧠 GitHub Copilot Instructions – Express.js Backend

This guide defines how GitHub Copilot should assist in generating code for this Express.js server project. It covers architectural patterns, coding style, and best practices to ensure maintainable, scalable backend code.

---

## 🛠️ Tech Stack Guidelines

- **Runtime:** Node.js (latest LTS)
- **Framework:** Express.js
- **Language:** TypeScript (preferred) or modern ES modules
- **Database:** (Optional) PostgreSQL or MongoDB, depending on the project (I prefer MongoDB for flexibility)
- **Auth:** JWT or session-based auth (depending on context)
- **Other Tools:** dotenv, nodemon, morgan, zod/joi (for validation)

---

## 💡 Copilot Coding Rules

### ✅ Do

- Use `async/await` for all asynchronous operations — avoid `.then()` or callback patterns.
- Define functions using the `function myFunction() {}` syntax. Avoid arrow functions for top-level functions, routes, or middleware (it's fine to use them for callbacks or within other functions).
- Apply **DRY** principles. Avoid repeated logic — abstract repeated validation, auth, or formatting logic into middleware or utility functions.
- Keep **functions and files single-purpose**. Separate route handlers, middleware, controllers, services, and models.
- Use **modular folder structure**. Things should go inside the `src/` directory unless otherwise better for it to be at the root:
  - `routes/` – define Express routers
  - `controllers/` – logic for handling route requests
  - `services/` – reusable business logic or DB access
  - `middleware/` – Express middleware
  - `utils/` – reusable helper functions
  - `config/` – configuration logic (e.g., DB, env vars)
- Use `try/catch` blocks around all async handlers or middleware, and delegate errors to the centralized error handler using `next(err)`.
- Implement centralized error handling in `middleware/errorHandler.ts`.
- Use `helmet`, `cors`, `express.json()`, and other security/middleware best practices.
- Use meaningful HTTP status codes and descriptive error messages.
- Use `console.log()` **only** for temporary debugging — prefer `morgan` or a logging middleware for production logs.

---

### ❌ Don’t

- Don’t use `.then()` or chained promises. Always use `async/await`.
- Don’t define routes or controllers inline in `server.js`/`index.ts`. Use routers and controllers for separation of concerns.
- Don’t write large monolithic files. Break logic into individual modules/functions.
- Don’t use arrow functions to define middleware, controllers, or top-level functions.
- Don’t mix business logic with route definitions — use controllers or service layers.
- Don't just be a yes man. Critique any flaws in my ideas and give me alternative solutions if necessary

---