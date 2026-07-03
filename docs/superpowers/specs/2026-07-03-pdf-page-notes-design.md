# PDF Page Notes Design

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Current page notes are modeled with `anchorKind: "page"` and do not require text-anchor coordinates to resolve against markdown content.
- [x] Current sidecar and sync-event storage can store comments by source file path without storing comment data in the source file body.
- [x] Current unsupported-file sidebar behavior clears stale markdown sidebar data instead of showing the previous note's side notes.
- [x] Release `2.0.30` removed the old PDF attachment-comment storage path, so this design starts from current storage only.

### To Implement

- [x] Add an explicit page-note-capability helper that supports markdown files and PDF files while keeping text-anchor capability markdown-only.
- [x] Make PDFs sidebar-supported so opening a PDF shows its own Aside sidebar context instead of the unsupported-file empty state.
- [x] Allow creating page-note drafts for PDF files through the existing Add page note action.
- [x] Keep selected-text anchored drafts, editor highlights, re-anchor, and anchor-orphan actions disabled for PDFs.
- [x] Add a PDF page-note persistence path that reads and writes current sidecar and sync-event storage without reading or parsing PDF file contents.
- [x] Allow replies, edits, deletes, pinning, page-note reordering, and index reveal actions for PDF page-note threads where those actions do not require markdown anchors.
- [x] Make file rename and delete lifecycle handling update or clear PDF page-note storage and aggregate index state.
- [x] Refresh `Aside index.md` when PDF page notes are created, changed, renamed, or deleted.
- [x] Preserve the unsupported-file empty state for non-PDF unsupported files such as images, audio, video, canvas, and Office documents.

### Verification

- [x] Unit tests cover capability helpers for markdown, PDF, Aside index, and still-unsupported file types.
- [x] Unit tests cover workspace/sidebar target planning when the active file is a PDF.
- [x] Unit tests cover PDF page-note draft creation and rejection of PDF selected-text drafts.
- [x] Unit tests cover PDF page-note load and persist through current sidecar/sync storage without reading PDF file content.
- [x] Unit tests cover PDF page-note edit, append, delete, pin, reorder, and index reveal actions where applicable.
- [x] Unit tests cover PDF rename and delete lifecycle behavior.
- [x] Unit tests cover aggregate index refresh and filtering for PDF page-note threads.
- [x] Existing markdown anchored-note and markdown page-note tests still pass.
- [x] `npm run build` passes.

## Context

Aside currently treats markdown files as the only commentable source files. The sidebar-supported set is also markdown plus `Aside index.md`, so active PDFs show the unsupported-file empty state and no longer inherit stale markdown sidebar data.

PDF page notes existed before, but release `2.0.30` deliberately removed PDF-note support and the old attachment-comment storage path. That old storage path stored PDF comments in separate attachment-specific plugin data. This design does not restore that path.

Current Aside storage is better suited for the smaller feature: sidecar files and sync events already store comment threads by source file path. The desired behavior is to let PDFs have file-level page-note threads only, using the same current storage path as markdown comments.

## Goals

- Support page notes on PDF files.
- Include PDF page notes in the note sidebar and `Aside index.md`.
- Keep PDF page notes stored in current Aside sidecars and sync events.
- Refresh the aggregate index after PDF page-note changes.
- Keep markdown selected-text anchors unchanged.
- Keep unsupported-file clearing behavior for non-PDF unsupported files.

## Non-Goals

- Do not support anchored notes inside PDFs.
- Do not support PDF text selection, highlights, page coordinates, or re-anchor behavior.
- Do not restore attachment-comment storage or an `attachmentComments` plugin-data field.
- Do not store comment data in PDF files.
- Do not broaden support to images, audio, video, canvas, Office documents, or arbitrary file views.
- Do not change the shape of `Aside index.md` beyond including PDF page-note source files through existing index rows.
- Do not migrate historical `attachmentComments` data from older releases in this slice.

## Product Semantics

PDF support means a PDF file can have zero or more page-note threads. A PDF page-note thread behaves like a markdown page-note thread from the user's point of view:

- It appears in the note sidebar while the PDF is active.
- The toolbar shows Add page note.
- The user can create, edit, reply to, delete, restore, pin, and reorder PDF page-note threads.
- The thread appears in `Aside index.md` with the PDF file as its source.
- Clicking or revealing the PDF source opens the PDF file, not a markdown note.

PDF support does not imply text anchoring:

- Selecting text in a PDF must not create an anchored side note.
- Existing editor-only commands remain markdown-only.
- Re-anchor and orphan-anchor actions remain unavailable for PDF page notes.
- Editor decorations and markdown preview refreshes are not required for PDFs.

## Capability Model

The implementation should separate three concepts that are currently partly collapsed:

- **Text-anchor-capable:** markdown source notes, excluding `Aside index.md`.
- **Page-note-capable:** markdown source notes and PDF files, excluding `Aside index.md`.
- **Sidebar-supported:** page-note-capable files plus `Aside index.md`.

Suggested helper names:

```ts
isMarkdownCommentablePath(...)
isPdfPageNotePath(...)
isPageNoteCapablePath(...)
isSidebarSupportedPath(...)
```

The exact names can follow local style, but call sites should stop using a markdown-only helper when the operation is valid for PDF page notes.

