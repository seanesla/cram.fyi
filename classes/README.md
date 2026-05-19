# Private Class Folders

Put real course folders here if you want the simplest setup:

```text
classes/
  biology/
    study-guide.md
    flashcards.json
```

Everything inside `classes/` is ignored by Git except this README, so your real class files do not get committed by accident.

Start a class deck with:

```bash
npm start -- --class biology
```
