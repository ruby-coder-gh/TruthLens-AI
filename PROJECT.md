# PROJECT.md

## Goal
Offline-first RAG platform (TruthLens AI/VeritasRAG) with local LLMs. No paid APIs. Users upload documents, query them via RAG pipeline, get trust-scored answers.

## Decisions
- **Stack**: Python FastAPI backend + React TypeScript frontend + Vite + Tailwind v4 + Framer Motion v12
- **WAAPI fix**: Framer Motion v12 uses Web Animations API — `initial={{ opacity: 0 }}` gets stuck on some browsers. Fix: use `opacity: 0.99` + CSS transitions for hover/active states
- **Routing**: React Router v7, Layout uses `<Outlet />` for child routes
- **Auth**: JWT tokens stored in localStorage, AuthContext with login/register/logout
- **UI**: Dark cinematic theme, glassmorphism, ambient blobs, gradient accents

## Task Board
### Phase: WAAPI Bug Fix + UI Polish
- [x] Fix all `initial={{ opacity: 0 }}` → `opacity: 0.99` across all components/pages
- [x] Replace `whileHover`/`whileTap` with CSS `hover:scale`/`active:scale`
- [x] Remove `AnimatePresence` from App.tsx (simplify routing)
- [x] Fix Layout to use `<Outlet />` instead of `{children}` prop
- [x] Fix all TS build errors (ease arrays, unused imports, duplicate attrs)
- [x] Fix Button component to use `<button>` not `<motion.button>` (type compat)
- [x] Fix ProgressBar to use CSS transition instead of framer motion width
- [ ] Verify login → workspaces redirect flow
- [ ] Verify all pages render without console errors

### Phase: Features
- [ ] Document upload with drag-drop
- [ ] RAG query with streaming
- [ ] Trust score visualization
- [ ] Admin dashboard

## Open Questions
- (none)

## Artifacts
- Frontend: `frontend/src/`
- Backend: `backend/` (not in workspace root)
- Config: `frontend/vite.config.ts`, `frontend/tailwind.config.ts`
