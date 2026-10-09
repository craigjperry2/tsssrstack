import { App, ClosedEditor, TaskEditor } from '../../src/app/adapters/web/views/tasks.tsx';
import { encodePublicId } from '../../src/app/adapters/web/public-id.ts';
import type { ListedTask } from '../../src/app/application/tasks.ts';
import type { CalendarDate } from '../../src/app/domain/calendar.ts';
import type { TaskDescription, TaskTitle } from '../../src/app/domain/task.ts';
const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};
const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;
const items: ListedTask[] = [
  {
    id: 1,
    ownerId: 7,
    title: 'Buy milk' as TaskTitle,
    description: 'Semi-skimmed' as TaskDescription,
    dueDate: null,
    completed: true,
    overdue: false,
  },
  {
    id: 2,
    ownerId: 7,
    title: '<b>Write report</b>' as TaskTitle,
    description: null,
    dueDate: '2026-10-01' as CalendarDate,
    completed: false,
    overdue: true,
  },
];
const render = async (props: Partial<Parameters<typeof App>[0]> = {}) =>
  String(await <App email='person@example.test' items={items} {...props} />);

Deno.test('tasks render as a read-only table, not edit forms', async () => {
  const html = await render();
  assert(/<table [^>]*aria-label="Task list">/.test(html), 'expected a task table');
  assert(count(html, /<tr id="task-/g) === 2, 'expected one row per task');
  // Only the add form has text inputs; rows show text plus toggle, Edit and Delete controls.
  assert(count(html, /name="title"/g) === 1, 'rows must not contain title inputs');
  assert(count(html, /<textarea/g) === 1, 'rows must not contain description textareas');
  assert(html.includes('<s>Buy milk</s>'), 'completed tasks are struck through');
  assert(html.includes('&lt;b&gt;Write report&lt;/b&gt;'), 'titles are escaped');
  const editUrl = `/tasks/${encodePublicId(2)}/edit`;
  assert(html.includes(`@get(&#39;${editUrl}&#39;)`), 'each row offers an Edit action');
});

Deno.test('every task has a closed editor row that fat morphs leave alone', async () => {
  const html = await render();
  const editor = `<tr id="edit-${encodePublicId(1)}" data-ignore-morph="true" hidden=""></tr>`;
  assert(html.includes(editor), 'closed editor placeholder with data-ignore-morph');
  assert(String(await <ClosedEditor taskId={1} />) === editor, 'Cancel/Save restore it');
});

Deno.test('the task editor is a form that keeps submitted values and shows errors', async () => {
  const prefix = `edit-${encodePublicId(1)}`;
  const fresh = String(await <TaskEditor task={items[0]} />);
  assert(fresh.includes(`<tr id="${prefix}" data-ignore-morph="true">`), 'editor survives morphs');
  assert(fresh.includes(`id="${prefix}-title" name="title" value="Buy milk"`), 'current title');
  const html = String(
    await (
      <TaskEditor
        task={items[0]}
        values={{ title: '', description: 'Changed' }}
        errors={{ title: 'Bad' }}
      />
    ),
  );
  assert(html.includes(`id="${prefix}-title" name="title" value="" aria-invalid="true"`), 'title');
  assert(html.includes('>Changed</textarea>'), 'submitted description is kept');
  assert(html.includes('<li>Bad</li>'), 'edit errors are shown in the editor');
  assert(html.includes(`@get(&#39;/tasks/${encodePublicId(1)}&#39;)`), 'cancel action');
});

Deno.test('add form keeps values and shows errors after validation failure', async () => {
  const html = await render({ values: { title: '', description: 'Keep me' }, errors: { t: 'X' } });
  assert(html.includes('>Keep me</textarea>'), 'description is kept');
  assert(html.includes('<li>X</li>'), 'errors are shown');
});

Deno.test('due dates render as tags, with overdue tasks flagged', async () => {
  const html = await render({
    items: [
      { ...items[1], id: 3, dueDate: '2026-10-01' as CalendarDate, overdue: true },
      { ...items[1], id: 4, dueDate: '2026-12-25' as CalendarDate, overdue: false },
    ],
  });
  assert(
    html.includes('<span class="tag is-danger is-light">Overdue · due 2026-10-01</span>'),
    html,
  );
  assert(html.includes('<span class="tag is-light">Due 2026-12-25</span>'), html);
  assert(
    count(html, /type="date" id="task-due-date" name="dueDate" data-bind="dueDate"/g) === 1,
    html,
  );
});
