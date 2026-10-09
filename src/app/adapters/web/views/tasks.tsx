import { type FC, Fragment } from 'hono/jsx';
import type { ListedTask } from '../../../application/tasks.ts';
import type { Task } from '../../../domain/task.ts';
import { getExpr, postExpr } from '../datastar.ts';
import { encodePublicId as id } from '../public-id.ts';
type Values = { title?: string; description?: string; dueDate?: string };
type Errors = Record<string, string>;

const ErrorSummary: FC<{ errors: Errors }> = ({ errors }) =>
  Object.keys(errors).length > 0
    ? (
      <div class='notification is-danger is-light content' aria-live='polite'>
        <strong>Please correct the following:</strong>
        <ul>{Object.values(errors).map((error, index) => <li key={index}>{error}</li>)}</ul>
      </div>
    )
    : null;

const TaskFields: FC<{ prefix: string; values: Values; errors: Errors; bind?: boolean }> = (
  { prefix, values, errors, bind },
) => (
  <>
    <div class='field'>
      <label class='label' htmlFor={`${prefix}-title`}>Title</label>
      <div class='control'>
        <input
          class={errors.title ? 'input is-danger' : 'input'}
          id={`${prefix}-title`}
          name='title'
          data-bind={bind ? 'title' : undefined}
          value={values.title ?? ''}
          aria-invalid={errors.title ? true : undefined}
        />
      </div>
    </div>
    <div class='field'>
      <label class='label' htmlFor={`${prefix}-description`}>Description</label>
      <div class='control'>
        <textarea
          class={errors.description ? 'textarea is-danger' : 'textarea'}
          id={`${prefix}-description`}
          name='description'
          data-bind={bind ? 'description' : undefined}
          aria-invalid={errors.description ? true : undefined}
        >
          {values.description ?? ''}
        </textarea>
      </div>
    </div>
    <div class='field'>
      <label class='label' htmlFor={`${prefix}-due-date`}>Due date</label>
      <div class='control'>
        <input
          class={errors.dueDate ? 'input is-danger' : 'input'}
          type='date'
          id={`${prefix}-due-date`}
          name='dueDate'
          data-bind={bind ? 'dueDate' : undefined}
          value={values.dueDate ?? ''}
          aria-invalid={errors.dueDate ? true : undefined}
          aria-describedby={`${prefix}-due-date-help`}
        />
      </div>
      <p class='help' id={`${prefix}-due-date-help`}>
        Optional. The task is overdue from the following day, by UTC date.
      </p>
    </div>
  </>
);

const TaskRow: FC<{ task: ListedTask }> = ({ task }) => {
  const url = `/tasks/${id(task.id)}`;
  return (
    <tr id={`task-${id(task.id)}`}>
      <td class='is-narrow is-vcentered'>
        <form data-on:submit__prevent={postExpr(`${url}/toggle`)}>
          <input
            type='checkbox'
            aria-label={`Completed: ${task.title}`}
            checked={task.completed}
            data-on:change={postExpr(`${url}/toggle`)}
          />
        </form>
      </td>
      <td class='is-vcentered'>
        {task.completed ? <s>{task.title}</s> : <strong>{task.title}</strong>}
        {task.dueDate && (
          <>
            {' '}
            <span class={task.overdue ? 'tag is-danger is-light' : 'tag is-light'}>
              {task.overdue ? `Overdue · due ${task.dueDate}` : `Due ${task.dueDate}`}
            </span>
          </>
        )}
        {task.description && (
          <>
            <br />
            <small class='has-text-grey'>{task.description}</small>
          </>
        )}
      </td>
      <td class='is-narrow is-vcentered'>
        {/* One form holds both buttons so Bulma's .buttons group lays them out on one line. */}
        <form
          class='buttons are-small is-flex-wrap-nowrap'
          data-on:submit__prevent={postExpr(`${url}/delete`)}
        >
          <button
            type='button'
            class='button'
            aria-label={`Edit ${task.title}`}
            aria-controls={editorId(task.id)}
            data-on:click={getExpr(`${url}/edit`)}
          >
            Edit
          </button>
          <button
            type='submit'
            class='button is-danger is-outlined'
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
            values={values ??
              {
                title: task.title,
                description: task.description ?? '',
                dueDate: task.dueDate ?? '',
              }}
            errors={errors}
          />
          <div class='buttons'>
            <button type='submit' class='button is-primary'>Save</button>
            <button type='button' class='button' data-on:click={getExpr(url)}>Cancel</button>
          </div>
        </form>
      </td>
    </tr>
  );
};

export const App: FC<
  {
    email: string;
    items: ListedTask[];
    values?: Values;
    errors?: Errors;
  }
> = ({ email, items, values = {}, errors = {} }) => (
  <div id='app'>
    <nav class='level'>
      <div class='level-left'>
        <strong class='level-item'>Tasks</strong>
      </div>
      <form class='level-right' method='post' action='/logout'>
        <span class='level-item has-text-grey'>{email}</span>
        <a class='level-item' href='/profile'>Profile</a>
        <div class='level-item'>
          <button type='submit' class='button is-small'>Log out</button>
        </div>
      </form>
    </nav>
    <h1 class='title'>Your tasks</h1>
    <form class='block' data-on:submit__prevent={postExpr('/tasks')}>
      <ErrorSummary errors={errors} />
      <TaskFields prefix='task' values={values} errors={errors} bind />
      <button type='submit' class='button is-primary'>Add task</button>
    </form>
    {items.length === 0
      ? <p>No tasks yet. Add one above.</p>
      : (
        <table class='table is-fullwidth is-hoverable' aria-label='Task list'>
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
      )}
  </div>
);
