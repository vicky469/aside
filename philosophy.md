# SideNote2 Philosophy

SideNote2 is a tool for thought built around a small belief: thinking improves when questions, critique, decisions, and follow-up work can stay close to the note that caused them.

The plugin should feel like a quiet margin, not a second workspace.

## Minimalist Design

SideNote2 should do less than a general task manager, less than a chat app, and less than a full writing environment. Its value comes from staying narrow.

The core object is simple:
- a markdown note
- a side-note thread attached to the whole page or a specific selection
- entries inside that thread
- an index that helps you find the threads later

## Comments Are Thinking Objects

A side note is not just annotation. It can be:
- a question
- a critique
- a decision
- a reminder
- a research lead
- a small plan
- a conversation with your favorite agent (the current default option is Codex)
- a link to the next note

The important thing is locality. The comment should preserve the reason it exists. Anchored notes keep local context. Page notes capture broader context. Threads keep the history of how the thought changed.

## The Markdown Note Is The Center

SideNote2 should not compete with Obsidian. The markdown note remains the user's primary surface.

The sidebar is supporting structure:
- it should preserve context
- it should make unresolved thinking visible
- it should archive resolved thinking without erasing it
- it should make it easy to return to the source note

The generated index is a map, not the territory. It helps discovery, but it is not the source of truth.

## Human And Agent Work Should Share The Same Thread

Built-in `@codex` should feel native because it writes back into the same side-note thread where the user asked the question.

The agent should not become a separate chat product living beside Obsidian. It should act like a collaborator in the margin:
- read the current note context
- answer the actual thread
- keep the reply compact
- leave durable output in the same place the work started

The user should not need a separate SideNote2 skill or CLI for the built-in product path. External Codex skills can support advanced handoff workflows, but the plugin itself should carry the product rules needed for normal use.

## Link Thought To Thought

Side notes should make it cheap to connect ideas without forcing premature structure.

Wikilinks inside comments are important because they turn a comment from a dead note into a path:
- this question belongs to another note
- this result depends on another idea
- this thread is part of a longer trail

The thought-trail graph should remain a lightweight view of those connections, not a heavy knowledge-management system.

## Preserve Useful Friction

Not every idea should become a new note. Not every question needs an agent. Not every comment should become a task.

SideNote2 should preserve enough friction that the user still has to decide:
- is this worth saving?
- is this attached to a selection or the whole page?
- is this resolved?
- should this become a real note?
- should Codex handle this, or should I think more first?

Good tools for thought do not remove judgment. They protect it.

## What Belongs In SideNote2

SideNote2 should include features that strengthen the margin workflow:
- page notes and anchored notes
- threaded replies
- resolved and deleted review states
- wikilinks and tags inside comments
- a derived vault-wide index
- focused filtering and search
- local, explicit agent replies
- careful storage that survives rename and sync behavior

These features all serve the same loop: notice something, attach a thought, revisit it, resolve it, and let useful connections compound.