## Data Flow

When a PDF becomes the active file:

1. Workspace target planning treats the PDF as the active sidebar file.
2. The sidebar sync path loads PDF page-note threads from current Aside storage.
3. The sidebar renders the normal note-sidebar shell for that PDF.
4. The Add page note action creates a draft with:
   - `filePath` set to the PDF path
   - `anchorKind: "page"`
   - zero coordinates
   - `selectedText` set with the existing page-note label helper
5. Saving the draft persists the thread through sidecar and sync-event storage.
6. Persistence refreshes relevant sidebar views and refreshes or schedules `Aside index.md`.

Markdown files keep the existing flow. Unsupported non-PDF files continue to produce the unsupported-file empty state.

## Persistence

PDF persistence must avoid reading or parsing PDF file content. The PDF path should:

- replay sync events for the PDF path
- read current sidecar storage by source id or path when available
- normalize threads for the PDF path
- replace the in-memory comment manager state for that file
- write sidecars and sync events on mutation
- compact snapshots as the markdown path does
- refresh views and aggregate index after changes

The implementation should not call markdown parsing helpers, `getCurrentNoteContent`, or source-content fingerprinting for PDFs. If source identity needs a fingerprint for PDFs, it should be path-based or null, not derived from file bytes. The design should prefer the existing source-identity API where it can work without content.

## Mutation Behavior

Operations that do not need text anchors should work for PDF page-note threads:

- create page note
- append reply
- edit body
- delete, restore, and permanently clear deleted threads
- pin and unpin
- reorder page-note threads in the same PDF
- move a page-note thread to another page-note-capable file as a page note, if the existing move UI exposes that target

Operations that require markdown anchors remain markdown-only:

- create selected-text anchored note
- re-anchor to current selection
- remove an anchor from an anchored note by matching editor selection
- editor highlight rendering
- markdown preview decoration refresh
- selected-text coordinate revalidation during save

Save-time validation should branch on `anchorKind`. Page-note saves should validate that the source file is page-note-capable. Selection-anchor saves should validate that the source file is text-anchor-capable.

## Index Refresh

`Aside index.md` should include PDF page-note threads through the existing aggregate comment index. A PDF page-note change must refresh or schedule aggregate index output in the same cases markdown page-note changes do:

- create
- edit
- append
- delete or restore
- reorder, if ordering affects rendered index order
- rename source PDF
- delete source PDF

Index filtering should keep PDF source paths as real source files. PDF files are not Thought Trail markdown nodes and should not affect markdown-link graph behavior.

## File Lifecycle

Rename and delete handling must use the page-note-capable model:

- Renaming a PDF retargets stored comments from the old PDF path to the new PDF path.
- Deleting a PDF clears stored comments for that PDF path, clears aggregate index state for that path, and schedules an aggregate refresh.
- Folder deletes continue to clear stored comments below the folder path, including PDF sidecars.
- Markdown modify handling remains markdown-only.

## UI And Empty States

Opening a PDF with no page notes should show the normal empty note-sidebar state with the Add page note affordance. It should not show `Unsupported file type`.

Opening a non-PDF unsupported file should continue to show:

- `Unsupported file type`
- `Open a markdown note to see its side notes.`

If the unsupported copy later feels too markdown-specific, that should be a separate copy edit. This slice keeps the existing copy for non-PDF unsupported files.

## Compatibility

No historical PDF attachment-comment data is migrated in this slice.

The only supported storage for new PDF page notes is current Aside storage:

```text
.obsidian/plugins/aside/data.json
.obsidian/plugins/aside/sidenotes/by-note/...
.obsidian/plugins/aside/sidenotes/by-source/...
```

If a vault still has old `attachmentComments` data from pre-`2.0.30` releases, this implementation ignores it. Restoring or migrating that data would require a separate, explicit migration spec.

## Testing Focus

The test suite should make the capability split hard to regress:

- `commentableFiles` tests should assert PDF is page-note-capable and sidebar-supported, but not markdown-commentable.
- Workspace target tests should assert active PDFs become sidebar targets instead of unsupported-file targets.
- Sidebar view normalization should keep PDFs.
- Entry controller tests should assert PDF page drafts start and PDF selection drafts still fail.
- Persistence tests should use a fake PDF file whose content-read method fails, proving PDF page-note load/save does not parse the PDF body.
- Mutation tests should cover edit/reply/delete/pin/reorder for PDF page-note threads.
- Lifecycle tests should cover PDF rename and delete.
- Index tests should assert PDF page-note threads appear in index path lists and refresh after mutation.

## Acceptance Criteria

- Opening a PDF shows the Aside note sidebar for that PDF.
- Clicking Add page note on a PDF creates and saves a page-note thread for that PDF.
- PDF page-note threads persist across reload through current sidecar/sync storage.
- PDF page-note threads appear in `Aside index.md`.
- Editing, replying, deleting, restoring, pinning, and reordering PDF page-note threads works where the existing UI exposes those actions.
- Switching to non-PDF unsupported files still shows the unsupported-file empty state.
- No code reintroduces attachment-comment storage, `attachmentComments`, or PDF content parsing for comments.
- Markdown anchored notes, markdown page notes, and `Aside index.md` continue to work.
