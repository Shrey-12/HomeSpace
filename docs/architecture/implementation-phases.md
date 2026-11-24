# HomeSpace implementation phases

This is an implementation plan for two developers. Backend foundation work for phase 2 is underway: the API, Auth0 token verification, internal identity mapping, initial database migration, private uploads, and upload-verification worker have been scaffolded. Phase 1 is still open for social-source access validation and shared contracts. The phase 2 completion gate has not been met; the web application, Auth0 tenant/client configuration, CI workflow, and reproducible dependency lockfile are still outstanding. Phases 1–6 form the first shared beta. AI is introduced in phases 7–8 after the core workflows are reliable.

The product and technical design are documented in the [README](../../README.md).

## Delivery approach

- Developer A leads geometry, the 2D/3D planner, and spatial interactions.
- Developer B leads the backend, social imports, media processing, and library workflows.
- Both review shared contracts, coordinate conventions, database migrations, and integrated acceptance flows.
- Start parallel feature work after foundation contracts exist. Use the same sample-home and media fixtures on both tracks.
- Keep every phase demonstrable. Include relevant tests, authorization, failure states, and documentation as the feature is built.
- Size individual issues after phase 1 establishes source-access capabilities. This plan does not assume a fixed weekly delivery schedule.

## Phase 1 — Validate access and agree on contracts

**Goal:** Resolve the largest integration risks and establish a shared domain model before building dependent features.

**Developer A:** Define coordinates, wall/opening geometry, furniture transforms, and a small dimensioned sample room. Specify editor modes and the first acceptance journey.

**Developer B:** Validate Pinterest board/pin and Instagram reel/post/carousel access paths, supported exports, authentication requirements, and user-upload fallbacks. Draft import and persistence contracts.

**Deliverables:**

- A source-capability matrix recording actual tested access, unsupported cases, and fallback behavior.
- Shared schemas for building geometry, furniture, source items, imports, and reference pins.
- Decisions on authentication, hosting, local services, initial catalogue format, and media storage.
- Sanitized fixtures covering a room, board, reel, carousel, duplicates, and unavailable media.
- A prioritized issue backlog divided between both developers.

**Completion gate:** Both developers agree on contracts and can explain the verified path for each source type. API or account restrictions are reflected in scope rather than hidden behind an assumed integration.

## Phase 2 — Build the project foundation

**Depends on:** Phase 1.

**Developer A:** Scaffold the React application, navigation, project shell, editor state, and API client integration.

**Developer B:** Scaffold the API and worker, PostgreSQL migrations, managed authentication, project membership, signed uploads, and job infrastructure.

**Deliverables:**

- pnpm monorepo with shared contracts and a reproducible local setup.
- Sign-in, project creation, authorized project access, and plan uploads.
- Asset records, job status, structured errors, and basic logging.
- CI checks and an initial shared development environment.

**Completion gate:** Both developers can run the application. A user can create a project, upload a plan, sign out, and reopen it. Another unauthorized account cannot access its data or media.

## Phase 3 — Build the plan and inspiration tracks in parallel

**Depends on:** Phase 2.

**Developer A: Plan track**

- Set floor-plan scale and orientation.
- Trace rooms and walls; add and correct doors, sliders, and windows.
- Display dimensions and persist building revisions.
- Mark unverified dimensions and provide basic edit recovery.

**Developer B: Inspiration track**

- Accept board/pin/reel/post URLs through the access methods validated in phase 1.
- Support selected account exports and direct media uploads.
- Add durable source records, resumable import jobs, provenance, and partial-result reporting.
- Extract candidate frames with scene-change and similarity processing; preserve carousel order.
- Provide frame review, manual tags, filters, and search.

**Completion gate:** A corrected room and reviewed references survive save/reload. Imports expose missing media and collection completeness. Reimporting a source does not duplicate successful items or erase user notes. No AI service is required for these workflows.

## Phase 4 — Add interactive layouts and the reference canvas

**Depends on:** Phase 3 for the corresponding track; integrate both tracks before completion.

**Developer A:** Build synchronized 2D/3D rendering, the furniture catalogue interface, placement previews, selection, drag/rotate/resize, numeric fields, snapping, and undo/redo.

**Developer B:** Build catalogue/layout persistence and the reference canvas, including draggable cards, groups, notes, filters, and saved board positions.

**Deliverables:**

