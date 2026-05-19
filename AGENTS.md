# agents.md

guidance for Codex agents working in this repo.

## what this is

cram.fyi is a public app/template repo. it contains the reusable flashcard interface, analytics page, Codex-backed chat bridge, and safe demo content.

the flashcard UI uses an adaptive study queue. do not reintroduce a user-facing wave-size picker unless the user explicitly asks for that tradeoff. small fixed waves can make missed cards reappear too soon and weaken spaced repetition.

## directory layout

- `app/` - public app code.
- `examples/` - safe demo study data.
- `classes/` - local-only private class folders, ignored by Git except `classes/.gitkeep`.

## private class data

never commit real class material to this public repo. that includes:

- study guides
- lecture slides
- lecture transcripts
- quizzes
- lab handouts
- screenshots containing class content or personal information
- credentials, auth files, tokens, `.env` files, or private notes

if the user wants the simplest setup, they can keep real course files in `classes/<course-name>/`. that folder is gitignored.

class folders should represent the course, not one test or assignment. use names like `classes/bio`, `classes/chem`, or `classes/writing`; do not use names like `classes/bio-exam4` when the material belongs to a broader class.

each class folder should contain active study files at the top level:

- `study-guide.md`
- `flashcards.json`

it may also contain private course context used to create flashcards and quizzes. organize that context by course, exam, unit, or topic:

- `lecture_slides/`
- `lecture_transcripts/`
- `labs/`
- `notes/`
- `quizzes/`
- `exams/<exam-name>/lecture_slides/`
- `exams/<exam-name>/lecture_transcripts/`
- `exams/<exam-name>/labs/`
- `exams/<exam-name>/notes/`
- `exams/<exam-name>/quizzes/`

users can also keep class files outside the repo and start the app with `npm start -- --data "/path/to/private/class"`.

## data format

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

`study-guide.md` is normal Markdown. use headings or short section-title lines followed by study-guide items.

`quizzes/` is for generated local self-quizzes. keep quiz files inside the selected class, exam, unit, or topic folder so they stay private.

## agent behavior

- keep the app usable without private data by preserving demo mode.
- keep reworded flashcard fronts answerable by the original `back` text. the back answer is fixed unless the user explicitly asks to edit the deck.
- keep rewording separate from chat model settings. rewording should use the fixed low-cost helper model path and one-shot ephemeral Codex threads, not the user's selected chat model or chat history.
- when a user adds or points to class material, proactively organize it under `classes/<course-name>/` with clear subfolders for exams, units, labs, notes, transcripts, slides, and quizzes.
- use course-level folder names. if a folder is named after an exam, like `bio-exam4`, prefer moving it to a course folder like `bio` and putting exam-specific files under `bio/exams/exam-4/`.
- treat selected class data as read-only study context unless the user asks to create, update, organize, or move local class files.
- when creating flashcards, use the selected class folder as context and write/update `flashcards.json` only when the user asks.
- when creating quizzes, write them into the most specific matching private folder, such as `classes/<course-name>/exams/<exam-name>/quizzes/`, unless the user gives a different local private path.
- treat `study-guide.md` as the source of truth for testable material when it exists. use slides, transcripts, notes, labs, and prior quizzes as supporting context.
- do not edit, copy, summarize, or publish private class files unless the user explicitly asks for local-only study work.
- before committing or pushing, scan for accidental class content and private paths.
