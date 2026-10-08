import { App, appSqids } from '../src/app/adapters/web/views/app.tsx';
import type { Task } from '../src/app/adapters/persistence/repositories.ts';
const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};
const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;
const items: Task[] = [
  { id: 1, title: 'Buy milk', description: 'Semi-skimmed', is_completed: true },
  { id: 2, title: '<b>Write report</b>', description: null, is_completed: false },
];
const render = async (props: Partial<Parameters<typeof App>[0]> = {}) =>
  String(await <App email='person@example.test' items={items} {...props} />);

Deno.test('tasks render as a read-only table, not edit forms', async () => {
  const html = await render();
  assert(html.includes('<table aria-label="Task list">'), 'expected a task table');
  assert(count(html, /<tr id="task-/g) === 2, 'expected one row per task');
  // Only the add form has text inputs; rows show text plus toggle, Edit and Delete controls.
  assert(count(html, /name="title"/g) === 1, 'rows must not contain title inputs');
  assert(count(html, /<textarea/g) === 1, 'rows must not contain description textareas');
  assert(html.includes('<s>Buy milk</s>'), 'completed tasks are struck through');
  assert(html.includes('&lt;b&gt;Write report&lt;/b&gt;'), 'titles are escaped');
  const editUrl = `/tasks/${appSqids.encode([2])}/edit`;
  assert(html.includes(`@get(&#39;${editUrl}&#39;)`), 'each row offers an Edit action');
});

Deno.test('editing renders only the selected row as a form, with errors', async () => {
  const html = await render({
    editing: { id: 1, values: { title: '', description: 'Changed' }, errors: { title: 'Bad' } },
  });
  assert(count(html, /name="title"/g) === 2, 'expected the add form plus one edit form');
  assert(html.includes('id="edit-title" name="title" value="" aria-invalid="true"'), 'edit title');
  assert(html.includes('>Changed</textarea>'), 'submitted description is kept');
  assert(html.includes('<li>Bad</li>'), 'edit errors are shown in the edit row');
  assert(html.includes(`@get(&#39;/tasks/${appSqids.encode([1])}&#39;)`), 'cancel action');
  assert(!html.includes('Buy milk</s>'), 'the edited task is not also shown read-only');
});

Deno.test('add form keeps values and shows errors after validation failure', async () => {
  const html = await render({ values: { title: '', description: 'Keep me' }, errors: { t: 'X' } });
  assert(html.includes('>Keep me</textarea>'), 'description is kept');
  assert(html.includes('<li>X</li>'), 'errors are shown');
});
