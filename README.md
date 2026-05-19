# cram.fyi

a local flashcard app for turning class material into stuff you can actually study.

## why i made this

i made this while taking biology at college because building giant Quizlet decks started feeling like a whole second homework assignment. Quizlet does have import, but according to its own help docs, you still have to prepare terms and definitions in a clean format, separate them with commas, tabs, or dashes, separate each row, paste the text into the browser import field, then create the set. that is fine for a neat vocab list. it gets annoying when your real material is slides, transcripts, labs, notes, and study-guide chaos.

i wanted something more local and less fussy: drop class material into a folder, use the Codex subscription i already have for coding, and let an agent help turn everything into flashcards and quizzes. the app runs in my browser against local files, keeps private class data out of the public repo, and could also work with locally run LLMs later.

the other thing i wanted was better review. when a card comes back, cram.fyi can reword the prompt instead of showing the exact same sentence every time, so you have to understand the idea instead of memorizing the phrasing. very necessary. very bio-exam-survival.

## how studying works

cram.fyi uses an adaptive study queue instead of making you choose tiny waves like `10`, `20`, or `30` cards. the app keeps a larger queue under the hood, mixes new cards with review cards, and gives missed cards a real gap before they come back. if you miss a card near the end of the queue, it should usually wait for the next queue instead of instantly boomeranging back at you.

when a card repeats, the app can generate alternate front prompts while keeping the back answer fixed. the point is not to change the fact being tested. the point is to ask for the same answer in a slightly different way.

rewording is intentionally separate from the chat helper:

- the chat helper can use the model you pick in the UI.
- rewording uses a fixed cheaper helper model on the server.
- rewording starts a fresh one-shot Codex thread per card.
- rewording does not keep the previous card's context around.
- generated prompt variants are cached in your browser's local storage.

if rewording is slow, you may briefly see `rewording...`. ideally, the app prefetches upcoming repeated cards before you reach them, so that loading state is just the fallback.

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
cram.fyi/
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
5. study cards in the browser; cram.fyi will mix new cards, review cards, and spaced repeats.
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
