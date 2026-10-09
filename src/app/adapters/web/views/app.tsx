import { type FC, Fragment } from 'hono/jsx';
import type { Task } from '../../persistence/repositories.ts';
import Sqids from 'sqids';
const sqids = new Sqids({
  alphabet: 'nTjWkP2QGBVqby6Eo3aONFwKADZ84SUYdL1v0h9fH7gCprRJXe5xismctMluIz',
  minLength: 10,
});
const id = (value: number) => sqids.encode([value]);
// Datastar expressions are built only from server-generated URLs, never from user input.
const postExpr = (url: string) => `@post('${url}', {contentType: 'form'})`;
const getExpr = (url: string) => `@get('${url}')`;
type Values = { title?: string; description?: string };
type Errors = Record<string, string>;

const ErrorSummary: FC<{ errors: Errors }> = ({ errors }) =>
  Object.keys(errors).length > 0
    ? (
      <aside aria-live='polite'>
        <strong>Please correct the following:</strong>
        <ul>{Object.values(errors).map((error, index) => <li key={index}>{error}</li>)}</ul>
      </aside>
    )
    : null;

const TaskFields: FC<{ prefix: string; values: Values; errors: Errors; bind?: boolean }> = (
  { prefix, values, errors, bind },
) => (
  <>
    <label htmlFor={`${prefix}-title`}>
      Title<input
        id={`${prefix}-title`}
        name='title'
        data-bind={bind ? 'title' : undefined}
        value={values.title ?? ''}
        aria-invalid={errors.title ? true : undefined}
      />
    </label>
    <label htmlFor={`${prefix}-description`}>
      Description<textarea
        id={`${prefix}-description`}
        name='description'
        data-bind={bind ? 'description' : undefined}
        aria-invalid={errors.description ? true : undefined}
      >
        {values.description ?? ''}
      </textarea>
    </label>
  </>
);

const TaskRow: FC<{ task: Task }> = ({ task }) => {
  const url = `/tasks/${id(task.id)}`;
  return (
    <tr id={`task-${id(task.id)}`}>
      <td>
        <form data-on:submit__prevent={postExpr(`${url}/toggle`)}>
          <input
            type='checkbox'
            aria-label={`Completed: ${task.title}`}
            checked={task.is_completed}
            data-on:change={postExpr(`${url}/toggle`)}
          />
        </form>
      </td>
      <td>
        {task.is_completed ? <s>{task.title}</s> : <strong>{task.title}</strong>}
        {task.description && (
          <>
            <br />
            <small>{task.description}</small>
          </>
        )}
      </td>
      <td class='task-actions'>
        <button
          type='button'
          class='secondary outline btn-sm'
          aria-label={`Edit ${task.title}`}
          aria-controls={editorId(task.id)}
          data-on:click={getExpr(`${url}/edit`)}
        >
          Edit
        </button>
        <form data-on:submit__prevent={postExpr(`${url}/delete`)}>
          <button type='submit' class='contrast outline btn-sm' aria-label={`Delete ${task.title}`}>
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
export const TaskEditor: FC<{ task: Task; values?: Values; errors?: Errors }> = (
  { task, values, errors = {} },
) => {
  const url = `/tasks/${id(task.id)}`;
  return (
    <tr id={editorId(task.id)} data-ignore-morph>
      <td colSpan={3}>
        <form
          aria-label={`Edit ${task.title}`}
          data-on:submit__prevent={postExpr(`${url}/edit`)}
        >
          <ErrorSummary errors={errors} />
          <TaskFields
            prefix={editorId(task.id)}
            values={values ?? { title: task.title, description: task.description ?? '' }}
            errors={errors}
          />
          <div role='group'>
            <button type='submit'>Save</button>
            <button type='button' class='secondary' data-on:click={getExpr(url)}>Cancel</button>
          </div>
        </form>
      </td>
    </tr>
  );
};

export const App: FC<
  {
    email: string;
    items: Task[];
    values?: Values;
    errors?: Errors;
  }
> = ({ email, items, values = {}, errors = {} }) => (
  <div id='app'>
    <nav>
      <ul>
        <li>
          <strong>Tasks</strong>
        </li>
      </ul>
      <ul>
        <li>{email}</li>
        <li>
          <a href='/profile'>Profile</a>
        </li>
        <li>
          <form method='post' action='/logout'>
            <button type='submit' class='secondary btn-sm'>Log out</button>
          </form>
        </li>
      </ul>
    </nav>
    <h1>Your tasks</h1>
    <form data-on:submit__prevent={postExpr('/tasks')}>
      <ErrorSummary errors={errors} />
      <TaskFields prefix='task' values={values} errors={errors} bind />
      <button type='submit'>Add task</button>
    </form>
    {items.length === 0
      ? <p>No tasks yet. Add one above.</p>
      : (
        <table class='tasks' aria-label='Task list'>
          <thead>
            <tr>
              <th scope='col' class='task-done'>Done</th>
              <th scope='col'>Task</th>
              <th scope='col' class='task-actions'>Actions</th>
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
      )}
  </div>
);
export const appSqids = sqids;
