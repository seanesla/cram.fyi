# Agentic Flashcards

This is a public demo repo for a flashcard app with a Codex-backed study helper.

What is in here:

- `app/flashcards.html` - the main flashcard study UI
- `app/analytics.html` - progress charts and mastery views
- `app/server.mjs` - a small local server that talks to Codex through your ChatGPT login
- `examples/` - sample public study content
- `classes/README.md` - explains where local-only private class folders can go

What is not in here:

- private class notes
- lecture slides or transcripts
- quizzes
- lab handouts
- credentials or auth tokens

## How to run the demo

```bash
npm start
```

Then open the local URL the server prints.

## How to use it for a real class

Recommended beginner setup:

```text
agentic-flashcards/
  app/
  examples/
  classes/
    biology/
      study-guide.md
      flashcards.json
```

Then run:

```bash
npm start -- --class biology
```

`classes/` is ignored by Git, so real class files in that folder do not get committed by accident.

You can also keep class material outside the repo:

```bash
npm start -- --data "/path/to/private/class-folder"
```

Each class folder needs:

- `study-guide.md` - the active study guide
- `flashcards.json` - an array of cards with `topic`, `front`, and `back`

Example `flashcards.json`:

```json
[
  {
    "topic": "Cell Structure",
    "front": "What does the nucleus do?",
    "back": "It stores DNA and controls many cell activities."
  }
]
```

## Important privacy note

- This repo is meant to show the app shell and the agentic chat features.
- Do not put private class material in `app/` or `examples/`.
- If you keep class material inside this repo, put it under `classes/<course-name>/`.
- Before pushing changes, run `git status` and make sure no private course files are staged.
