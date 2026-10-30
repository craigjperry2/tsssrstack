import { type FC, Fragment } from 'hono/jsx';
import type { ListedTask } from '../../../application/tasks.ts';
import type { Task } from '../../../domain/task.ts';
import { getExpr, postExpr } from '../datastar.ts';
import { encodePublicId as id } from '../public-id.ts';
type Values = { title?: string; description?: string; dueDate?: string };
type Errors = Record<string, string>;

const ErrorSummary: FC<{ errors: Errors }> = ({ errors }) =>
  Object.keys(errors).length > 0 ? (
    <div role='alert' data-variant='danger' class='vstack gap-1 mb-4' aria-live='polite'>
      <strong>Please correct the following:</strong>
      <ul>
        {Object.values(errors).map((error, index) => (
          <li key={index}>{error}</li>
        ))}
      </ul>
    </div>
  ) : null;

const TaskFields: FC<{ prefix: string; values: Values; errors: Errors; bind?: boolean }> = ({
  prefix,
  values,
  errors,
  bind,
}) => (
  <>
    {/* Oat styles the controls themselves; aria-invalid gives an input its error border. */}
    <div data-field>
      <label htmlFor={`${prefix}-title`}>Title</label>
      <input
        id={`${prefix}-title`}
        name='title'
        data-bind={bind ? 'title' : undefined}
        value={values.title ?? ''}
        aria-invalid={errors.title ? true : undefined}
      />
    </div>
    <div data-field>
      <label htmlFor={`${prefix}-description`}>Description</label>
      <textarea
        id={`${prefix}-description`}
        name='description'
        data-bind={bind ? 'description' : undefined}
        aria-invalid={errors.description ? true : undefined}
      >
        {values.description ?? ''}
      </textarea>
    </div>
    <div data-field>
      <label htmlFor={`${prefix}-due-date`}>Due date</label>
      <input
        type='date'
        id={`${prefix}-due-date`}
        name='dueDate'
        data-bind={bind ? 'dueDate' : undefined}
        value={values.dueDate ?? ''}
        aria-invalid={errors.dueDate ? true : undefined}
        aria-describedby={`${prefix}-due-date-help`}
      />
      <small data-hint id={`${prefix}-due-date-help`}>
        Optional. The task is overdue from the following day, by UTC date.
      </small>
    </div>
  </>
);

const TaskRow: FC<{ task: ListedTask }> = ({ task }) => {
  const url = `/tasks/${id(task.id)}`;
  return (
    <tr id={`task-${id(task.id)}`}>
      <td>
        <form data-on:submit__prevent={postExpr(`${url}/toggle`)}>
          <input
            type='checkbox'
            aria-label={`Completed: ${task.title}`}
            checked={task.completed}
            data-on:change={postExpr(`${url}/toggle`)}
          />
        </form>
      </td>
      <td>
        {task.completed ? <s>{task.title}</s> : <strong>{task.title}</strong>}
        {task.dueDate && (
          <>
            {' '}
            <span class='badge' data-variant={task.overdue ? 'danger' : 'secondary'}>
              {task.overdue ? `Overdue · due ${task.dueDate}` : `Due ${task.dueDate}`}
            </span>
          </>
        )}
        {task.description && (
          <>
            <br />
            <small class='text-light'>{task.description}</small>
          </>
        )}
      </td>
      <td>
        {/* One form holds both buttons: one line when there is room, stacked on narrow screens. */}
        <form class='hstack gap-2' data-on:submit__prevent={postExpr(`${url}/delete`)}>
          <button
            type='button'
            class='outline small'
            aria-label={`Edit ${task.title}`}
            aria-controls={editorId(task.id)}
            data-on:click={getExpr(`${url}/edit`)}
          >
            Edit
          </button>
          <button
            type='submit'
            class='outline small'
            data-variant='danger'
            aria-label={`Delete ${task.title}`}
          >
            Delete
          </button>
        </form>
      </td>
    </tr>
  );
};

// Each task has an editor row below it. It is closed (hidden and empty) until Edit replaces it
// with a form. data-ignore-morph makes Datastar keep whichever editor row is in the page when
// the table is fat-morphed, so an open editor and its unsaved input survive other actions.
// Edit, Save and Cancel swap just this row with `mode replace`, which bypasses that guard.
const editorId = (taskId: number) => `edit-${id(taskId)}`;
export const ClosedEditor: FC<{ taskId: number }> = ({ taskId }) => (
  <tr id={editorId(taskId)} data-ignore-morph hidden></tr>
);
export const TaskEditor: FC<{ task: Task; values?: Values; errors?: Errors }> = ({
  task,
  values,
  errors = {},
}) => {
  const url = `/tasks/${id(task.id)}`;
  return (
    <tr id={editorId(task.id)} data-ignore-morph>
      <td colSpan={3}>
        <form aria-label={`Edit ${task.title}`} data-on:submit__prevent={postExpr(`${url}/edit`)}>
          <ErrorSummary errors={errors} />
          <TaskFields
            prefix={editorId(task.id)}
            values={
              values ?? {
                title: task.title,
                description: task.description ?? '',
                dueDate: task.dueDate ?? '',
              }
            }
            errors={errors}
          />
          <div class='hstack'>
            <button type='submit'>Save</button>
            <button type='button' class='outline' data-on:click={getExpr(url)}>
              Cancel
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
};

export const App: FC<{
  email: string;
  items: ListedTask[];
  values?: Values;
  errors?: Errors;
}> = ({ email, items, values = {}, errors = {} }) => (
  <div id='app'>
    <nav class='flex justify-between items-center'>
      <strong>Tasks</strong>
      <form class='hstack' method='post' action='/logout'>
        <span class='text-light'>{email}</span>
        <a href='/profile'>Profile</a>
        <button type='submit' class='outline small'>
          Log out
        </button>
      </form>
    </nav>
    <h1>Your tasks</h1>
    <form class='mb-6' data-on:submit__prevent={postExpr('/tasks')}>
      <ErrorSummary errors={errors} />
      <TaskFields prefix='task' values={values} errors={errors} bind />
      <button type='submit'>Add task</button>
    </form>
    {items.length === 0 ? (
      <p>No tasks yet. Add one above.</p>
    ) : (
      // Oat's .table wrapper scrolls the table sideways on narrow screens.
      <div class='table'>
        <table aria-label='Task list'>
          <thead>
            <tr>
              <th scope='col'>Done</th>
              <th scope='col'>Task</th>
              <th scope='col'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((task) => (
              <Fragment key={String(task.id)}>
                <TaskRow task={task} />
                <ClosedEditor taskId={task.id} />
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);
