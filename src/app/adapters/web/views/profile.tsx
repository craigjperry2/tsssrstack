import type { FC } from 'hono/jsx';

export const Profile: FC = () => (
  <div id='app'>
    <h1>Change password</h1>
    <form method='post' action='/profile/password'>
      <div data-field>
        <label htmlFor='current-password'>Current password</label>
        <input id='current-password' required type='password' name='currentPassword' />
      </div>
      <div data-field>
        <label htmlFor='new-password'>New password</label>
        <input id='new-password' required type='password' name='newPassword' />
      </div>
      <button type='submit'>Change password</button>
    </form>
  </div>
);
