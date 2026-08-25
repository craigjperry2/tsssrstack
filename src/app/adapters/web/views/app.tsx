import type { FC } from 'hono/jsx';
import type { Task } from '../../persistence/repositories.ts';
import Sqids from 'sqids';
const sqids = new Sqids({
  alphabet: 'nTjWkP2QGBVqby6Eo3aONFwKADZ84SUYdL1v0h9fH7gCprRJXe5xismctMluIz',
  minLength: 10,
});
const id = (value: number) => sqids.encode([value]);
const taskExpr = (url: string) => `@post('${url}', {contentType: 'form'})`;
export const App: FC<
  {
    email: string;
    items: Task[];
    values?: { title?: string; description?: string };
    errors?: Record<string, string>;
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
            <button type='submit' class='secondary'>Log out</button>
          </form>
        </li>
      </ul>
    </nav>
    <h1>Your tasks</h1>
    {Object.keys(errors).length > 0 && (
      <aside aria-live='polite'>
        <strong>Please correct the following:</strong>
        <ul>{Object.values(errors).map((error, index) => <li key={index}>{error}</li>)}</ul>
      </aside>
    )}
    <form data-on:submit__prevent={taskExpr('/tasks')}>
      <label htmlFor='task-title'>
        Title<input
          id='task-title'
          name='title'
          data-bind='title'
          value={values.title ?? ''}
          aria-invalid={Boolean(errors.title)}
        />
      </label>
      <label htmlFor='task-description'>
        Description<textarea id='task-description' name='description' data-bind='description'>
          {values.description ?? ''}
        </textarea>
      </label>
      <button type='submit'>Add task</button>
    </form>
    {items.length === 0 ? <p>No tasks yet. Add one above.</p> : (
      <section aria-label='Task list'>
        {items.map((task) => (
          <article id={`task-${id(task.id)}`}>
            <form data-on:submit__prevent={taskExpr(`/tasks/${id(task.id)}/toggle`)}>
              <label>
                <input
                  type='checkbox'
                  checked={task.is_completed}
                  data-on:change={taskExpr(`/tasks/${id(task.id)}/toggle`)}
                />{' '}
                <s>{task.is_completed ? task.title : ''}</s>
                {!task.is_completed && task.title}
              </label>
            </form>
            <form data-on:submit__prevent={taskExpr(`/tasks/${id(task.id)}/edit`)}>
              <label>
                Title<input name='title' value={task.title} />
              </label>
              <label>
                Description<textarea name='description'>{task.description ?? ''}</textarea>
              </label>
              <button type='submit'>Save</button>
            </form>
            <form data-on:submit__prevent={taskExpr(`/tasks/${id(task.id)}/delete`)}>
              <button type='submit' class='contrast'>Delete</button>
            </form>
          </article>
        ))}
      </section>
    )}
  </div>
);
export const appSqids = sqids;
