import type { FC } from 'hono/jsx';
export const Auth: FC<{ mode: 'login' | 'register'; error?: string }> = ({ mode, error }) => (
  <>
    <h1 class='title'>{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
    {error && <p role='alert' class='notification is-danger is-light'>{error}</p>}
    <form class='block' method='post' action={`/${mode}`}>
      <div class='field'>
        <label class='label' htmlFor='email'>Email</label>
        <div class='control'>
          <input
            class='input'
            id='email'
            required
            type='email'
            name='email'
            autoComplete='email'
          />
        </div>
      </div>
      <div class='field'>
        <label class='label' htmlFor='password'>Password</label>
        <div class='control'>
          <input
            class='input'
            id='password'
            required
            type='password'
            name='password'
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </div>
      </div>
      <button type='submit' class='button is-primary'>
        {mode === 'login' ? 'Sign in' : 'Register'}
      </button>
    </form>
    <p>
      <a href={mode === 'login' ? '/register' : '/login'}>
        {mode === 'login' ? 'Create an account' : 'Already have an account?'}
      </a>
    </p>
  </>
);
