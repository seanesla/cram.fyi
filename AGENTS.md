# AGENTS.md

Guidance for Codex agents working in this repo.

## What this is

Agentic Flashcards is a public app/template repo. It contains the reusable flashcard interface, analytics page, Codex-backed chat bridge, and safe demo content.

## Directory layout

- `app/` - public app code.
- `examples/` - safe demo study data.
- `classes/` - local-only private class folders, ignored by Git except `classes/README.md`.

## Private class data

Never commit real class material to this public repo. That includes:

- study guides
- lecture slides
- lecture transcripts
- quizzes
- lab handouts
- screenshots containing class content or personal information
- credentials, auth files, tokens, `.env` files, or private notes

If a user wants the simplest setup, they can keep real course files in `classes/<course-name>/`. That folder is gitignored. Each class folder should contain:

- `study-guide.md`
- `flashcards.json`

Users can also keep class files outside the repo and start the app with `npm start -- --data "/path/to/private/class"`.

## Data format

`flashcards.json` is an array of cards:

```json
[
  {
    "topic": "Topic name",
    "front": "Question",
    "back": "Answer"
  }
]
```

`study-guide.md` is normal Markdown. Use headings or short section-title lines followed by study-guide items.

## Agent behavior

- Keep the app usable without private data by preserving demo mode.
- Treat selected class data as read-only context.
- Do not edit, copy, summarize, or publish private class files unless the user explicitly asks for local-only study work.
- Before committing or pushing, scan for accidental class content and private paths.
