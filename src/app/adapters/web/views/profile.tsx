import type { FC } from 'hono/jsx';

export const Profile: FC = () => (
  <div id='app'>
    <h1 class='title'>Change password</h1>
    <form method='post' action='/profile/password'>
      <div class='field'>
        <label class='label' htmlFor='current-password'>Current password</label>
        <div class='control'>
          <input
            class='input'
            id='current-password'
            required
            type='password'
            name='currentPassword'
          />
        </div>
      </div>
      <div class='field'>
        <label class='label' htmlFor='new-password'>New password</label>
        <div class='control'>
          <input class='input' id='new-password' required type='password' name='newPassword' />
        </div>
      </div>
      <button type='submit' class='button is-primary'>Change password</button>
    </form>
  </div>
);