- One spatial model drives both plan and 3D furniture positions.
- Explicit View and Move modes, Escape to cancel, and keyboard movement.
- Independent visibility controls for furniture, dimensions, and annotations.
- Visible save status and recoverable errors.
- A canvas for arranging inspiration without altering architectural geometry.

**Completion gate:** Place two sofas and a TV unit, move and rotate them, switch views, then reload. Positions remain consistent. Rearranged reference cards and notes are also restored. The 2D workspace remains accessible if 3D rendering fails.

## Phase 5 — Connect inspiration to the actual house

**Depends on:** Phase 4.

**Developer A:** Build wall/room/furniture anchors, image callouts, electrical-point editing, clearance visualization, and deterministic geometry checks.

**Developer B:** Persist anchors and fixture evidence, integrate server validation, store service-change proposals, and expose issue status in the project API.

**Deliverables:**

- Pin a reference or selected image detail to a spatial location.
- Record what to borrow from the reference and how it should be adapted.
- Add electrical and other existing fixtures with heights, source evidence, and verification state.
- Detect rotated furniture overlap, blocked openings, service obstruction, circulation gaps, and height conflicts.
- Keep observed fixtures separate from proposed relocations.
- Flag deleted or invalidated anchors for review.

**Completion gate:** Attach a TV-unit reference to a wall, place a unit, and explain a socket conflict using the source evidence. Moving a fixture is recorded as a proposal. Correcting geometry either preserves valid pins or explicitly requests anchor review.

## Phase 6 — Release a shared planning beta

**Depends on:** Phase 5.

**Developer A:** Build design-option comparison, review panels, conflict-resolution UI, checkpoint recovery, and export interactions.

**Developer B:** Add comments, roles, entity-version checks, checkpoints, export APIs, backup/restore procedures, monitoring, and deployment configuration.

**Deliverables:**

- Duplicate layouts, compare alternatives, and record selected decisions.
- Anchored comment threads with clear author and location context.
- Concurrent-edit detection without silent overwrites; recoverable unsaved work.
- Named checkpoints and portable project-data exports.
- CI coverage of critical journeys, private-media access, failure recovery, and tested database restoration.

**Completion gate:** Two users review the same project, create alternatives, encounter and resolve a stale edit, and restore a checkpoint. The complete living-room and social-import acceptance scenarios in the README pass in the shared environment.

**Release boundary:** This is the first usable shared product. AI phases are optional enhancements and do not block this release. Live presence and simultaneous dragging remain later improvements unless beta feedback makes them necessary.

## Phase 7 — Add AI assistance for inspiration

**Depends on:** Phase 6, a reviewed evaluation set, and an explicit model/provider and budget decision.

**Developer A:** Build suggestion review, correction, confidence/provenance displays, and manual fallbacks.

**Developer B:** Add model adapters and queued analysis for room/style/material/element suggestions and more useful semantic video-frame selection. Track job cost, latency, and failures.

**Deliverables:**

- Suggested tags and frame selections remain separate from user-confirmed decisions.
- Evaluate against representative interiors, house tours, single-room pans, and distracting frames.
- Cache results, set processing limits, and retry safely without duplicate billing where supported.
- Define which project media may be sent to the chosen service and expose this setting.

**Completion gate:** Agree on evaluation targets before enabling the feature, then meet them on held-out samples. Users can correct suggestions, inspect their source, and continue manually if the model is unavailable.

## Phase 8 — Add AI blueprint drafting and design recommendations

**Depends on:** Phase 6 for the reliable editor and validation engine; reference-based recommendations also use the reviewed analysis from phase 7. Geometry recognition can be investigated separately.

**Developer A:** Build review and correction tools for proposed walls, rooms, openings, and scale assumptions.

**Developer B:** Add recognition and recommendation jobs that return typed drafts, reference evidence, assumptions, and suggested design alternatives.

**Deliverables:**

- Convert recognized geometry into the existing editable spatial model.
- Require user verification of dimensions and ambiguous openings.
- Recommend references for specific spaces using the room brief, dimensions, styles, and storage needs.
- Save accepted recommendations as new design options; run existing deterministic checks.
- Evaluate blueprint accuracy and recommendation usefulness separately.

**Completion gate:** A user can correct an automatically drafted room and inspect why an idea was proposed. Suggestions preserve the original plan and existing conditions, and no unreviewed recommendation becomes an approved design.

## Later backlog

Consider live presence, richer semantic search, detailed materials/lighting, and photorealistic presentation after beta feedback. Construction-ready drawings and accurate reconstruction from ordinary walkthrough videos require separate scope and validation.
