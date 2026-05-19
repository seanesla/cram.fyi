# cram.fyi

a local flashcard app for turning class material into stuff you can actually study.

the vibe is simple: keep your private class files on your own machine, ask Codex to help make the deck, then study it in the browser with flashcards, analytics, and a little chat helper on the side.

## what's in here

- `app/flashcards.html` - the main flashcard study UI
- `app/analytics.html` - progress charts and mastery views
- `app/server.mjs` - the local server that loads your deck and connects to Codex through your ChatGPT login
- `examples/` - safe demo study content
- `AGENTS.md` - instructions that tell Codex how to work safely in this repo

## what's not in here

real class material does not belong in the public part of this repo. pls do not put these in `app/` or `examples/`:

- private class notes
- lecture slides or transcripts
- quizzes
- lab handouts
- screenshots with class content or personal info
- credentials, auth files, tokens, `.env` files, or private notes

## run the demo

from the repo folder:

```bash
npm start
```

then open the local URL the server prints.

if you do not choose a class folder, the app uses the safe demo deck in `examples/`.

## use it for a real class

the easiest setup is to make one folder per class inside `classes/`:

```text
agentic-flashcards/
  app/
  examples/
  classes/
    bio/
      study-guide.md
      flashcards.json
      exams/
        exam-4/
          lecture_slides/
          lecture_transcripts/
          labs/
          quizzes/
```

then start that class deck:

```bash
npm start -- --class bio
```

`classes/` is ignored by Git, so your real course files stay local and do not get committed by accident.

you can also keep class material outside the repo:

```bash
npm start -- --data "/path/to/private/class-folder"
```

## class folder format

name class folders after the course, not the test. use `classes/bio`, not `classes/bio-exam4`. exam-specific material belongs inside that class folder.

each class folder should have these active study files at the top level:

- `study-guide.md` - the active study guide
- `flashcards.json` - the flashcard deck

it can also include organized class context so Codex can make better cards and quizzes:

- `exams/exam-4/lecture_slides/`
- `exams/exam-4/lecture_transcripts/`
- `exams/exam-4/labs/`
- `exams/exam-4/notes/`
- `exams/exam-4/quizzes/`

if the material is not tied to one exam, use course-level folders like `lecture_slides/`, `lecture_transcripts/`, `labs/`, `notes/`, or `quizzes/`.

`flashcards.json` should be an array of cards:

```json
[
  {
    "topic": "Cell Structure",
    "front": "What does the nucleus do?",
    "back": "It stores DNA and controls many cell activities."
  }
]
```

## typical workflow

1. add private class materials to `classes/<course-name>/`.
2. ask Codex to organize the files by course, exam, unit, or topic if they are messy.
3. ask Codex to create or update `flashcards.json` from that private context.
4. run `npm start -- --class <course-name>`.
5. study cards in the browser and check weak areas in analytics.
6. ask Codex to generate practice quizzes inside the matching class, exam, or unit folder.

## codex agent instructions

this repo includes `AGENTS.md`. that file is basically the house rules for Codex, so the agent does not casually fling your class files into the public repo. iconic, necessary, non-negotiable.

the important rules:

- keep real class files private.
- use `classes/<course-name>/` for local-only class material.
- keep class folders course-level, like `classes/bio`; put exam-specific material under folders like `classes/bio/exams/exam-4/`.
- treat `study-guide.md` as the source of truth for testable material.
- only create or update `flashcards.json` when you ask Codex to do that.
- put generated quizzes inside the most specific matching private folder, like `classes/<course-name>/exams/exam-4/quizzes/`.
- before committing or pushing, check that no private class material is included.

## privacy note

this repo is meant to show the app shell, demo content, and Codex-backed study features. your actual course files should stay private.

before pushing changes, run:

```bash
git status
```

make sure no private course files are staged. if the only class files are inside `classes/<course-name>/`, Git should ignore them by default.
