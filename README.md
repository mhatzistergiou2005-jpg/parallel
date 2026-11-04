# PARALLEL

> Discover your direction. Build your next chapter.

PARALLEL is an interactive career discovery application designed to help people
understand their interests, recognise their strengths, explore possible career
paths, and turn curiosity into a practical plan.

## Live application

Use the application here:

**[Open PARALLEL](https://mhatzistergiou2005-jpg.github.io/parallel/)**

The application is published with GitHub Pages and is available to anyone who
has the link.

## What PARALLEL offers

- **Home dashboard** — a personalised overview of progress and next steps.
- **Discover yourself** — an interactive questionnaire based on interests,
  preferences, strengths, and working style.
- **Career paths** — explore career directions matched to your responses.
- **Skills map** — identify useful transferable and career-specific skills.
- **Learn & grow** — discover practical learning activities for your goals.
- **My roadmap** — organise small, achievable actions into a clear direction.
- **PARALLEL AI Guide** — receive guidance based on the signals selected in the
  application. No external API is required.

## How to use it

1. Open the [live application](https://mhatzistergiou2005-jpg.github.io/parallel/).
2. Start with **Discover yourself**.
3. Answer the questionnaire based on what feels most like you.
4. Review your suggested career paths and skill matches.
5. Choose a learning activity or next step.
6. Use **My roadmap** to keep your progress visible.

There are no right or wrong answers. The application is intended as a
reflection and exploration tool, not as a definitive career assessment.

## Project structure

| File | Purpose |
| --- | --- |
| `index.html` | Application layout, content, and navigation |
| `style.css` | Main visual design and responsive styling |
| `overrides.css` | Additional style adjustments and refinements |
| `script.js` | Career data, questionnaire logic, interactions, and state |

## Running locally

Because PARALLEL is a static web application, no backend or build step is
required.

1. Clone the repository:

   ```bash
   git clone https://github.com/mhatzistergiou2005-jpg/parallel.git
   cd parallel
   ```

2. Open `index.html` in a browser, or serve the folder with a local web
   server.

For example, with Python:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Making changes

Edit the relevant files, save them, and preview the result locally. To publish
the changes to the live application:

```bash
git add index.html script.js style.css overrides.css README.md
git commit -m "Describe your change"
git push origin main
```

GitHub Pages automatically publishes the latest contents of the `main` branch.
It can take a short time for a new deployment to become visible. If an older
version is still displayed, refresh the page with `Ctrl+Shift+R` or open it in
an incognito window.

## Collaborators

Collaborators must be added to the repository by its owner before they can
push changes. Once they have access, they can:

1. Clone the repository.
2. Create and test their changes locally.
3. Commit their work.
4. Push to `main`, or open a pull request for review.

All published changes are visible through the live application link.

## Design direction

PARALLEL uses a calm, modern visual language with soft gradients, rounded
cards, clear progress indicators, and responsive layouts. The experience is
designed to feel encouraging and practical while helping users move from
self-discovery to action.
