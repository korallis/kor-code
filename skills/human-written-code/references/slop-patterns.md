# Slop patterns and their human fix

Scan the diff for each. The examples use TypeScript but the patterns are language-neutral.

## Narrating comments

```ts
// Before
// Loop through the users and filter the active ones
const active = users.filter((u) => u.active);

// After
const active = users.filter((u) => u.active);
```

Keep a comment only when it carries a reason: `// The API returns 0 for "unlimited", not null.`

## Section dividers and banners

`// ---------- helpers ----------`, `/** @class Foo */` blocks, per-function doc blocks that repeat the signature. Delete. Put module-level reasons in the README or a single header line if the project asks for one.

## Bare numbers

```ts
// Before
setTimeout(redraw, 200);
icon.style.marginLeft = "4px";

// After
const REDRAW_DELAY_MS = 200;
const ICON_GAP_PX = 4;
setTimeout(redraw, REDRAW_DELAY_MS);
icon.style.marginLeft = `${ICON_GAP_PX}px`;
```

One file uses it: top of that file. Several files: the module's constants file. Colours come from the theme tokens, not literals.

## One-caller wrappers

```ts
// Before
function getUserName(user: User) { return user.name; }

// After
user.name
```

Also: a class around one function, a factory returning one thing, a `utils.ts` created for a single helper.

## Defensive noise

```ts
// Before
function total(items: Item[] | null | undefined): number {
  if (!items || !Array.isArray(items)) return 0;
  try {
    return items.reduce((s, i) => s + (i?.price ?? 0), 0);
  } catch (e) {
    console.error(e);
    return 0;
  }
}

// After: the type says items is always an array of Items
const total = (items: Item[]) => items.reduce((s, i) => s + i.price, 0);
```

If a real caller can pass null, fix the caller or the type, not every callee.

## Over-engineering

Config objects with one key, strategy patterns with one strategy, event buses for two components, generics nobody instantiates, "extensible" switch tables. Write the direct version. Add the abstraction when the second case arrives.

## Inconsistency with the file

New code that uses `async/await` in a callback-style file, a different error type, different naming case, different quote or import style, its own logging format. Copy the dominant local pattern.

## Name noise

`data`, `result`, `temp`, `handleThing`, `processItems`, `utilsHelper`, `managerService`. Rename to what the value is (`unpaidInvoices`), or inline it.

## Leftover scaffolding

`console.log("here")`, `// TODO: implement`, empty `catch {}`, unused parameters prefixed with `_` to dodge the linter, placeholder text, generated sample data.

## Prose in code and PRs

Phrases such as "robust", "seamless", "comprehensive solution", "ensures that", and summary sentences that restate the title. Cut them. Use plain language that explains the change.
